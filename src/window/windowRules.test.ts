import { describe, expect, it } from 'vitest';
import type { Arrival, CustomerTypeId, DayOutcome, DayPlan, Inventory } from '../contract';
import { fixturePlan } from '../fixtures';
import { WINDOW_CONFIG, windowConfig } from './windowConfig';
import {
  type WindowAction,
  type WindowInput,
  type WindowRushState,
  barFor,
  freeForGlass,
  createWindowRush,
  endDayEarly,
  gradeJug,
  gradePour,
  gradeSqueeze,
  gradeStir,
  gradeSugar,
  isOver,
  step,
  tipFor,
  toOutcome,
} from './windowRules';

// ---------- helpers ----------

const C = WINDOW_CONFIG;
const DAY = 120_000;

function arrival(id: number, atMs: number, over: Partial<Arrival> = {}): Arrival {
  return { id, atMs, type: 'grandma', maxPay: 3, patienceMs: 25_000, tipRate: 0.3, ...over };
}

function plan(over: Partial<DayPlan> = {}): DayPlan {
  return {
    ...fixturePlan,
    price: 2,
    inventory: { lemons: 20, sugar: 20, ice: 20, cups: 20 },
    arrivals: [],
    dayLengthMs: DAY,
    ...over,
  };
}

const idle: WindowInput = { space: false };
const act = (...actions: WindowAction[]): WindowInput => ({ space: false, actions });

/** Advance with Space up, in 50ms frames. */
function wait(s: WindowRushState, ms: number): WindowRushState {
  let t = 0;
  while (t < ms && !isOver(s)) {
    const dt = Math.min(50, ms - t);
    s = step(s, dt, idle);
    t += dt;
  }
  return s;
}

/** Hold Space for `ms` (in 10ms frames), then release with a 0ms step. */
function hold(s: WindowRushState, ms: number): WindowRushState {
  let t = 0;
  while (t < ms && !isOver(s)) {
    const dt = Math.min(10, ms - t);
    s = step(s, dt, { space: true });
    t += dt;
  }
  return step(s, 0, idle);
}

/** `n` Space taps, `gapMs` apart (press for one 0ms frame, release, wait). */
function taps(s: WindowRushState, n: number, gapMs: number): WindowRushState {
  for (let i = 0; i < n && !isOver(s); i++) {
    s = step(s, i === 0 ? 0 : gapMs, { space: true });
    s = step(s, 0, idle);
  }
  return s;
}

function stir(s: WindowRushState, n: number, gapMs: number): WindowRushState {
  for (let i = 0; i < n && !isOver(s); i++) {
    if (i > 0) s = step(s, gapMs, idle);
    s = step(s, 0, act({ type: 'stir', dir: i % 2 ? 'right' : 'left' }));
  }
  return s;
}

/** Make a whole jug with Perfect grades on every step. */
function perfectJug(s: WindowRushState): WindowRushState {
  s = step(s, 0, act({ type: 'lemons' }));
  s = taps(s, C.squeeze.taps, 100);
  s = step(s, 0, act({ type: 'sugar' }));
  const m = s.jug.making;
  if (m?.kind !== 'sugar') throw new Error('expected sugar step');
  s = hold(s, Math.round(m.center / C.sugar.ratePerMs));
  return stir(s, C.stir.strokes, 100);
}

/** Make a jug with OK grades on every step (slow squeeze, sugar way off, lazy stir). */
function okJug(s: WindowRushState): WindowRushState {
  s = step(s, 0, act({ type: 'lemons' }));
  s = taps(s, 3, 100);
  s = wait(s, C.squeeze.windowMs);
  s = step(s, 0, act({ type: 'sugar' }));
  s = hold(s, 50);
  s = stir(s, 2, 100);
  return wait(s, C.stir.limitMs);
}

/** Place a glass, ice it, and pour into the middle of the band (or for `pourMs`). */
function glass(s: WindowRushState, pourMs = Math.round(((C.pour.lowerLine + C.pour.upperLine) / 2) / C.pour.ratePerMs)) {
  s = step(s, 0, act({ type: 'cup' }, { type: 'ice' }));
  return hold(s, pourMs);
}

