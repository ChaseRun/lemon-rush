// One day: planDay → (autoServe | Rush) → endDay.

import type { Bar, DayOutcome, DayPlan, DayReport, GameState, GameStatus, ServedRecord } from '../contract';
import { DAY_LENGTH_MS, SEASON_DAYS, TIP_MULTIPLIER_BY_BAR } from './config';
import { generateDemand } from './demand';
import { glassesMakeable, glassesWorth, subtractInventory } from './inventory';
import { roundCents, sumCents } from './money';
import { serviceRating, updatePopularity } from './popularity';
import { isBankrupt } from './state';
import { forecast, forecastDay } from './weather';

/** Freezes this morning's choices (price, stock) together with the day's weather, news and arrivals. */
export function planDay(state: GameState): DayPlan {
  if (state.status !== 'playing') throw new Error(`planDay: game is ${state.status}`);
  const weather = state.weather[state.day - 1];
  const news = state.news[state.day - 1];
  const demand = generateDemand({
    seed: state.seed,
    day: state.day,
    weather,
    news,
    popularity: state.popularity,
    price: state.price,
    dayLengthMs: DAY_LENGTH_MS,
  });
  return {
    day: state.day,
    weather,
    news,
    price: state.price,
    inventory: { ...state.inventory },
    arrivals: demand.arrivals,
    passersby: demand.passersby,
    tooExpensive: demand.tooExpensive,
    dayLengthMs: DAY_LENGTH_MS,
  };
}

/**
 * Perfect play: every arrival is served instantly, on green, in order, while stock can make a glass.
 * Everyone after that is a sold-out miss. soldOutAtMs is when stock hit zero (the last serve,
 * or 0 if the stand opened empty), matching the Rush, which ends the day the moment it sells out.
 */
export function autoServe(plan: DayPlan): DayOutcome {
  const capacity = glassesMakeable(plan.inventory);
  const servedArrivals = plan.arrivals.slice(0, capacity);
  const served: ServedRecord[] = servedArrivals.map((a) => ({
    arrivalId: a.id,
    type: a.type,
    paid: plan.price,
    tip: roundCents(plan.price * a.tipRate * TIP_MULTIPLIER_BY_BAR.green),
    bar: 'green',
    atMs: a.atMs,
  }));
  const ranOut = served.length === capacity;
  return {
    served,
    walkouts: 0,
    noRoom: 0,
    soldOutMisses: plan.arrivals.length - served.length,
    soldOutAtMs: !ranOut ? null : capacity === 0 ? 0 : served[served.length - 1].atMs,
    leftAtClose: 0,
    used: glassesWorth(served.length),
  };
}

function countByBar(served: readonly ServedRecord[]): Record<Bar, number> {
  const counts: Record<Bar, number> = { green: 0, yellow: 0, red: 0 };
  for (const s of served) counts[s.bar]++;
  return counts;
}

/**
 * Closes the day:
 *   1. cash += revenue + tips; stock -= used; report.spent = spentToday, then reset it
 *   2. melt all ice
 *   3. service rating → 4. popularity
 *   5. history + report
 *   6. advance to the next morning (forecast; news is pre-rolled)
 *   7. status: 'finished' after the last day, else 'bankrupt' if you can't restock, else 'playing'
 */
export function endDay(state: GameState, plan: DayPlan, outcome: DayOutcome): { state: GameState; report: DayReport } {
  if (state.status !== 'playing') throw new Error(`endDay: game is ${state.status}`);
  if (plan.day !== state.day) throw new Error(`endDay: plan is for day ${plan.day}, game is on day ${state.day}`);

  // 1. Money and stock. Stock never goes negative even if a simulator over-reports usage.
  const revenue = sumCents(outcome.served.map((s) => s.paid));
  const tips = sumCents(outcome.served.map((s) => s.tip));
  const cash = roundCents(state.cash + revenue + tips);
  const spent = state.spentToday;
  const afterSales = subtractInventory(state.inventory, outcome.used);

  // 2. All ice melts overnight.
  const iceMelted = afterSales.ice;
  const inventory = { ...afterSales, ice: 0 };

  // 3–4. Meters.
  const rating = serviceRating(outcome);
  const popularityAfter = updatePopularity(state.popularity, rating);

  // 5. Report.
  const report: DayReport = {
    day: state.day,
    forecast: state.forecast.find((f) => f.day === state.day) ?? forecastDay(state.seed, state.day, 0, plan.weather),
    weather: plan.weather,
    news: plan.news,
    price: plan.price,
    passersby: plan.passersby,
    stopped: plan.arrivals.length,
    tooExpensive: { ...plan.tooExpensive },
    servedByBar: countByBar(outcome.served),
    glassesSold: outcome.served.length,
    walkouts: outcome.walkouts,
    noRoom: outcome.noRoom,
    soldOutMisses: outcome.soldOutMisses,
    soldOutAtMs: outcome.soldOutAtMs,
    leftAtClose: outcome.leftAtClose,
    revenue,
    tips,
    spent,
    profit: roundCents(revenue + tips - spent),
    cashAfter: cash,
    iceMelted,
    inventoryAfter: { ...inventory },
    serviceRating: rating,
    popularityBefore: state.popularity,
    popularityAfter,
  };

  // 6. Next morning.
  const next: GameState = {
    ...state,
    day: state.day + 1,
    cash,
    inventory,
    popularity: popularityAfter,
    spentToday: 0,
    history: [...state.history, report],
    forecast: [],
  };
  next.forecast = forecast(next);

  // 7. Season end wins over bankruptcy: after day 30 there is no tomorrow to restock for.
  const status: GameStatus = next.day > SEASON_DAYS ? 'finished' : isBankrupt(next) ? 'bankrupt' : 'playing';
  return { state: { ...next, status }, report };
}
