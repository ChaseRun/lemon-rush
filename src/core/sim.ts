// Balance simulator (docs/BALANCE.md). Scripted players play many seeded seasons through the real engine
// so the economy can be tuned by numbers instead of by feel. Pure and deterministic like the rest of
// src/core; the game itself never imports this file. `npm run sim` prints the report.
//
//   player = strategy (morning: buy + price) + server (autoServe, or a capped "human" Rush)

import type { Arrival, Bar, DayOutcome, DayPlan, DayReport, DaySimulator, GameState, Item, Pack, ServedRecord } from '../contract';
import { ITEMS } from '../contract';
import { DAILY_COST, JUG_CAPACITY, PACKS, PRICE_MAX, PRICE_MIN, SEASON_DAYS, TIP_MULTIPLIER_BY_BAR } from './config';
import { autoServe, endDay, planDay } from './day';
import { expectedStoppers } from './demand';
import { roundCents, toCents } from './money';
import { createRng, hashString } from './rng';
import { buy, packsFor } from './shop';
import { newGame, setPrice } from './state';

/** Player-model numbers. These describe the simulated players, not the game, so they live here and not in config. */
export const SIM_DEFAULTS = {
  /** Arrival → hand-over when nobody is ahead: a glass is already poured, walk over, 0.8s serve. */
  latencyMs: 2500,
  /** Customers who can wait at once (the side-view counter has 3 spots). */
  spots: 3,
  /** Each serve takes (dayLength / capacity) × uniform(1 − jitter, 1 + jitter): humans are uneven. */
  serveJitter: 0.35,
  /** Patience bar thresholds (match the Rush): green above 60% left, red below 30%. */
  greenAbove: 0.6,
  redBelow: 0.3,
  /** Price steps a human uses on the Morning slider. */
  priceStep: 0.25,
  /** Decent human slips: chance the price lands one slider step off, and the most extra stock they buy "to be safe". */
  priceSlipChance: 0.5,
  overbuyMax: 0.4,
  /** Big packs only when this much cash is left over after the rest of the shopping list (careful / decent human). */
  bulkCushion: 10,
  decentBulkCushion: 3,
  /** The perfect player prices to the nickel. */
  perfectPriceStep: 0.05,
  /** The perfect player buys this much over expected stoppers. */
  perfectBuffer: 1.1,
  /** The naive player's fixed price, and the pack it buys (medium) whenever an item is below one pack. */
  naivePrice: 2,
  naivePackIdx: 1,
  /** The reckless player's fixed price. */
  recklessPrice: 2,
};

// ---------- Capped server: a human playing the Rush ----------

export interface CappedServeOptions {
  /** Most glasses this player can hand over in one day if customers never stopped coming. */
  capacity: number;
  latencyMs?: number;
  spots?: number;
  serveJitter?: number;
}

function barFor(patienceLeft: number): Bar {
  if (patienceLeft > SIM_DEFAULTS.greenAbove) return 'green';
  return patienceLeft >= SIM_DEFAULTS.redBelow ? 'yellow' : 'red';
}

/**
 * A human-speed Rush: one server, first come first served, `spots` places to wait.
 *   - A hand-over finishes at max(arrival + latency, previous hand-over + serve time).
 *   - The serve time averages dayLength / capacity, so at most ~capacity glasses fit in a day.
 *   - A customer whose patience would run out first walks out (no stock used); an arrival who finds
 *     every spot taken is a no-room miss; whoever is still waiting at closing leaves (leftAtClose).
 *   - Bars come from the patience left at hand-over; tips follow TIP_MULTIPLIER_BY_BAR.
 *   - Stock follows the jug rule exactly like autoServe (fill only when a glass is needed; leftovers are poured out).
 * With a huge capacity and zero latency this is autoServe.
 */
