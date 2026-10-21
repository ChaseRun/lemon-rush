// Tests for the balance simulator: the capped "human" server, the shopping helpers, the player models,
// and loose guards on the balance goals in docs/BALANCE.md (so a config tweak can't silently break the curve).

import { describe, expect, it } from 'vitest';
import type { DayOutcome, DayPlan } from '../contract';
import { ITEMS } from '../contract';
import { JUG_CAPACITY, PRICE_MAX, PRICE_MIN, START_CASH } from './config';
import { autoServe, planDay } from './day';
import { packsFor } from './shop';
import {
  PERFECT,
  bestPrice,
  capped,
  cappedServe,
  cashOnDay,
  cheapestCover,
  decentStrategy,
  naiveStrategy,
  playSeason,
  quantile,
  recklessStrategy,
  runSeasons,
  sparkline,
  stockUp,
  summarize,
} from './sim';
import { arrival, gameWith, planWith, stock } from './testing';

/** n joggers arriving every `gapMs`. */
function crowd(n: number, gapMs: number, overrides: Partial<DayPlan> = {}): DayPlan {
  return planWith({
    arrivals: Array.from({ length: n }, (_, i) => arrival(i, 'jogger', i * gapMs)),
    inventory: stock(100),
    dayLengthMs: 90_000,
    ...overrides,
  });
}

function expectAccounting(plan: DayPlan, o: DayOutcome) {
  const n = o.served.length;
  expect(n + o.walkouts + o.noRoom + o.soldOutMisses + o.leftAtClose).toBe(plan.arrivals.length);
  expect(o.used.lemons).toBe(o.used.sugar);
  expect(o.used.cups).toBe(n);
  expect(o.used.ice).toBe(n);
  expect(o.pouredOut).toBe(o.used.lemons - n);
  expect(o.pouredOut).toBeGreaterThanOrEqual(0);
  expect(o.pouredOut).toBeLessThan(JUG_CAPACITY);
  for (const item of ITEMS) expect(o.used[item]).toBeLessThanOrEqual(plan.inventory[item]);
}

describe('cappedServe (a human-speed Rush)', () => {
  it('serves a light day completely, on green, like autoServe', () => {
    const plan = crowd(8, 10_000);
    const o = cappedServe({ capacity: 14 })(plan);
    expect(o.served).toHaveLength(8);
    expect(o.served.every((s) => s.bar === 'green')).toBe(true);
    expect(o.walkouts + o.noRoom).toBe(0);
    expect(o.used).toEqual(autoServe(plan).used);
    expectAccounting(plan, o);
  });

  it('can only hand over about `capacity` glasses a day, however many come', () => {
    for (const capacity of [10, 14, 20]) {
      const plan = crowd(80, 1_100);
      const o = cappedServe({ capacity })(plan);
      expect(o.served.length).toBeLessThanOrEqual(Math.ceil(capacity / (1 - 0.35)));
      expect(o.served.length).toBeGreaterThanOrEqual(Math.floor(capacity * 0.6));
      expect(o.walkouts + o.noRoom).toBeGreaterThan(0);
      expectAccounting(plan, o);
    }
  });

  it('a busy counter means slower serves: fewer greens, smaller tips, and no-room misses', () => {
    const light = cappedServe({ capacity: 14 })(crowd(8, 10_000));
    const busy = cappedServe({ capacity: 14 })(crowd(40, 2_000));
    const greenShare = (o: DayOutcome) => o.served.filter((s) => s.bar === 'green').length / o.served.length;
    expect(greenShare(busy)).toBeLessThan(greenShare(light));
    expect(busy.noRoom).toBeGreaterThan(0);
    for (const s of busy.served) {
      const tipRate = 0.1;
      expect(s.tip).toBeCloseTo(2 * tipRate * { green: 1, yellow: 0.5, red: 0 }[s.bar], 2);
    }
  });

  it('a walkout uses no stock; selling out ends the day and counts the misses', () => {
    const plan = crowd(20, 1_000, { inventory: stock(5) });
    const o = cappedServe({ capacity: 30 })(plan);
    expect(o.served).toHaveLength(5);
    expect(o.soldOutAtMs).not.toBeNull();
    expect(o.soldOutMisses).toBeGreaterThan(0);
    expect(o.used).toEqual(stock(5));
    expectAccounting(plan, o);
  });

  it('opening with nothing to sell sells out at 0', () => {
    const plan = crowd(5, 1_000, { inventory: { lemons: 10, sugar: 10, ice: 0, cups: 10 } });
    const o = cappedServe({ capacity: 14 })(plan);
    expect(o.soldOutAtMs).toBe(0);
    expect(o.soldOutMisses).toBe(5);
    expect(o.served).toEqual([]);
  });

  it('customers still waiting at closing leave (not walkouts)', () => {
    const plan = crowd(3, 1_000, { arrivals: [arrival(0, 'grandma', 89_000), arrival(1, 'grandma', 89_500)] });
    const o = cappedServe({ capacity: 14 })(plan);
    expect(o.leftAtClose).toBe(2);
    expect(o.walkouts).toBe(0);
  });

  it('is deterministic, and keeps the jug bookkeeping across many real days', () => {
    let state = gameWith({ cash: 500 });
    state = stockUp(state, 40);
    for (const capacity of [10, 14, 20]) {
      for (const price of [1, 2, 3]) {
        const plan = planDay({ ...state, price, popularity: 80 });
        const o = cappedServe({ capacity })(plan);
        expect(o).toEqual(cappedServe({ capacity })(plan));
        expectAccounting(plan, o);
      }
    }
  });
});