function checkInvariants(p: DayPlan, o: DayOutcome) {
  const accounted = o.served.length + o.walkouts + o.noRoom + o.soldOutMisses + o.leftAtClose;
  expect(accounted).toBe(p.arrivals.length);
  expect(o.used.lemons).toBe(o.used.sugar);
  expect(o.used.cups).toBe(o.used.ice);
  for (const k of Object.keys(o.used) as (keyof Inventory)[]) {
    expect(o.used[k]).toBeGreaterThanOrEqual(0);
    expect(o.used[k]).toBeLessThanOrEqual(p.inventory[k]);
  }
  // Every glass's worth ever made was either served or poured out (spills included).
  expect(o.used.lemons).toBe(o.served.length + o.pouredOut);
  expect(new Set(o.served.map((r) => r.arrivalId)).size).toBe(o.served.length);
  for (const r of o.served) {
    expect(r.paid).toBe(p.price);
    expect(r.tip).toBeGreaterThanOrEqual(0);
  }
}

// ---------- grading ----------

describe('grading functions', () => {
  it('bar colors: green above 60%, yellow 30–60%, red below 30%', () => {
    expect(barFor(1)).toBe('green');
    expect(barFor(0.61)).toBe('green');
    expect(barFor(0.6)).toBe('yellow');
    expect(barFor(0.3)).toBe('yellow');
    expect(barFor(0.29)).toBe('red');
    expect(barFor(0)).toBe('red');
  });

  it('squeeze: full fast = Perfect, full in the window = Good, short or slow = OK', () => {
    const { taps: n, perfectMs, windowMs } = C.squeeze;
    expect(gradeSqueeze(n, perfectMs)).toBe('perfect');
    expect(gradeSqueeze(n, perfectMs + 1)).toBe('good');
    expect(gradeSqueeze(n, windowMs)).toBe('good');
    expect(gradeSqueeze(n, windowMs + 1)).toBe('ok');
    expect(gradeSqueeze(n - 1, 500)).toBe('ok');
  });

  it('sugar: near the band center = Perfect, inside the band = Good, outside = OK', () => {
    const c = 0.6;
    expect(gradeSugar(c, c)).toBe('perfect');
    expect(gradeSugar(c + C.sugar.perfectTol, c)).toBe('perfect');
    expect(gradeSugar(c - C.sugar.perfectTol - 0.001, c)).toBe('good');
    expect(gradeSugar(c + C.sugar.bandHalf, c)).toBe('good');
    expect(gradeSugar(c + C.sugar.bandHalf + 0.001, c)).toBe('ok');
    expect(gradeSugar(0, c)).toBe('ok');
  });

  it('stir: all strokes fast = Perfect, slower = Good, slowest or unfinished = OK', () => {
    const { strokes, perfectMs, goodMs } = C.stir;
    expect(gradeStir(strokes, perfectMs)).toBe('perfect');
    expect(gradeStir(strokes, perfectMs + 1)).toBe('good');
    expect(gradeStir(strokes, goodMs)).toBe('good');
    expect(gradeStir(strokes, goodMs + 1)).toBe('ok');
    expect(gradeStir(strokes - 1, 100)).toBe('ok');
  });

  it('pour: inside the band = perfect, under the lower line = under, over the upper line = spill', () => {
    expect(gradePour(C.pour.lowerLine)).toBe('perfect');
    expect(gradePour(C.pour.upperLine)).toBe('perfect');
    expect(gradePour(C.pour.lowerLine - 0.01)).toBe('under');
    expect(gradePour(0.05)).toBe('under');
    expect(gradePour(C.pour.upperLine + 0.001)).toBe('spill');
  });

  it('jug quality combines the three grades', () => {
    expect(gradeJug('perfect', 'perfect', 'perfect')).toBe('perfect');
    expect(gradeJug('perfect', 'perfect', 'good')).toBe('perfect');
    expect(gradeJug('perfect', 'good', 'good')).toBe('good');
    expect(gradeJug('good', 'good', 'good')).toBe('good');
    expect(gradeJug('good', 'good', 'ok')).toBe('ok');
    expect(gradeJug('ok', 'ok', 'ok')).toBe('ok');
  });

  it('tip multiplies price × rate × bar × pour × jug', () => {
    expect(tipFor(2, 0.3, 'green', 'perfect', 'good')).toBe(0.6);
    expect(tipFor(2, 0.3, 'yellow', 'perfect', 'good')).toBe(0.3);
    expect(tipFor(2, 0.3, 'red', 'perfect', 'perfect')).toBe(0);
    expect(tipFor(2, 0.3, 'green', 'under', 'good')).toBe(0.3);
    expect(tipFor(2, 0.3, 'green', 'perfect', 'perfect')).toBe(0.75);
    expect(tipFor(2, 0.3, 'green', 'perfect', 'ok')).toBe(0.48);
    expect(tipFor(2, 0.3, 'yellow', 'under', 'perfect')).toBe(0.19); // 0.1875 → cents
    expect(tipFor(2, 0.1, 'yellow', 'perfect', 'perfect')).toBe(0.13); // 0.125, despite float noise
  });
});