export function cappedServe(options: CappedServeOptions): DaySimulator {
  const latencyMs = options.latencyMs ?? SIM_DEFAULTS.latencyMs;
  const spots = options.spots ?? SIM_DEFAULTS.spots;
  const jitter = options.serveJitter ?? SIM_DEFAULTS.serveJitter;

  return (plan: DayPlan): DayOutcome => {
    const serveMs = plan.dayLengthMs / Math.max(1, options.capacity);
    const rng = createRng(hashString(`capped|${plan.day}|${options.capacity}|${plan.price}|${plan.arrivals.length}`));
    const nextServe = () => serveMs * rng.float(1 - jitter, 1 + jitter);

    const left = { ...plan.inventory };
    let jug = 0;
    let filled = 0;
    const served: ServedRecord[] = [];
    let walkouts = 0;
    let noRoom = 0;
    const canPour = () => left.cups > 0 && left.ice > 0 && (jug > 0 || (left.lemons > 0 && left.sugar > 0));
    let soldOutAtMs: number | null = canPour() ? null : 0;

    const queue: { a: Arrival; deadline: number }[] = [];
    let lastDone = Number.NEGATIVE_INFINITY;
    let thisServe = nextServe();

    /** Plays the stand forward to time t. */
    const advance = (t: number) => {
      while (soldOutAtMs === null && queue.length > 0) {
        const head = queue[0];
        const done = Math.max(head.a.atMs + latencyMs, lastDone + thisServe);
        if (done > head.deadline) {
          if (head.deadline > t) break; // still waiting at t
          queue.shift();
          walkouts++;
          continue;
        }
        if (done > t || done > plan.dayLengthMs) break;
        queue.shift();
        if (jug === 0) {
          const fill = Math.min(JUG_CAPACITY, left.lemons, left.sugar);
          left.lemons -= fill;
          left.sugar -= fill;
          jug = fill;
          filled += fill;
        }
        jug--;
        left.cups--;
        left.ice--;
        const bar = barFor(1 - (done - head.a.atMs) / head.a.patienceMs);
        served.push({
          arrivalId: head.a.id,
          type: head.a.type,
          paid: plan.price,
          tip: roundCents(plan.price * head.a.tipRate * TIP_MULTIPLIER_BY_BAR[bar]),
          bar,
          atMs: Math.round(done),
        });
        lastDone = done;
        thisServe = nextServe();
        if (!canPour()) soldOutAtMs = Math.round(done);
      }
      // Customers further back whose patience ran out by t have walked out, freeing their spot.
      for (let i = queue.length - 1; i >= 1; i--) {
        if (queue[i].deadline <= t) {
          queue.splice(i, 1);
          walkouts++;
        }
      }
    };

    let soldOutMisses = 0;
    let i = 0;
    for (; i < plan.arrivals.length; i++) {
      const a = plan.arrivals[i];
      advance(a.atMs);
      if (soldOutAtMs !== null) break;
      if (queue.length >= spots) noRoom++;
      else queue.push({ a, deadline: a.atMs + a.patienceMs });
    }
    advance(plan.dayLengthMs);
    let leftAtClose = 0;
    if (soldOutAtMs !== null) soldOutMisses = queue.length + (plan.arrivals.length - i);
    else leftAtClose = queue.length;

    return {
      served,
      walkouts,
      noRoom,
      soldOutMisses,
      soldOutAtMs,
      leftAtClose,
      pouredOut: jug,
      used: { lemons: filled, sugar: filled, cups: served.length, ice: served.length },
    };
  };
}

// ---------- Shopping helpers ----------

/** Cheapest mix of packs whose sizes add up to at least `need` (ties go to more units). Returns pack indexes. */
export function cheapestCover(packs: readonly Pack[], need: number): number[] {
  if (need <= 0) return [];
  let best: { cost: number; size: number; counts: number[] } | null = null;
  const maxCount = packs.map((p) => Math.ceil(need / p.size));
  const counts = packs.map(() => 0);
  const visit = (k: number) => {
    if (k === packs.length) {
      const size = counts.reduce((s, c, j) => s + c * packs[j].size, 0);
      if (size < need) return;
      const cost = counts.reduce((s, c, j) => s + c * toCents(packs[j].price), 0);
      if (!best || cost < best.cost || (cost === best.cost && size > best.size)) best = { cost, size, counts: [...counts] };
      return;
    }
    for (let c = 0; c <= maxCount[k]; c++) {
      counts[k] = c;
      visit(k + 1);
    }
    counts[k] = 0;
  };
  visit(0);
  const chosen = best as { counts: number[] } | null;
  return chosen ? chosen.counts.flatMap((c, j) => Array.from({ length: c }, () => j)) : [];
}

