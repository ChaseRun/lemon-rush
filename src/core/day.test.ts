import { describe, expect, it } from 'vitest';
import type { DayOutcome, GameState, ServedRecord } from '../contract';
import { ITEMS } from '../contract';
import { DAILY_COST, DAY_LENGTH_MS, JUG_CAPACITY, PACKS, SEASON_DAYS } from './config';
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
    pouredOut: 0,
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
    expect(plan.dayLengthMs).toBe(DAY_LENGTH_MS);
    expect(plan).toEqual(planDay(state));
  });

  it('refuses to plan once the game is over', () => {
    expect(() => planDay(gameWith({ status: 'finished' }))).toThrow();
  });
});

describe('autoServe (jug rule)', () => {
  it('serves everyone on green when stock is plentiful; the unfinished jug is poured out', () => {
    const o = autoServe(planWith({ count: 5, inventory: stock(20), price: 2 }));
    expect(o.served).toHaveLength(5);
    expect(o.served.every((s) => s.bar === 'green' && s.paid === 2)).toBe(true);
    expect(o.served[0].tip).toBe(0.2); // jogger 10%
    expect(o).toMatchObject({ walkouts: 0, noRoom: 0, soldOutMisses: 0, soldOutAtMs: null, leftAtClose: 0 });
    // One full jug: 10 lemons + 10 sugar; 5 cups + 5 ice for the glasses actually served.
    expect(o.used).toEqual({ lemons: 10, sugar: 10, cups: 5, ice: 5 });
    expect(o.pouredOut).toBe(5);
  });

  it('uses lemons and sugar in jug-sized chunks, filling a fresh jug only when one is needed', () => {
    const o = autoServe(planWith({ count: 25, inventory: stock(50) }));
    expect(o.served).toHaveLength(25);
    expect(o.used).toEqual({ lemons: 30, sugar: 30, cups: 25, ice: 25 }); // 3 jugs
    expect(o.pouredOut).toBe(5);
    // Exactly two jugs' worth of customers: no third jug, nothing wasted.
    const exact = autoServe(planWith({ count: 20, inventory: stock(50) }));
    expect(exact.used).toEqual({ lemons: 20, sugar: 20, cups: 20, ice: 20 });
    expect(exact.pouredOut).toBe(0);
  });

  it('fills a partial jug when lemons or sugar run short', () => {
    const inventory = { lemons: 13, sugar: 30, ice: 30, cups: 30 };
    const plan = planWith({ count: 20, inventory });
    const o = autoServe(plan);
    expect(o.served).toHaveLength(13); // a jug of 10, then a jug of 3
    expect(o.used).toEqual({ lemons: 13, sugar: 13, cups: 13, ice: 13 });
    expect(o.pouredOut).toBe(0);
    expect(o.soldOutMisses).toBe(7);
    expect(o.soldOutAtMs).toBe(plan.arrivals[12].atMs);
  });

  it('never sells more than stock allows and counts the rest as sold-out misses', () => {
    const inventory = { lemons: 9, sugar: 4, ice: 30, cups: 12 };
    const plan = planWith({ count: 10, inventory });
    const o = autoServe(plan);
    expect(o.served.map((s) => s.arrivalId)).toEqual([0, 1, 2, 3]);
    expect(o.soldOutMisses).toBe(6);
    expect(o.soldOutAtMs).toBe(plan.arrivals[3].atMs);
    expect(o.used).toEqual(stock(4));
    expect(o.pouredOut).toBe(0);
  });

  it('selling out on cups with lemonade left in the jug pours it out', () => {
    const plan = planWith({ count: 10, inventory: { lemons: 20, sugar: 20, ice: 20, cups: 3 } });
    const o = autoServe(plan);
    expect(o.served).toHaveLength(3);
    expect(o.soldOutMisses).toBe(7);
    expect(o.soldOutAtMs).toBe(plan.arrivals[2].atMs);
    expect(o.used).toEqual({ lemons: 10, sugar: 10, cups: 3, ice: 3 });
    expect(o.pouredOut).toBe(7);
  });

  it('selling out on ice works the same way', () => {
    const o = autoServe(planWith({ count: 10, inventory: { lemons: 20, sugar: 20, ice: 4, cups: 20 } }));
    expect(o.served).toHaveLength(4);
    expect(o.pouredOut).toBe(6);
  });

  it('opening unable to make a glass: everyone is a sold-out miss from 9am and nothing is used', () => {
    for (const inventory of [stock(0), { lemons: 20, sugar: 20, ice: 20, cups: 0 }, { lemons: 0, sugar: 20, ice: 20, cups: 20 }]) {
      const o = autoServe(planWith({ count: 3, inventory }));
      expect(o).toMatchObject({ served: [], soldOutMisses: 3, soldOutAtMs: 0, used: stock(0), pouredOut: 0 });
    }
  });

  it('a day with no customers fills no jug', () => {
    const o = autoServe(planWith({ count: 0, inventory: stock(20) }));
    expect(o).toMatchObject({ served: [], used: stock(0), pouredOut: 0, soldOutAtMs: null });
  });

  it('accounting always balances: lemons = sugar = filled, cups = ice = served, pouredOut = filled - served', () => {
    for (let lemons = 0; lemons <= 25; lemons += 3) {
      for (const cups of [0, 4, 11, 30]) {
        for (const count of [0, 7, 10, 23]) {
          const inventory = { lemons, sugar: 30, ice: 30, cups };
          const o = autoServe(planWith({ count, inventory }));
          const n = o.served.length;
          expect(o.used.lemons).toBe(o.used.sugar);
          expect(o.used.cups).toBe(n);
          expect(o.used.ice).toBe(n);
          expect(o.pouredOut).toBe(o.used.lemons - n);
          expect(o.pouredOut).toBeGreaterThanOrEqual(0);
          expect(o.pouredOut).toBeLessThan(JUG_CAPACITY);
          expect(n + o.soldOutMisses).toBe(count);
          for (const item of ITEMS) expect(o.used[item]).toBeLessThanOrEqual(inventory[item]);
        }
      }
    }
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
  it('cash adds up: new cash = cash + revenue + tips − daily cost; profit subtracts shopping and the daily cost', () => {
    expect(DAILY_COST.amount).toBe(2);
    const state = gameWith({ cash: 6.75, spentToday: 13.25, inventory: stock(25) });
    const { state: next, report } = close(state, outcome({ served: served(10, 'green', 2, 0.3) }));
    expect(report.revenue).toBe(20);
    expect(report.tips).toBe(3);
    expect(next.cash).toBe(27.75); // 6.75 + 20 + 3 − 2
    expect(report.cashAfter).toBe(27.75);
    expect(report.spent).toBe(15.25); // 13.25 shopping + 2 table rent
    expect(report.profit).toBe(7.75);
    expect(next.spentToday).toBe(0);
  });

  it('charges the daily cost even when the stand sells nothing', () => {
    const state = gameWith({ cash: 10, inventory: stock(5) });
    const { state: next, report } = close(state, outcome());
    expect(next.cash).toBe(8);
    expect(report.spent).toBe(2);
    expect(report.profit).toBe(-2);
  });

  it('the daily cost never takes cash below $0, and only what was charged is reported', () => {
    const state = gameWith({ cash: 0.5, inventory: stock(5) });
    const { state: next, report } = close(state, outcome());
    expect(next.cash).toBe(0);
    expect(report.spent).toBe(0.5);
    expect(report.cashAfter).toBeCloseTo(state.cash + report.profit, 2);
  });

  it('melts all ice; everything else carries over', () => {
    const state = gameWith({ inventory: { lemons: 30, sugar: 20, ice: 25, cups: 18 } });
    const { state: next, report } = close(state, outcome({ served: served(10) }));
    expect(next.inventory).toEqual({ lemons: 20, sugar: 10, ice: 0, cups: 8 });
    expect(report.iceMelted).toBe(15);
    expect(report.inventoryAfter).toEqual(next.inventory);
  });

  it('lemonade left in the jug is poured out: gone from stock and recorded in the report and history', () => {
    const state = gameWith({ inventory: stock(20), cash: 0 });
    const plan = { ...planDay(state), arrivals: planWith({ count: 5 }).arrivals };
    const o = autoServe(plan);
    const { state: next, report } = endDay(state, plan, o);
    expect(report.pouredOut).toBe(5);
    expect(next.history.at(-1)?.pouredOut).toBe(5);
    expect(report.glassesSold).toBe(5);
    expect(next.inventory).toEqual({ lemons: 10, sugar: 10, ice: 0, cups: 15 });
    expect(report.iceMelted).toBe(15);
  });

  it('copies leftAtClose from the outcome into the report', () => {
    const { report } = close(gameWith({ inventory: stock(5) }), outcome({ leftAtClose: 2 }));
    expect(report.leftAtClose).toBe(2);
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
      popularityBefore: state.popularity,
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
    const state = gameWith({ inventory: stock(20), cash: 30, popularity: 20 });
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
    // One sale that covers the table rent plus a small ice pack even during an Ice shortage (×2).
    const pay = DAILY_COST.amount + 2 * PACKS.ice[0].price;
    const { state: next } = close(state, outcome({ served: served(1, 'green', pay) }));
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
