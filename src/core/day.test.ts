import { describe, expect, it } from 'vitest';
import type { DayOutcome, GameState, ServedRecord } from '../contract';
import { SEASON_DAYS } from './config';
import { autoServe, endDay, planDay } from './day';
import { buy } from './shop';
import { setPrice } from './state';
import { arrival, gameWith, planWith, stock } from './testing';

function served(n: number, bar: ServedRecord['bar'] = 'green', paid = 2, tip = 0): ServedRecord[] {
  return Array.from({ length: n }, (_, i) => ({ arrivalId: i, type: 'jogger', paid, tip, bar, atMs: i * 1000 }));
}

function outcome(overrides: Partial<DayOutcome> = {}): DayOutcome {
  const s = overrides.served ?? [];
  return {
    served: s,
    walkouts: 0,
    noRoom: 0,
    soldOutMisses: 0,
    soldOutAtMs: null,
    leftAtClose: 0,
    used: stock(s.length),
    ...overrides,
  };
}

/** Runs endDay on a hand-built plan for the state's current day. */
function close(state: GameState, o: DayOutcome) {
  return endDay(state, planWith({ day: state.day, price: state.price, inventory: state.inventory }), o);
}

describe('planDay', () => {
  it("bundles today's weather, news, price, stock and arrivals", () => {
    let state = setPrice(gameWith({ cash: 50 }), 1.5);
    const r = buy(state, 'cups', 0);
    if (!r.ok) throw new Error(r.error);
    state = r.state;
    const plan = planDay(state);
    expect(plan.day).toBe(1);
    expect(plan.weather).toEqual(state.weather[0]);
    expect(plan.news).toEqual(state.news[0]);
    expect(plan.price).toBe(1.5);
    expect(plan.inventory).toEqual(state.inventory);
    expect(plan.inventory).not.toBe(state.inventory); // a snapshot, not a shared reference
    expect(plan.dayLengthMs).toBe(120_000);
    expect(plan).toEqual(planDay(state));
  });

  it('refuses to plan once the game is over', () => {
    expect(() => planDay(gameWith({ status: 'finished' }))).toThrow();
  });
});

describe('autoServe', () => {
  it('serves everyone on green when stock is plentiful', () => {
    const o = autoServe(planWith({ count: 5, inventory: stock(20), price: 2 }));
    expect(o.served).toHaveLength(5);
    expect(o.served.every((s) => s.bar === 'green' && s.paid === 2)).toBe(true);
    expect(o.served[0].tip).toBe(0.2); // jogger 10%
    expect(o).toMatchObject({ walkouts: 0, noRoom: 0, soldOutMisses: 0, soldOutAtMs: null, used: stock(5) });
  });

  it('never sells more than stock allows and counts the rest as sold-out misses', () => {
    const inventory = { lemons: 9, sugar: 4, ice: 30, cups: 12 };
    const plan = planWith({ count: 10, inventory });
    const o = autoServe(plan);
    expect(o.served.map((s) => s.arrivalId)).toEqual([0, 1, 2, 3]);
    expect(o.soldOutMisses).toBe(6);
    expect(o.soldOutAtMs).toBe(plan.arrivals[3].atMs);
    expect(o.used).toEqual(stock(4));
  });

  it('opening with no stock: everyone is a sold-out miss from 9am', () => {
    const o = autoServe(planWith({ count: 3, inventory: stock(0) }));
    expect(o).toMatchObject({ served: [], soldOutMisses: 3, soldOutAtMs: 0, used: stock(0) });
  });

  it('tips use each type’s rate', () => {
    const plan = planWith({
      price: 3,
      arrivals: [arrival(0, 'kid'), arrival(1, 'grandma'), arrival(2, 'worker')],
    });
    expect(autoServe(plan).served.map((s) => s.tip)).toEqual([0, 0.9, 0.45]);
  });
});