function coverCost(state: GameState, item: Item, need: number): number {
  const packs = packsFor(state, item);
  return cheapestCover(packs, need).reduce((s, j) => s + packs[j].price, 0);
}

function buyAll(state: GameState, item: Item, packIdxs: readonly number[]): GameState {
  let s = state;
  for (const j of packIdxs) {
    const r = buy(s, item, j);
    if (!r.ok) break;
    s = r.state;
  }
  return s;
}

/** Cost per glass if every item came in pack `idx` at today's prices. */
export function unitCost(state: GameState, idx: number): number {
  return ITEMS.reduce((sum, item) => {
    const p = packsFor(state, item)[idx];
    return sum + p.price / p.size;
  }, 0);
}

/**
 * Tops stock up to `target` glasses as cheaply as today's cash allows:
 *   - shrinks the target until the cheapest covering packs fit in (cash − reserve)
 *   - ice (melts tonight) is always bought to the target exactly as cheaply as possible
 *   - lemons, sugar and cups keep, so with `bulk` they come in the biggest pack when the
 *     money left after the rest of the list still covers `bulkCushion`
 */
export function stockUp(state: GameState, target: number, opts: { reserve?: number; bulk?: boolean; bulkCushion?: number } = {}): GameState {
  const reserve = opts.reserve ?? 0;
  const need = (t: number, item: Item) => Math.max(0, t - state.inventory[item]);
  const planCost = (t: number) => ITEMS.reduce((sum, item) => sum + coverCost(state, item, need(t, item)), 0);
  let t = Math.max(0, Math.floor(target));
  while (t > 0 && planCost(t) > state.cash - reserve) t--;
  if (t === 0) return state;

  let s = state;
  let remaining = planCost(t);
  for (const item of ITEMS) {
    const n = need(t, item);
    if (n === 0) continue;
    const packs = packsFor(s, item);
    const cover = cheapestCover(packs, n);
    const cost = cover.reduce((sum, j) => sum + packs[j].price, 0);
    remaining -= cost;
    const big = packs.length - 1;
    const bulkCount = Math.ceil(n / packs[big].size);
    const bulkCost = bulkCount * packs[big].price;
    const canBulk =
      opts.bulk && item !== 'ice' && s.cash - remaining - bulkCost >= (opts.bulkCushion ?? 0) + reserve;
    s = buyAll(s, item, canBulk ? Array.from({ length: bulkCount }, () => big) : cover);
  }
  return s;
}

// ---------- Strategies ----------

/** Pack tier indexes (0 = small … last = large); every item has the same number of tiers. */
const PACK_TIERS = PACKS.lemons.map((_, i) => i);

/** A morning routine: look at the Morning screen, buy, set the price. */
export interface Strategy {
  name: string;
  morning(state: GameState): GameState;
}

function todaysOutlook(state: GameState) {
  const f = state.forecast[0];
  const weather = f ? { sky: f.sky, tempF: f.tempF } : state.weather[state.day - 1];
  return { weather, news: state.news[state.day - 1] };
}

function priceGrid(step: number): number[] {
  const out: number[] = [];
  for (let c = toCents(PRICE_MIN); c <= toCents(PRICE_MAX); c += toCents(step)) out.push(c / 100);
  return out;
}

/**
 * Best price for a player who can serve at most `capacity` (Infinity = autoServe):
 * maximise min(expected stoppers, capacity) × (price − cost per glass); ties go to the higher price.
 */
export function bestPrice(state: GameState, capacity: number, step: number, costPerGlass: number): { price: number; stoppers: number } {
  const { weather, news } = todaysOutlook(state);
  let best = { price: PRICE_MIN, stoppers: 0, score: Number.NEGATIVE_INFINITY };
  for (const p of priceGrid(step)) {
    const e = expectedStoppers(weather, news, state.popularity, p);
    const score = Math.min(e, capacity) * (p - costPerGlass);
    if (score >= best.score) best = { price: p, stoppers: e, score };
  }
  return { price: best.price, stoppers: best.stoppers };
}

