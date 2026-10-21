// Sample data and a crude stub engine so the UI and the Rush can be built before src/core exists.
// Not game-accurate — the real rules live in src/core. Owned by the integrator.

import type {
  Arrival,
  CustomerTypeId,
  DayOutcome,
  DayPlan,
  DayReport,
  Engine,
  ForecastDay,
  GameState,
  Inventory,
  Item,
  NewsEvent,
  Pack,
} from './contract';
import { ITEMS } from './contract';

const QUIET: NewsEvent = {
  id: 'quiet',
  headline: 'A quiet day in the neighborhood. (fixture)',
  trafficMultiplier: 1,
  tempBonusF: 0,
  maxPayMultiplier: 1,
  priceMultipliers: {},
};

const PATIENCE: Record<CustomerTypeId, number> = { kid: 18_000, jogger: 12_000, grandma: 25_000, worker: 15_000 };
const TIP_RATE: Record<CustomerTypeId, number> = { kid: 0, jogger: 0.1, grandma: 0.3, worker: 0.15 };
const STUB_PACKS: Pack[] = [
  { size: 10, price: 1.5 },
  { size: 25, price: 3 },
  { size: 50, price: 5 },
];

const emptyInventory = (): Inventory => ({ lemons: 0, sugar: 0, ice: 0, cups: 0 });
const zeroByType = (): Record<CustomerTypeId, number> => ({ kid: 0, jogger: 0, grandma: 0, worker: 0 });
const round2 = (n: number) => Math.round(n * 100) / 100;

function forecastFor(day: number): ForecastDay[] {
  return [
    { day, sky: 'sunny', tempF: 85, confidence: 'pretty sure' },
    { day: day + 1, sky: 'partlyCloudy', tempF: 82, confidence: 'thinks so' },
    { day: day + 2, sky: 'rain', tempF: 74, confidence: 'just guessing' },
  ];
}

export const fixtureState: GameState = {
  seed: 1,
  day: 1,
  cash: 20,
  inventory: emptyInventory(),
  popularity: 20,
  price: 2,
  weather: Array.from({ length: 30 }, () => ({ sky: 'sunny' as const, tempF: 85 })),
  news: Array.from({ length: 30 }, () => QUIET),
  forecast: forecastFor(1),
  spentToday: 0,
  history: [],
  status: 'playing',
};

const ARRIVAL_TYPES: CustomerTypeId[] = ['jogger', 'grandma', 'worker', 'kid', 'worker', 'jogger'];

/** 24 customers spread over a 120s day. */
export const fixtureArrivals: Arrival[] = Array.from({ length: 24 }, (_, i) => {
  const type = ARRIVAL_TYPES[i % ARRIVAL_TYPES.length];
  return { id: i, atMs: 2_000 + i * 4_500, type, maxPay: 2.5, patienceMs: PATIENCE[type], tipRate: TIP_RATE[type] };
});

export const fixturePlan: DayPlan = {
  day: 1,
  weather: { sky: 'sunny', tempF: 85 },
  news: QUIET,
  price: 2,
  inventory: { lemons: 20, sugar: 20, ice: 20, cups: 20 },
  arrivals: fixtureArrivals,
  passersby: 40,
  tooExpensive: { kid: 14, jogger: 0, grandma: 2, worker: 0 },
  dayLengthMs: 120_000,
};

function glassesMakeable(inv: Inventory): number {
  return Math.min(inv.lemons, inv.sugar, inv.ice, inv.cups);
}

function autoServe(plan: DayPlan): DayOutcome {
  const capacity = glassesMakeable(plan.inventory);
  const servedArrivals = plan.arrivals.slice(0, capacity);
  const served = servedArrivals.map((a) => ({
    arrivalId: a.id,
    type: a.type,
    paid: plan.price,
    tip: round2(plan.price * a.tipRate),
    bar: 'green' as const,
    atMs: a.atMs,
  }));
  const n = served.length;
  const soldOut = plan.arrivals.length > capacity;
  return {
    served,
    walkouts: 0,
    noRoom: 0,
    soldOutMisses: plan.arrivals.length - n,
    soldOutAtMs: soldOut && n > 0 ? servedArrivals[n - 1].atMs : soldOut ? 0 : null,
    leftAtClose: 0,
    used: { lemons: n, sugar: n, ice: n, cups: n },
  };
}