// ---------- the jug ----------

describe('making a jug', () => {
  it('uses lemons + sugar immediately and holds min(10, lemons, sugar)', () => {
    let s = createWindowRush(plan());
    s = step(s, 0, act({ type: 'lemons' }));
    expect(s.jug.glasses).toBe(10);
    expect(s.used).toEqual({ lemons: 10, sugar: 10, ice: 0, cups: 0 });
    expect(s.jug.making?.kind).toBe('squeeze');

    let t = createWindowRush(plan({ inventory: { lemons: 4, sugar: 7, ice: 9, cups: 9 } }));
    t = step(t, 0, act({ type: 'lemons' }));
    expect(t.jug.glasses).toBe(4);
    expect(t.used.lemons).toBe(4);
    expect(t.used.sugar).toBe(4);
  });

  it("can't be made with no lemons or no sugar (and then the stand is sold out)", () => {
    const noLemons = createWindowRush(plan({ inventory: { lemons: 0, sugar: 9, ice: 9, cups: 9 } }));
    expect(isOver(noLemons)).toBe(true);
    expect(noLemons.used.sugar).toBe(0);
    const noSugar = createWindowRush(plan({ inventory: { lemons: 9, sugar: 0, ice: 9, cups: 9 } }));
    expect(isOver(noSugar)).toBe(true);
  });

  it("can't start a second jug while the first has lemonade", () => {
    let s = perfectJug(createWindowRush(plan()));
    s = step(s, 0, act({ type: 'lemons' }));
    expect(s.used.lemons).toBe(10);
    expect(s.events).toContainEqual({ type: 'blocked', reason: 'Jug still has lemonade' });
  });

  it('runs squeeze → sugar → stir and grades a Perfect jug', () => {
    const s = perfectJug(createWindowRush(plan()));
    expect(s.jug.making).toBeNull();
    expect(s.jug.quality).toBe('perfect');
    expect(s.jug.glasses).toBe(10);
  });

  it('sloppy play still finishes the jug, graded OK', () => {
    const s = okJug(createWindowRush(plan()));
    expect(s.jug.making).toBeNull();
    expect(s.jug.quality).toBe('ok');
  });

  it('sugar needs the sugar bag clicked, then a fresh Space press', () => {
    let s = step(createWindowRush(plan()), 0, act({ type: 'lemons' }));
    s = taps(s, C.squeeze.taps, 100);
    expect(s.jug.making?.kind).toBe('sugarReady');
    s = step(s, 500, { space: true }); // mashing Space does nothing yet
    expect(s.jug.making?.kind).toBe('sugarReady');
    s = step(s, 0, { space: true, actions: [{ type: 'sugar' }] });
    s = step(s, 500, { space: true }); // still held from before: not a fresh press
    expect(s.jug.making?.kind === 'sugar' && s.jug.making.level).toBe(0);
  });

  it('stir strokes only count when the direction changes', () => {
    let s = step(createWindowRush(plan()), 0, act({ type: 'lemons' }));
    s = taps(s, C.squeeze.taps, 100);
    s = step(s, 0, act({ type: 'sugar' }));
    s = hold(s, 200);
    s = step(s, 0, act({ type: 'stir', dir: 'left' }, { type: 'stir', dir: 'left' }, { type: 'stir', dir: 'right' }));
    expect(s.jug.making?.kind === 'stir' && s.jug.making.strokes).toBe(2);
  });
});

// ---------- glasses ----------