export interface DecentOptions {
  /**
   * Human slips: half the days the price lands one slider step off, stock is bought with up to 40% extra,
   * and big packs are grabbed as soon as they fit (a $3 cushion instead of a careful $10).
   */
  slips?: boolean;
  /** Always price this far from the planned price (for the price-sensitivity table). */
  priceOffset?: number;
}

/**
 * Decent human: reads today's forecast, stays shut on a forecast storm, prices on the $0.25 slider so expected
 * stoppers ≈ what they can serve, buys about that many glasses (never more than they can serve), and buys big
 * packs of lemons/sugar/cups once there's cash to spare. With `slips` (the default) they make human-sized
 * mistakes; without, they are a careful planner who never misjudges.
 */
export function decentStrategy(capacity: number, opts: DecentOptions = {}): Strategy {
  const slips = opts.slips ?? true;
  const offset = opts.priceOffset ?? 0;
  const label = offset === 0 ? '' : ` ${offset > 0 ? '+' : '-'}$${Math.abs(offset).toFixed(2)}`;
  return {
    name: `${slips ? 'decent' : 'careful'} C=${capacity}${label}`,
    morning(state) {
      const { weather } = todaysOutlook(state);
      if (weather.sky === 'storm') return state;
      const plan = bestPrice(state, capacity, SIM_DEFAULTS.priceStep, unitCost(state, 1));
      let price = plan.price + offset;
      let target = plan.stoppers;
      if (slips) {
        const rng = createRng(hashString(`decent|${state.seed}|${state.day}`));
        if (rng.chance(SIM_DEFAULTS.priceSlipChance)) price += rng.chance(0.5) ? SIM_DEFAULTS.priceStep : -SIM_DEFAULTS.priceStep;
        target *= 1 + rng.float(0, SIM_DEFAULTS.overbuyMax);
      }
      const s = setPrice(state, price);
      const bulkCushion = slips ? SIM_DEFAULTS.decentBulkCushion : SIM_DEFAULTS.bulkCushion;
      return stockUp(s, Math.min(capacity, Math.round(target)), { bulk: true, bulkCushion });
    },
  };
}

/** Perfect play: prices to the nickel on the forecast, buys expected stoppers + 10%, always bulk when it fits. */
export const perfectStrategy: Strategy = {
  name: 'perfect (autoServe)',
  morning(state) {
    const { weather } = todaysOutlook(state);
    if (weather.sky === 'storm') return state;
    const { price, stoppers } = bestPrice(state, Number.POSITIVE_INFINITY, SIM_DEFAULTS.perfectPriceStep, unitCost(state, 1));
    const s = setPrice(state, price);
    return stockUp(s, Math.ceil(stoppers * SIM_DEFAULTS.perfectBuffer), { bulk: true, bulkCushion: SIM_DEFAULTS.bulkCushion });
  },
};

/**
 * Naive: always $2, and every morning tops up anything below one medium pack with a medium pack
 * (scarcest first, so ice is never forgotten), whatever the forecast says.
 */
export const naiveStrategy: Strategy = {
  name: 'naive',
  morning(state) {
    let s = setPrice(state, SIM_DEFAULTS.naivePrice);
    const byScarcity = [...ITEMS].sort((a, b) => s.inventory[a] - s.inventory[b]);
    for (const item of byScarcity) {
      const pack = packsFor(s, item)[SIM_DEFAULTS.naivePackIdx];
      if (s.inventory[item] < pack.size) s = buyAll(s, item, [SIM_DEFAULTS.naivePackIdx]);
    }
    return s;
  },
};

/**
 * Reckless: always $2, and spends every cent each morning: full sets (one pack of each item) at the
 * biggest tier it can afford, then single small packs of the scarcest items with the change.
 */
export const recklessStrategy: Strategy = {
  name: 'reckless',
  morning(state) {
    let s = setPrice(state, SIM_DEFAULTS.recklessPrice);
    const tiers = PACK_TIERS.slice().reverse();
    for (;;) {
      const tier = tiers.find((t) => ITEMS.reduce((sum, item) => sum + packsFor(s, item)[t].price, 0) <= s.cash);
      if (tier === undefined) break;
      for (const item of ITEMS) s = buyAll(s, item, [tier]);
    }
    for (;;) {
      const item = [...ITEMS].sort((a, b) => s.inventory[a] - s.inventory[b]).find((i) => buy(s, i, 0).ok);
      if (!item) return s;
      s = buyAll(s, item, [0]);
    }
  },
};