describe('shopping helpers', () => {
  const quiet = gameWith({ todayNews: 'quiet', cash: 100 });

  it('cheapestCover finds the cheapest mix of packs that covers the need', () => {
    const ice = packsFor(quiet, 'ice'); // 10/$1.50, 25/$3.00, 50/$4.50
    expect(cheapestCover(ice, 0)).toEqual([]);
    expect(cheapestCover(ice, 8)).toEqual([0]);
    expect(cheapestCover(ice, 20)).toEqual([1]); // one 25 ($3) beats two 10s ($3) on size
    expect(cheapestCover(ice, 40)).toEqual([2]);
  });

  it('stockUp reaches the target when it can afford to, and never spends past the reserve', () => {
    const s = stockUp(quiet, 30);
    for (const item of ITEMS) expect(s.inventory[item]).toBeGreaterThanOrEqual(30);
    const poor = gameWith({ todayNews: 'quiet', cash: 5 });
    const p = stockUp(poor, 30, { reserve: 1 });
    expect(p.cash).toBeGreaterThanOrEqual(1);
    expect(p.cash).toBeLessThanOrEqual(5);
  });

  it('bulk buys the big pack of lemons/sugar/cups only when the cushion allows, never of ice', () => {
    const s = stockUp(quiet, 20, { bulk: true, bulkCushion: 10 });
    expect(s.inventory.lemons).toBe(50);
    expect(s.inventory.ice).toBe(25);
    const tight = stockUp(gameWith({ todayNews: 'quiet', cash: 20 }), 10, { bulk: true, bulkCushion: 10 });
    expect(tight.inventory.lemons).toBe(10);
  });
});