describe('glasses', () => {
  it('a glass needs a free cup and ice, and placing one reserves them', () => {
    expect(isOver(createWindowRush(plan({ inventory: { lemons: 5, sugar: 5, ice: 5, cups: 0 } })))).toBe(true);
    expect(isOver(createWindowRush(plan({ inventory: { lemons: 5, sugar: 5, ice: 0, cups: 5 } })))).toBe(true);
    let s = createWindowRush(plan({ inventory: { lemons: 5, sugar: 5, ice: 1, cups: 5 } }));
    s = step(s, 0, act({ type: 'cup' }));
    expect(s.glass).not.toBeNull();
    expect(freeForGlass(s)).toEqual({ cups: 4, ice: 0 });
    expect(s.used.cups).toBe(0); // placing only reserves
    s = step(s, 0, act({ type: 'cup' }));
    expect(s.events).toContainEqual({ type: 'blocked', reason: 'One glass at a time' });
  });

  it('ice needs a placed glass', () => {
    const s = step(createWindowRush(plan()), 0, act({ type: 'ice' }));
    expect(s.events).toContainEqual({ type: 'blocked', reason: 'Place a cup first' });
  });

  it("pouring needs ice in the glass and a finished jug", () => {
    let s = createWindowRush(plan());
    s = step(s, 0, act({ type: 'cup' }));
    s = perfectJug(s);
    s = hold(s, 700); // no ice yet: nothing pours
    expect(s.glass?.phase).toBe('empty');
    expect(s.jug.glasses).toBe(10);
    s = step(s, 0, act({ type: 'ice' }));
    s = hold(s, 700);
    expect(s.glass?.phase).toBe('poured');
    expect(s.jug.glasses).toBe(9);
  });

  it('spill wastes the cup, the ice, and the glass of lemonade', () => {
    let s = perfectJug(createWindowRush(plan()));
    s = glass(s, 1500); // held well past the upper line
    expect(s.glass).toBeNull();
    expect(s.spilled).toBe(1);
    expect(s.pouredOut).toBe(1);
    expect(s.jug.glasses).toBe(9);
    expect(s.used).toEqual({ lemons: 10, sugar: 10, ice: 1, cups: 1 });
  });

  it('underfill is accepted at half tip', () => {
    let s = createWindowRush(plan({ arrivals: [arrival(0, 0)] }));
    s = perfectJug(s);
    s = glass(s, 300);
    expect(s.glass?.pour).toBe('under');
    s = step(s, 0, act({ type: 'handOver' }));
    // 2 × 0.3 × green 1 × under 0.5 × perfect jug 1.25 = 0.375 → 0.38
    expect(s.served[0].tip).toBe(0.38);
  });
});

// ---------- serving ----------

describe('hand-over', () => {
  it('uses 1 cup + 1 ice and pays price + tip with every multiplier', () => {
    let s = createWindowRush(plan({ arrivals: [arrival(7, 0)] }));
    s = perfectJug(s);
    s = glass(s);
    s = step(s, 0, act({ type: 'handOver' }));
    expect(s.used).toEqual({ lemons: 10, sugar: 10, ice: 1, cups: 1 });
    expect(s.served).toHaveLength(1);
    const r = s.served[0];
    expect(r).toMatchObject({ arrivalId: 7, type: 'grandma', paid: 2, bar: 'green' });
    expect(r.tip).toBe(0.75); // 2 × 0.3 × 1 × 1 × 1.25
    expect(s.earned).toBe(2.75);
    expect(s.line).toHaveLength(0);
  });

  it('bar color at hand-over sets the tip (yellow halves it, red zeroes it)', () => {
    const patienceMs = 30_000;
    let s = createWindowRush(plan({ arrivals: [arrival(0, 0, { patienceMs }), arrival(1, 0, { patienceMs: 100_000 })] }));
    s = okJug(s); // OK jug: ×0.8
    s = glass(s);
    s = wait(s, patienceMs * 0.5 - s.timeMs); // 50% left → yellow
    s = step(s, 0, act({ type: 'handOver' }));
    expect(s.served[0].bar).toBe('yellow');
    expect(s.served[0].tip).toBe(0.24); // 2 × 0.3 × 0.5 × 1 × 0.8
    s = glass(s);
    s = wait(s, 80_000 - s.timeMs); // customer 1: 20% left → red
    s = step(s, 0, act({ type: 'handOver' }));
    expect(s.served[1].bar).toBe('red');
    expect(s.served[1].tip).toBe(0);
    expect(s.served[1].paid).toBe(2);
  });

  it("can't hand over an unpoured glass or to an empty window", () => {
    let s = perfectJug(createWindowRush(plan()));
    s = step(s, 0, act({ type: 'handOver' }));
    expect(s.events).toContainEqual({ type: 'blocked', reason: 'No glass ready' });
    s = glass(s);
    s = step(s, 0, act({ type: 'handOver' }));
    expect(s.events).toContainEqual({ type: 'blocked', reason: 'Nobody at the window' });
    expect(s.used.cups).toBe(0);
  });

  it('serves the person at the window; the next one steps up', () => {
    let s = createWindowRush(plan({ arrivals: [arrival(0, 0), arrival(1, 100)] }));
    s = perfectJug(s);
    s = glass(s);
    s = step(s, 0, act({ type: 'handOver' }));
    expect(s.served[0].arrivalId).toBe(0);
    expect(s.line.map((c) => c.arrival.id)).toEqual([1]);
  });
});