// ---------- Players and seasons ----------

export interface Player {
  name: string;
  strategy: Strategy;
  serve: DaySimulator;
  /** Glasses per day the server can manage (null = unlimited, autoServe). */
  capacity: number | null;
}

export function capped(strategy: Strategy, capacity: number, name = `${strategy.name}${strategy.name.includes('C=') ? '' : ` C=${capacity}`}`): Player {
  return { name, strategy, serve: cappedServe({ capacity }), capacity };
}

export const PERFECT: Player = { name: 'perfect (autoServe)', strategy: perfectStrategy, serve: autoServe, capacity: null };

export interface SeasonRun {
  seed: number;
  seasonDays: number;
  status: GameState['status'];
  finalCash: number;
  /** Day the stand went under, if it did. */
  bankruptDay: number | null;
  days: DayReport[];
}

export function playSeason(player: Player, seed: number, seasonDays: number = SEASON_DAYS): SeasonRun {
  let state = newGame(seed, seasonDays);
  while (state.status === 'playing') {
    state = player.strategy.morning(state);
    const plan = planDay(state);
    state = endDay(state, plan, player.serve(plan)).state;
  }
  return {
    seed,
    seasonDays,
    status: state.status,
    finalCash: state.cash,
    bankruptDay: state.status === 'bankrupt' ? (state.history.at(-1)?.day ?? null) : null,
    days: state.history,
  };
}

export function runSeasons(player: Player, seeds: readonly number[], seasonDays: number = SEASON_DAYS): SeasonRun[] {
  return seeds.map((seed) => playSeason(player, seed, seasonDays));
}

// ---------- Statistics ----------

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN);

/** Cash at the end of `day` (a bankrupt season keeps its last cash). Day 0 = the starting cash. */
export function cashOnDay(run: SeasonRun, day: number, startCash: number): number {
  if (day <= 0 || run.days.length === 0) return startCash;
  return run.days[Math.min(day, run.days.length) - 1].cashAfter;
}

export interface Phase {
  label: string;
  from: number;
  to: number;
}

export const PHASES_30: Phase[] = [
  { label: 'days 1-5', from: 1, to: 5 },
  { label: 'days 6-20', from: 6, to: 20 },
  { label: 'days 21-30', from: 21, to: 30 },
];

export const PHASES_7: Phase[] = [
  { label: 'days 1-3', from: 1, to: 3 },
  { label: 'days 4-7', from: 4, to: 7 },
];

export interface PlayerSummary {
  name: string;
  seasons: number;
  seasonDays: number;
  /** Cash at the end of each listed day: p10 / median / p90 over seasons. */
  cashByDay: { day: number; p10: number; median: number; p90: number }[];
  /** Per phase: median over seasons of the average daily profit, and of the average on sunny/partly-cloudy days. */
  phaseProfit: { label: string; median: number; goodDays: number }[];
  finalCash: { p10: number; median: number; p90: number };
  bankruptRate: number;
  /** Median day of going under, among the seasons that did. */
  bankruptDayMedian: number | null;
  /** Share of seasons ending with at least $X. */
  reached: { amount: number; rate: number }[];
  /** Averages per day played. */
  perDay: {
    stopped: number;
    sold: number;
    walkouts: number;
    noRoom: number;
    soldOutMisses: number;
    pouredOut: number;
    iceMelted: number;
    greenShare: number;
    rating: number;
  };
  /** Median price, stoppers, sold and popularity by day (over seasons still playing that day). */
  byDay: { day: number; cash: number; price: number; stopped: number; sold: number; popularity: number; profit: number }[];
}

export const SAVINGS_GOALS = [50, 75, 100, 200, 300, 500, 600, 750] as const;