export const fixtureOutcome: DayOutcome = autoServe(fixturePlan);

export const fixtureReport: DayReport = {
  day: 1,
  forecast: forecastFor(1)[0],
  weather: { sky: 'partlyCloudy', tempF: 81 },
  news: QUIET,
  price: 2,
  passersby: 40,
  stopped: 24,
  tooExpensive: fixturePlan.tooExpensive,
  servedByBar: { green: 15, yellow: 3, red: 2 },
  glassesSold: 20,
  walkouts: 2,
  noRoom: 1,
  soldOutMisses: 1,
  soldOutAtMs: 100_000,
  leftAtClose: 0,
  revenue: 40,
  tips: 3.5,
  spent: 13.25,
  profit: 30.25,
  cashAfter: 50.25,
  iceMelted: 0,
  inventoryAfter: emptyInventory(),
  serviceRating: 0.72,
  popularityBefore: 20,
  popularityAfter: 24,
};

/** Crude stand-in for src/core so the UI runs end to end. */
export const fixtureEngine: Engine = {
  newGame: (seed) => ({ ...fixtureState, seed }),
  shopListing: () => Object.fromEntries(ITEMS.map((item) => [item, STUB_PACKS])) as Record<Item, Pack[]>,
  buy(state, item, packIdx) {
    const pack = STUB_PACKS[packIdx];
    if (!pack) return { ok: false, error: 'No such pack' };
    if (pack.price > state.cash) return { ok: false, error: 'Not enough cash' };
    return {
      ok: true,
      state: {
        ...state,
        cash: round2(state.cash - pack.price),
        spentToday: round2(state.spentToday + pack.price),
        inventory: { ...state.inventory, [item]: state.inventory[item] + pack.size },
      },
    };
  },
  setPrice: (state, price) => ({ ...state, price: round2(Math.min(5, Math.max(0.5, price))) }),
  planDay: (state) => ({ ...fixturePlan, day: state.day, price: state.price, inventory: { ...state.inventory } }),
  autoServe,
  endDay(state, plan, outcome) {
    const revenue = round2(outcome.served.reduce((s, r) => s + r.paid, 0));
    const tips = round2(outcome.served.reduce((s, r) => s + r.tip, 0));
    const inventory = { ...state.inventory };
    for (const item of ITEMS) inventory[item] -= outcome.used[item];
    const iceMelted = inventory.ice;
    inventory.ice = 0;
    const cash = round2(state.cash + revenue + tips);
    const report: DayReport = {
      ...fixtureReport,
      day: state.day,
      price: plan.price,
      stopped: plan.arrivals.length,
      servedByBar: {
        green: outcome.served.filter((s) => s.bar === 'green').length,
        yellow: outcome.served.filter((s) => s.bar === 'yellow').length,
        red: outcome.served.filter((s) => s.bar === 'red').length,
      },
      glassesSold: outcome.served.length,
      walkouts: outcome.walkouts,
      noRoom: outcome.noRoom,
      soldOutMisses: outcome.soldOutMisses,
      soldOutAtMs: outcome.soldOutAtMs,
      leftAtClose: outcome.leftAtClose,
      revenue,
      tips,
      spent: state.spentToday,
      profit: round2(revenue + tips - state.spentToday),
      cashAfter: cash,
      iceMelted,
      inventoryAfter: inventory,
    };
    const day = state.day + 1;
    const status = day > 30 ? 'finished' : 'playing';
    return {
      state: { ...state, day, cash, inventory, spentToday: 0, forecast: forecastFor(day), history: [...state.history, report], status },
      report,
    };
  },
  glassesMakeable,
  isBankrupt: (state) => glassesMakeable(state.inventory) === 0 && state.cash < 1.5 * 4,
  gameReducer(state, action) {
    switch (action.type) {
      case 'newGame':
        return fixtureEngine.newGame(action.seed);
      case 'buy': {
        const r = fixtureEngine.buy(state, action.item, action.packIdx);
        return r.ok ? r.state : state;
      }
      case 'setPrice':
        return fixtureEngine.setPrice(state, action.price);
      case 'finishDay':
        return fixtureEngine.endDay(state, action.plan, action.outcome).state;
    }
  },
};

export { zeroByType };