// ---------- the line ----------

describe('the line', () => {
  it('an arrival who finds the line full leaves (noRoom)', () => {
    const arrivals = Array.from({ length: C.maxLine + 2 }, (_, i) => arrival(i, 1000 + i));
    let s = createWindowRush(plan({ arrivals }));
    s = wait(s, 2000);
    expect(s.line).toHaveLength(C.maxLine);
    expect(s.noRoom).toBe(2);
  });

  it('line length is a config number', () => {
    const arrivals = Array.from({ length: 5 }, (_, i) => arrival(i, 1000 + i));
    const s = wait(createWindowRush(plan({ arrivals }), windowConfig({ maxLine: 2 })), 2000);
    expect(s.line).toHaveLength(2);
    expect(s.noRoom).toBe(3);
  });

  it('runs out of patience → walkout, no payment, no stock used', () => {
    let s = createWindowRush(plan({ arrivals: [arrival(0, 1000, { patienceMs: 5000 })] }));
    s = wait(s, 5999);
    expect(s.line).toHaveLength(1);
    s = wait(s, 1);
    expect(s.line).toHaveLength(0);
    expect(s.walkouts).toBe(1);
    expect(s.used).toEqual({ lemons: 0, sugar: 0, ice: 0, cups: 0 });
    expect(s.served).toHaveLength(0);
  });

  it('a walkout frees room for someone arriving at the same moment', () => {
    const arrivals = [
      ...Array.from({ length: C.maxLine }, (_, i) => arrival(i, 0, { patienceMs: 3000 })),
      arrival(99, 3000),
    ];
    const s = wait(createWindowRush(plan({ arrivals })), 3000);
    expect(s.walkouts).toBe(C.maxLine);
    expect(s.noRoom).toBe(0);
    expect(s.line.map((c) => c.arrival.id)).toEqual([99]);
  });

  it('with 2 windows, the second customer can be served too', () => {
    let s = createWindowRush(plan({ arrivals: [arrival(0, 0), arrival(1, 0)] }), windowConfig({ windows: 2 }));
    s = perfectJug(s);
    s = glass(s);
    s = step(s, 0, act({ type: 'handOver', window: 1 }));
    expect(s.served[0].arrivalId).toBe(1);
  });
});

// ---------- day end ----------

describe('day end', () => {
  it('at closing, people in line leave (leftAtClose) and leftover lemonade is poured out', () => {
    let s = createWindowRush(plan({ arrivals: [arrival(0, 0), arrival(1, DAY - 1000), arrival(2, DAY)] }));
    s = perfectJug(s);
    s = glass(s);
    s = step(s, 0, act({ type: 'handOver' }));
    s = step(s, 0, act({ type: 'cup' }, { type: 'ice' }));
    s = step(s, 10, { space: true }); // a glass mid-pour at closing
    s = wait(s, DAY);
    expect(isOver(s)).toBe(true);
    expect(s.endReason).toBe('closed');
    const o = toOutcome(s);
    expect(o.leftAtClose).toBe(2);
    expect(o.walkouts).toBe(0);
    expect(o.pouredOut).toBe(9); // 8 in the jug + 1 in the glass
    expect(o.used).toEqual({ lemons: 10, sugar: 10, ice: 1, cups: 1 }); // unfinished glass's cup + ice released
    expect(o.soldOutAtMs).toBeNull();
    checkInvariants(s.plan, o);
  });

  it('an empty placed glass at closing just goes back to stock', () => {
    let s = createWindowRush(plan());
    s = step(s, 0, act({ type: 'cup' }, { type: 'ice' }));
    s = wait(s, DAY);
    expect(toOutcome(s).used).toEqual({ lemons: 0, sugar: 0, ice: 0, cups: 0 });
    expect(toOutcome(s).pouredOut).toBe(0);
  });

  it('sold out when the jug is empty and lemons run out', () => {
    const arrivals = [arrival(0, 0), arrival(1, 0), arrival(2, 0), arrival(3, 50_000)];
    let s = createWindowRush(plan({ arrivals, inventory: { lemons: 1, sugar: 5, ice: 5, cups: 5 } }));
    s = perfectJug(s);
    expect(s.jug.glasses).toBe(1);
    s = glass(s);
    expect(isOver(s)).toBe(false); // a glass with lemonade is still in progress
    s = step(s, 0, act({ type: 'handOver' }));
    expect(isOver(s)).toBe(true);
    const o = toOutcome(s);
    expect(o.soldOutAtMs).toBe(s.timeMs);
    expect(o.served).toHaveLength(1);
    expect(o.soldOutMisses).toBe(3); // 2 waiting + 1 not yet arrived
    checkInvariants(s.plan, o);
  });

  it('sold out when no cup or ice is left, pouring out the jug', () => {
    let s = createWindowRush(plan({ arrivals: [arrival(0, 0), arrival(1, 0)], inventory: { lemons: 5, sugar: 5, ice: 1, cups: 5 } }));
    s = perfectJug(s);
    s = glass(s, 2000); // spill uses the only ice
    expect(isOver(s)).toBe(true);
    const o = toOutcome(s);
    expect(o.soldOutMisses).toBe(2);
    expect(o.pouredOut).toBe(5); // 1 spilled + 4 left in the jug
    expect(o.used).toEqual({ lemons: 5, sugar: 5, ice: 1, cups: 1 });
    checkInvariants(s.plan, o);
  });
});