export function summarize(
  name: string,
  runs: readonly SeasonRun[],
  opts: { startCash: number; days?: number[]; phases?: Phase[] },
): PlayerSummary {
  const seasonDays = runs[0]?.seasonDays ?? SEASON_DAYS;
  const listedDays = (opts.days ?? [1, 5, 10, 15, 20, 25, 30]).filter((d) => d <= seasonDays);
  const phases = (opts.phases ?? (seasonDays <= 7 ? PHASES_7 : PHASES_30)).filter((p) => p.from <= seasonDays);
  const finals = runs.map((r) => r.finalCash);
  const allDays = runs.flatMap((r) => r.days);
  const bankrupt = runs.filter((r) => r.bankruptDay !== null);
  const isGood = (d: DayReport) => d.weather.sky === 'sunny' || d.weather.sky === 'partlyCloudy';

  const byDay = Array.from({ length: seasonDays }, (_, i) => {
    const days = runs.map((r) => r.days[i]).filter((d): d is DayReport => d !== undefined);
    return {
      day: i + 1,
      cash: quantile(runs.map((r) => cashOnDay(r, i + 1, opts.startCash)), 0.5),
      price: quantile(days.map((d) => d.price), 0.5),
      stopped: quantile(days.map((d) => d.stopped), 0.5),
      sold: quantile(days.map((d) => d.glassesSold), 0.5),
      popularity: quantile(days.map((d) => d.popularityAfter), 0.5),
      profit: quantile(days.map((d) => d.profit), 0.5),
    };
  });

  const servedTotal = allDays.reduce((s, d) => s + d.glassesSold, 0);
  return {
    name,
    seasons: runs.length,
    seasonDays,
    cashByDay: listedDays.map((day) => {
      const cash = runs.map((r) => cashOnDay(r, day, opts.startCash));
      return { day, p10: quantile(cash, 0.1), median: quantile(cash, 0.5), p90: quantile(cash, 0.9) };
    }),
    phaseProfit: phases.map((p) => {
      const inPhase = (r: SeasonRun) => r.days.filter((d) => d.day >= p.from && d.day <= p.to);
      const avg = runs.map((r) => inPhase(r)).filter((ds) => ds.length > 0).map((ds) => mean(ds.map((d) => d.profit)));
      const good = runs
        .map((r) => inPhase(r).filter(isGood))
        .filter((ds) => ds.length > 0)
        .map((ds) => mean(ds.map((d) => d.profit)));
      return { label: p.label, median: quantile(avg, 0.5), goodDays: quantile(good, 0.5) };
    }),
    finalCash: { p10: quantile(finals, 0.1), median: quantile(finals, 0.5), p90: quantile(finals, 0.9) },
    bankruptRate: bankrupt.length / Math.max(1, runs.length),
    bankruptDayMedian: bankrupt.length ? quantile(bankrupt.map((r) => r.bankruptDay as number), 0.5) : null,
    reached: SAVINGS_GOALS.map((amount) => ({ amount, rate: runs.filter((r) => r.finalCash >= amount).length / Math.max(1, runs.length) })),
    perDay: {
      stopped: mean(allDays.map((d) => d.stopped)),
      sold: mean(allDays.map((d) => d.glassesSold)),
      walkouts: mean(allDays.map((d) => d.walkouts)),
      noRoom: mean(allDays.map((d) => d.noRoom)),
      soldOutMisses: mean(allDays.map((d) => d.soldOutMisses)),
      pouredOut: mean(allDays.map((d) => d.pouredOut)),
      iceMelted: mean(allDays.map((d) => d.iceMelted)),
      greenShare: servedTotal ? allDays.reduce((s, d) => s + d.servedByBar.green, 0) / servedTotal : 0,
      rating: mean(allDays.map((d) => d.serviceRating)),
    },
    byDay,
  };
}

// ---------- Report formatting ----------

const money = (n: number) => (Number.isNaN(n) ? '   -' : `$${Math.round(n)}`);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const pad = (s: string, w: number) => (s.length >= w ? s : ' '.repeat(w - s.length) + s);
const padEnd = (s: string, w: number) => (s.length >= w ? s : s + ' '.repeat(w - s.length));