describe('endDay', () => {
  it('cash adds up: new cash = cash + revenue + tips; profit subtracts this morning’s spending', () => {
    const state = gameWith({ cash: 6.75, spentToday: 13.25, inventory: stock(25) });
    const { state: next, report } = close(state, outcome({ served: served(10, 'green', 2, 0.3) }));
    expect(report.revenue).toBe(20);
    expect(report.tips).toBe(3);
    expect(next.cash).toBe(29.75);
    expect(report.cashAfter).toBe(29.75);
    expect(report.spent).toBe(13.25);
    expect(report.profit).toBe(9.75);
    expect(next.spentToday).toBe(0);
  });

  it('melts all ice; everything else carries over', () => {
    const state = gameWith({ inventory: { lemons: 30, sugar: 20, ice: 25, cups: 18 } });
    const { state: next, report } = close(state, outcome({ served: served(10) }));
    expect(next.inventory).toEqual({ lemons: 20, sugar: 10, ice: 0, cups: 8 });
    expect(report.iceMelted).toBe(15);
    expect(report.inventoryAfter).toEqual(next.inventory);
  });

  it('stock never goes negative even if a simulator over-reports usage', () => {
    const state = gameWith({ inventory: stock(2) });
    const { state: next } = close(state, outcome({ served: served(2), used: stock(5) }));
    expect(next.inventory).toEqual(stock(0));
  });

  it('builds the report from the plan and outcome', () => {
    const state = gameWith({ inventory: stock(10), cash: 0 });
    const plan = planDay(state);
    const o = outcome({
      served: [...served(3, 'green'), ...served(2, 'yellow'), ...served(1, 'red')],
      walkouts: 2,
      noRoom: 1,
      soldOutMisses: 0,
    });
    const { report } = endDay(state, plan, o);
    expect(report).toMatchObject({
      day: 1,
      forecast: state.forecast[0],
      weather: plan.weather,
      news: plan.news,
      price: plan.price,
      passersby: plan.passersby,
      stopped: plan.arrivals.length,
      tooExpensive: plan.tooExpensive,
      servedByBar: { green: 3, yellow: 2, red: 1 },
      glassesSold: 6,
      walkouts: 2,
      noRoom: 1,
      popularityBefore: 20,
    });
    expect(report.serviceRating).toBeCloseTo((3 * 1 + 2 * 0.7 + 1 * 0.4 + 1 * 0.3) / 9);
  });

  it('advances to the next morning with a fresh forecast and a history entry', () => {
    const state = gameWith({ inventory: stock(10), cash: 30 });
    const { state: next, report } = close(state, outcome({ served: served(5) }));
    expect(next.day).toBe(2);
    expect(next.forecast.map((f) => f.day)).toEqual([2, 3, 4]);
    expect(next.history).toEqual([report]);
    expect(next.status).toBe('playing');
    expect(next.popularity).toBe(report.popularityAfter);
  });

  it('good service raises popularity, bad service lowers it', () => {
    const state = gameWith({ inventory: stock(20), cash: 30 });
    const good = close(state, outcome({ served: served(10, 'green') })).state.popularity;
    const bad = close(state, outcome({ served: served(2, 'red'), walkouts: 8 })).state.popularity;
    expect(good).toBeGreaterThan(20);
    expect(bad).toBeLessThan(20);
  });

  it('goes bankrupt when it can’t restock, and the report still records the day', () => {
    // Sold nothing, $0, and all ice melts → can't buy ice tomorrow.
    const state = gameWith({ inventory: stock(5), cash: 0 });
    const { state: next, report } = close(state, outcome());
    expect(next.status).toBe('bankrupt');
    expect(next.history.at(-1)).toBe(report);
  });

  it('stays alive when the night’s takings cover a pack of ice', () => {
    const state = gameWith({ inventory: stock(5), cash: 0 });
    // $2 covers a small ice pack even during an Ice shortage.
    const { state: next } = close(state, outcome({ served: served(1, 'green', 2) }));
    expect(next.status).toBe('playing');
  });

  it('finishes after day 30 (season end wins over bankruptcy)', () => {
    const state = gameWith({ day: SEASON_DAYS, inventory: stock(0), cash: 0 });
    const { state: next } = close(state, outcome());
    expect(next.status).toBe('finished');
    expect(next.day).toBe(SEASON_DAYS + 1);
    expect(next.forecast).toEqual([]);
  });

  it('rejects a plan for a different day or a finished game', () => {
    const state = gameWith();
    expect(() => endDay(state, planWith({ day: 2 }), outcome())).toThrow();
    expect(() => endDay({ ...state, status: 'finished' }, planWith({ day: 1 }), outcome())).toThrow();
  });

  it('does not mutate its inputs', () => {
    const state = gameWith({ inventory: stock(10), cash: 5 });
    const snapshot = structuredClone(state);
    close(state, outcome({ served: served(3) }));
    expect(state).toEqual(snapshot);
  });
});