describe('end the day now (pause menu)', () => {
  it('closes at the current clock like 5pm: line + not-yet-arrived → leftAtClose', () => {
    const arrivals = [arrival(0, 0), arrival(1, 1000), arrival(2, 1500), arrival(3, 60_000), arrival(4, 90_000)];
    let s = createWindowRush(plan({ arrivals }));
    s = perfectJug(s);
    s = glass(s);
    s = step(s, 0, act({ type: 'handOver' })); // serve #0
    s = wait(s, 2000);
    const ended = endDayEarly(s);
    expect(isOver(ended)).toBe(true);
    expect(ended.endReason).toBe('closed');
    expect(ended.timeMs).toBe(s.timeMs);
    const o = toOutcome(ended);
    expect(o.served).toHaveLength(1);
    expect(o.leftAtClose).toBe(4); // 2 waiting + 2 not yet arrived
    expect(o.walkouts + o.noRoom + o.soldOutMisses).toBe(0);
    expect(o.soldOutAtMs).toBeNull();
    checkInvariants(s.plan, o);
  });

  it('after a fill: jug + an unfinished glass are poured out, the glass cup + ice released', () => {
    let s = createWindowRush(plan({ arrivals: [arrival(0, 0)] }));
    s = perfectJug(s);
    s = step(s, 0, act({ type: 'cup' }, { type: 'ice' }));
    s = step(s, 100, { space: true }); // mid-pour
    const o = toOutcome(endDayEarly(s));
    expect(o.pouredOut).toBe(10); // 9 in the jug + 1 in the glass
    expect(o.used).toEqual({ lemons: 10, sugar: 10, ice: 0, cups: 0 });
    expect(o.leftAtClose).toBe(1);
    checkInvariants(s.plan, o);
  });

  it('abandons a jug mini-game in progress (its lemons + sugar were already used)', () => {
    let s = createWindowRush(plan({ inventory: { lemons: 6, sugar: 8, ice: 5, cups: 5 } }));
    s = step(s, 0, act({ type: 'lemons' }));
    s = taps(s, 3, 100);
    const ended = endDayEarly(s);
    expect(ended.jug).toEqual({ glasses: 0, quality: null, making: null });
    expect(toOutcome(ended)).toMatchObject({ pouredOut: 6, used: { lemons: 6, sugar: 6, ice: 0, cups: 0 } });
  });

  it('does not mutate its input, and is a no-op once the day is over', () => {
    let s = createWindowRush(plan({ arrivals: [arrival(0, 0)] }));
    s = perfectJug(s);
    s = wait(s, 500);
    const snapshot = JSON.stringify(s);
    const ended = endDayEarly(s);
    expect(JSON.stringify(s)).toBe(snapshot);
    expect(ended).not.toBe(s);
    expect(endDayEarly(ended)).toBe(ended);
    const closed = wait(createWindowRush(plan()), DAY);
    expect(endDayEarly(closed)).toBe(closed);
    expect(step(ended, 1000, { space: true, actions: [{ type: 'lemons' }] }).timeMs).toBe(ended.timeMs);
  });
});