describe('player models', () => {
  it('bestPrice: a player who can serve fewer prices higher', () => {
    const state = gameWith({ popularity: 60 });
    const slow = bestPrice(state, 8, 0.25, 0.6).price;
    const fast = bestPrice(state, Number.POSITIVE_INFINITY, 0.25, 0.6).price;
    expect(slow).toBeGreaterThanOrEqual(fast);
    expect(slow).toBeGreaterThanOrEqual(PRICE_MIN);
    expect(slow).toBeLessThanOrEqual(PRICE_MAX);
  });

  it('decent stays shut (buys nothing) when Walt forecasts a storm', () => {
    const state = gameWith({ cash: 50 });
    const stormy = { ...state, forecast: [{ ...state.forecast[0], sky: 'storm' as const }, ...state.forecast.slice(1)] };
    expect(decentStrategy(14).morning(stormy)).toBe(stormy);
  });

  it('decent never buys more than it can serve; naive always charges $2; reckless spends down to its change', () => {
    const state = gameWith({ cash: 60 });
    const d = decentStrategy(14).morning(state);
    // Target ≤ 14 glasses, rounded up to the cheapest packs (a 25-pack of ice costs the same as two 10s).
    expect(Math.min(...ITEMS.map((i) => d.inventory[i]))).toBeLessThanOrEqual(25);
    expect(naiveStrategy.morning(state).price).toBe(2);
    const r = recklessStrategy.morning(state);
    expect(Math.min(...ITEMS.map((i) => r.inventory[i]))).toBeGreaterThan(0);
    const cheapest = Math.min(...ITEMS.map((i) => packsFor(r, i)[0].price));
    expect(r.cash).toBeLessThan(cheapest);
  });

  it('a season is deterministic per seed and player', () => {
    const p = capped(decentStrategy(14), 14);
    expect(playSeason(p, 5)).toEqual(playSeason(p, 5));
    expect(playSeason(p, 5, 7).days.length).toBeLessThanOrEqual(7);
  });
});

describe('statistics', () => {
  it('quantile interpolates; sparkline scales to the range', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([5], 0.9)).toBe(5);
    expect(sparkline([0, 7])).toBe('▁█');
    expect(sparkline([3, 3])).toBe('▁▁');
  });

  it('cashOnDay keeps a bankrupt season at its last cash', () => {
    const run = playSeason(capped(recklessStrategy, 14), 3);
    const last = run.days.at(-1)?.cashAfter ?? START_CASH;
    expect(cashOnDay(run, 30, START_CASH)).toBe(last);
    expect(cashOnDay(run, 0, START_CASH)).toBe(START_CASH);
  });

  it('summarize reports bankruptcy and savings-goal rates as shares of seasons', () => {
    const runs = runSeasons(capped(naiveStrategy, 14), [1, 2, 3, 4, 5, 6]);
    const s = summarize('naive', runs, { startCash: START_CASH });
    expect(s.seasons).toBe(6);
    expect(s.bankruptRate).toBe(runs.filter((r) => r.status === 'bankrupt').length / 6);
    for (const g of s.reached) expect(g.rate).toBe(runs.filter((r) => r.finalCash >= g.amount).length / 6);
  });
});

// Loose guards on the goals in docs/BALANCE.md. `npm run sim` has the full picture (300 seeds).
describe('balance goals (40 seeds)', () => {
  const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
  const final = (p: Parameters<typeof runSeasons>[0]) =>
    summarize(p.name, runSeasons(p, seeds), { startCash: START_CASH });
  const decent = final(capped(decentStrategy(14), 14));
  const slow = final(capped(decentStrategy(10), 10));
  const perfect = final(PERFECT);
  const naive = final(capped(naiveStrategy, 14));
  const reckless = final(capped(recklessStrategy, 14));

  // Bands follow the play-test config (busier crowd); see BALANCE.md "Play-test feedback".
  it('a decent player ends the summer with roughly $700–$1,300, and a slow server (C=10) still makes it', () => {
    expect(decent.finalCash.median).toBeGreaterThan(700);
    expect(decent.finalCash.median).toBeLessThan(1300);
    expect(slow.finalCash.median).toBeGreaterThan(500);
  });

  it('better later: profit per day grows phase by phase', () => {
    const [early, mid, late] = decent.phaseProfit.map((p) => p.median);
    expect(mid).toBeGreaterThan(early * 1.3);
    expect(late).toBeGreaterThan(mid);
  });

  it('perfect play (uncapped autoServe) is clearly better than decent', () => {
    expect(perfect.finalCash.median).toBeGreaterThan(decent.finalCash.median * 1.3);
    // Uncapped auto-serve scales with foot traffic; this is only a sanity ceiling (see BALANCE.md on capping it).
    expect(perfect.finalCash.median).toBeLessThan(12000);
  });

  it('naive play trails decent; spending everything usually goes bankrupt', () => {
    expect(naive.finalCash.median).toBeLessThan(decent.finalCash.median);
    expect(reckless.bankruptRate).toBeGreaterThan(0.4);
  });
});