/** ▁▂▃▄▅▆▇█ sparkline of a series, scaled to its own min..max. */
export function sparkline(values: readonly number[]): string {
  const bars = '▁▂▃▄▅▆▇█';
  const finite = values.filter((v) => Number.isFinite(v));
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  return values
    .map((v) => (Number.isFinite(v) ? bars[hi === lo ? 0 : Math.round(((v - lo) / (hi - lo)) * (bars.length - 1))] : ' '))
    .join('');
}

function table(header: string[], rows: string[][], firstWidth = 22): string {
  const widths = header.map((h, i) => Math.max(i === 0 ? firstWidth : 7, h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? padEnd(c, widths[i]) : pad(c, widths[i]))).join(' | ');
  return [line(header), widths.map((w) => '-'.repeat(w)).join('-|-'), ...rows.map(line)].join('\n');
}

export function formatReport(summaries: readonly PlayerSummary[], title: string): string {
  if (summaries.length === 0) return title;
  const s0 = summaries[0];
  const out: string[] = [`## ${title}  (${s0.seasons} seeds × ${s0.seasonDays} days, daily cost $${DAILY_COST.amount.toFixed(2)})`, ''];

  out.push('Cash at end of day: median [p10–p90]');
  out.push(
    table(
      ['player', ...s0.cashByDay.map((c) => `day ${c.day}`)],
      summaries.map((s) => [s.name, ...s.cashByDay.map((c) => `${money(c.median)} [${money(c.p10)}–${money(c.p90)}]`)]),
    ),
  );
  out.push('');
  out.push('Profit per day (median of per-season averages; "good" = sunny/partly cloudy days only)');
  out.push(
    table(
      ['player', ...s0.phaseProfit.map((p) => p.label), ...s0.phaseProfit.map((p) => `${p.label} good`)],
      summaries.map((s) => [s.name, ...s.phaseProfit.map((p) => money(p.median)), ...s.phaseProfit.map((p) => money(p.goodDays))]),
    ),
  );
  out.push('');
  out.push('Outcomes');
  out.push(
    table(
      ['player', 'final p10', 'final med', 'final p90', 'bankrupt', 'bk day', ...SAVINGS_GOALS.map((g) => `>=$${g}`)],
      summaries.map((s) => [
        s.name,
        money(s.finalCash.p10),
        money(s.finalCash.median),
        money(s.finalCash.p90),
        pct(s.bankruptRate),
        s.bankruptDayMedian === null ? '-' : String(Math.round(s.bankruptDayMedian)),
        ...s.reached.map((r) => pct(r.rate)),
      ]),
    ),
  );
  out.push('');
  out.push('Per day played (averages)');
  out.push(
    table(
      ['player', 'stopped', 'sold', 'walkout', 'noRoom', 'soldOut', 'poured', 'iceMelt', 'green', 'rating'],
      summaries.map((s) => {
        const d = s.perDay;
        const f = (n: number) => n.toFixed(1);
        return [s.name, f(d.stopped), f(d.sold), f(d.walkouts), f(d.noRoom), f(d.soldOutMisses), f(d.pouredOut), f(d.iceMelted), pct(d.greenShare), pct(d.rating)];
      }),
    ),
  );
  out.push('');
  out.push('Median cash and median profit by day (each line scaled to its own range)');
  for (const s of summaries) {
    const last = s.byDay.at(-1);
    out.push(
      `${padEnd(s.name, 22)} cash ${sparkline(s.byDay.map((d) => d.cash))} ${money(last?.cash ?? Number.NaN)}   profit ${sparkline(s.byDay.map((d) => d.profit))}`,
    );
  }
  out.push('');
  return out.join('\n');
}

/** Day-by-day detail for one player (price chosen over time, stoppers, sold, popularity, profit). */
export function formatDayByDay(s: PlayerSummary): string {
  const rows = s.byDay.map((d) => [
    String(d.day),
    `$${d.price.toFixed(2)}`,
    d.stopped.toFixed(0),
    d.sold.toFixed(0),
    d.popularity.toFixed(0),
    money(d.profit),
    money(d.cash),
  ]);
  return `${s.name}: medians by day\n${table(['day', 'price', 'stopped', 'sold', 'pop', 'profit', 'cash'], rows, 3)}\n`;
}