// ---------- determinism + fuzz ----------

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPES: CustomerTypeId[] = ['kid', 'jogger', 'grandma', 'worker'];

function randomPlan(r: () => number): DayPlan {
  const n = Math.floor(r() * 40);
  const dayLengthMs = 30_000 + Math.floor(r() * 90_000);
  const arrivals = Array.from({ length: n }, (_, i) => ({
    id: i,
    atMs: Math.floor(r() * dayLengthMs),
    type: TYPES[Math.floor(r() * 4)],
    maxPay: 3,
    patienceMs: 2000 + Math.floor(r() * 25_000),
    tipRate: Math.floor(r() * 4) / 10,
  })).sort((a, b) => a.atMs - b.atMs);
  const stock = () => Math.floor(r() * 25);
  return plan({ arrivals, dayLengthMs, price: 0.5 + Math.floor(r() * 10) / 2, inventory: { lemons: stock(), sugar: stock(), ice: stock(), cups: stock() } });
}

const ACTIONS: WindowAction[] = [
  { type: 'lemons' },
  { type: 'sugar' },
  { type: 'ice' },
  { type: 'cup' },
  { type: 'handOver' },
  { type: 'stir', dir: 'left' },
  { type: 'stir', dir: 'right' },
];

type Script = { dt: number; input: WindowInput }[];

function randomScript(r: () => number, len: number): Script {
  return Array.from({ length: len }, () => ({
    dt: Math.floor(r() * 120),
    input: { space: r() < 0.45, actions: r() < 0.4 ? [ACTIONS[Math.floor(r() * ACTIONS.length)]] : [] },
  }));
}

function play(p: DayPlan, script: Script, endEarly = false): WindowRushState {
  let s = createWindowRush(p);
  for (const { dt, input } of script) {
    if (isOver(s)) break;
    s = step(s, dt, input);
  }
  if (endEarly) s = endDayEarly(s);
  // Let the day run out.
  while (!isOver(s)) s = step(s, 1000, idle);
  return s;
}

describe('determinism', () => {
  it('same plan + same input script → same outcome', () => {
    const r = rng(42);
    const p = randomPlan(r);
    const script = randomScript(r, 3000);
    expect(toOutcome(play(p, script))).toEqual(toOutcome(play(p, script)));
    expect(toOutcome(play(fixturePlan, script))).toEqual(toOutcome(play(fixturePlan, script)));
  });

  it('step never mutates its input state', () => {
    const s0 = createWindowRush(plan({ arrivals: [arrival(0, 0)] }));
    const snapshot = JSON.stringify(s0);
    step(s0, 500, act({ type: 'lemons' }, { type: 'cup' }));
    expect(JSON.stringify(s0)).toBe(snapshot);
  });
});

describe('fuzz: DayOutcome invariants hold for random plans and inputs', () => {
  it('300 random days', () => {
    const r = rng(7);
    let servedSomewhere = 0;
    for (let i = 0; i < 300; i++) {
      const p = randomPlan(r);
      const s = play(p, randomScript(r, 1 + Math.floor(r() * 2500)), i % 4 === 0); // every 4th day ends early
      const o = toOutcome(s);
      checkInvariants(p, o);
      servedSomewhere += o.served.length;
      if (o.soldOutAtMs !== null) expect(o.leftAtClose).toBe(0);
    }
    expect(servedSomewhere).toBeGreaterThan(0); // the fuzzer actually reaches serves
  });

  it('a competent scripted player serves the fixture day cleanly', () => {
    let s = createWindowRush(fixturePlan);
    while (!isOver(s)) {
      if (s.jug.glasses === 0 && !s.jug.making && !s.glass) s = perfectJug(s);
      else if (!s.glass && s.line.length > 0 && s.jug.glasses > 0) s = glass(s);
      else if (s.glass?.phase === 'poured' && s.line.length > 0) s = step(s, 0, act({ type: 'handOver' }));
      else s = step(s, 50, idle);
    }
    const o = toOutcome(s);
    checkInvariants(fixturePlan, o);
    expect(o.served.length).toBeGreaterThanOrEqual(15);
    expect(o.served.every((r) => r.bar === 'green')).toBe(true);
  });
});
