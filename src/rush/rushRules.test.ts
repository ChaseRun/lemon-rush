import { describe, expect, it } from 'vitest';
import type { Arrival, CustomerTypeId, DayPlan, Inventory } from '../contract';
import { ITEMS } from '../contract';
import { fixturePlan } from '../fixtures';
import { RUSH } from './rushConfig';
import {
  NO_INPUT,
  type RushInput,
  type RushState,
  atPrepStation,
  barFor,
  createRush,
  earned,
  isOver,
  spotInReach,
  step,
  stockLeft,
  taskProgress,
  tipFor,
  toOutcome,
  unreservedGlasses,
} from './rushRules';

// ---------- Test helpers: build plans and drive the rules with scripted keys ----------

/** Every helper advances time in 10ms frames, like a 100fps game loop. */
const FRAME = 10;

const stock = (n: number): Inventory => ({ lemons: n, sugar: n, ice: n, cups: n });

function arrival(id: number, atMs: number, over: Partial<Arrival> = {}): Arrival {
  return { id, atMs, type: 'jogger', maxPay: 3, patienceMs: 10_000, tipRate: 0.1, ...over };
}

function makePlan(arrivals: Arrival[], over: Partial<DayPlan> = {}): DayPlan {
  return {
    ...fixturePlan,
    price: 2,
    inventory: stock(10),
    arrivals,
    passersby: arrivals.length,
    dayLengthMs: 120_000,
    ...over,
  };
}

/** Hold the given keys for `ms`. */
function hold(s: RushState, ms: number, keys: Partial<RushInput> = {}): RushState {
  const input = { ...NO_INPUT, ...keys };
  for (let left = ms; left > 0; left -= FRAME) s = step(s, Math.min(FRAME, left), input);
  return s;
}

/** Let go of every key (no time passes). */
const release = (s: RushState) => step(s, 0, NO_INPUT);
/** Press Space (no time passes). */
const press = (s: RushState) => step(s, 0, { ...NO_INPUT, space: true });

/** Walk (no Space) until the kid stands on x. 0.5 px/ms × 10ms = 5px a frame, so the layout is hit exactly. */
function walkTo(s: RushState, x: number): RushState {
  for (let i = 0; i < 1_000 && Math.abs(s.kidX - x) > 1e-9; i++) {
    s = step(s, FRAME, { ...NO_INPUT, left: x < s.kidX, right: x > s.kidX });
  }
  return s;
}

/** Walk to the prep station and hold Space for exactly prepMs. */
function makeGlass(s: RushState): RushState {
  return hold(walkTo(s, RUSH.prepX), RUSH.prepMs, { space: true });
}

/** Walk to a spot, press Space, and wait out the serve lock. */
function serve(s: RushState, spot: number): RushState {
  return hold(press(release(walkTo(s, RUSH.spotX[spot]))), RUSH.serveMs);
}

/** A simple competent player: make a glass, carry it to the least patient customer, repeat. */
function bot(s: RushState): RushInput {
  if (s.task.kind === 'serving') return NO_INPUT;
  const goTo = (x: number): RushInput => ({ left: x < s.kidX, right: x > s.kidX, space: false });
  if (!s.holdingGlass) return atPrepStation(s) ? { ...NO_INPUT, space: true } : goTo(RUSH.prepX);
  let target = -1;
  s.spots.forEach((c, i) => {
    if (c && (target === -1 || c.patienceLeftMs < s.spots[target]!.patienceLeftMs)) target = i;
  });
  if (target === -1) return NO_INPUT;
  if (spotInReach(s) === target) return { ...NO_INPUT, space: !s.spaceWasDown };
  return goTo(RUSH.spotX[target]);
}

function play(
  plan: DayPlan,
  policy: (s: RushState, frame: number) => RushInput,
  frameMs: (frame: number) => number = () => 16,
  beforeStep: (s: RushState) => void = () => {},
): RushState {
  let s = createRush(plan);
  for (let i = 0; !isOver(s); i++) {
    if (i > 200_000) throw new Error('the Rush never ended');
    beforeStep(s);
    s = step(s, frameMs(i), policy(s, i));
  }
  return s;
}

/** Seeded PRNG for the fuzz tests only (the rules themselves use no randomness). */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/** Things that must hold at the end of any Rush, whatever the player did. */
function expectInvariants(s: RushState) {
  const o = toOutcome(s);
  const n = o.served.length;
  expect(o.used).toEqual(stock(n));
  for (const item of ITEMS) expect(stockLeft(s)[item]).toBeGreaterThanOrEqual(0);
  // Every arrival is accounted for exactly once.
  expect(n + o.walkouts + o.noRoom + o.soldOutMisses + s.leftAtClose).toBe(s.plan.arrivals.length);
  expect(new Set(o.served.map((r) => r.arrivalId)).size).toBe(n);
  for (const r of o.served) {
    expect(r.paid).toBe(s.plan.price);
    expect(r.tip).toBeGreaterThanOrEqual(0);
    expect(r.atMs).toBeLessThanOrEqual(s.plan.dayLengthMs);
  }
  expect(o.soldOutAtMs !== null).toBe(s.phase === 'soldOut');
  expect(s.clockMs).toBeLessThanOrEqual(s.plan.dayLengthMs);
}

// ---------- Tests ----------

describe('createRush', () => {
  it('opens at 9:00 with the kid at the prep station and the counter empty', () => {
    const s = createRush(makePlan([arrival(0, 5_000)]));
    expect(s).toMatchObject({ clockMs: 0, phase: 'open', kidX: RUSH.kidStartX, holdingGlass: false });
    expect(s.spots).toEqual([null, null, null]);
    expect(atPrepStation(s)).toBe(true);
  });

  it('opening with no stock is an immediate sell-out: every arrival is a sold-out miss', () => {
    const plan = makePlan([arrival(0, 0), arrival(1, 0), arrival(2, 0), arrival(3, 0), arrival(4, 500)], {
      inventory: { lemons: 3, sugar: 3, ice: 0, cups: 3 },
    });
    const s = createRush(plan);
    expect(isOver(s)).toBe(true);
    expect(toOutcome(s)).toEqual({
      served: [],
      walkouts: 0,
      noRoom: 0,
      soldOutMisses: 5,
      soldOutAtMs: 0,
      leftAtClose: 0,
      used: stock(0),
    });
  });
});

describe('moving', () => {
  it('walks at kidSpeedPxPerMs and stays between the far spot and the prep station', () => {
    let s = createRush(makePlan([]));
    s = hold(s, 1_000, { left: true });
    expect(s.kidX).toBe(RUSH.kidStartX - RUSH.kidSpeedPxPerMs * 1_000);
    s = hold(s, 5_000, { left: true });
    expect(s.kidX).toBe(RUSH.kidMinX);
    s = hold(s, 5_000, { right: true });
    expect(s.kidX).toBe(RUSH.kidMaxX);
    s = hold(s, 1_000, { left: true, right: true });
    expect(s.kidX).toBe(RUSH.kidMaxX);
  });
});

describe('arrivals and the counter', () => {
  it('each arrival appears at atMs and takes the first free spot (closest to the prep station)', () => {
    let s = createRush(makePlan([arrival(10, 0), arrival(11, 500)]));
    expect(s.spots.map((c) => c?.arrival.id ?? null)).toEqual([10, null, null]);
    s = hold(s, 490);
    expect(s.spots[1]).toBeNull();
    s = hold(s, 10);
    expect(s.spots.map((c) => c?.arrival.id ?? null)).toEqual([10, 11, null]);
  });

  it('counts a no-room miss when all 3 spots are taken', () => {
    const plan = makePlan([0, 100, 200, 300].map((t, i) => arrival(i, t)));
    const s = hold(createRush(plan), 300);
    expect(s.spots.map((c) => c?.arrival.id)).toEqual([0, 1, 2]);
    expect(s.noRoom).toBe(1);
    expect(s.events).toContainEqual({ kind: 'noRoom', atMs: 300, arrivalId: 3 });
    expect(toOutcome(s).noRoom).toBe(1);
  });

  it('a spot freed by a walkout is taken by the next arrival', () => {
    const plan = makePlan([arrival(0, 0, { patienceMs: 1_000 }), arrival(1, 100), arrival(2, 200), arrival(3, 1_500)]);
    const s = hold(createRush(plan), 1_500);
    expect(s.walkouts).toBe(1);
    expect(s.noRoom).toBe(0);
    expect(s.spots.map((c) => c?.arrival.id)).toEqual([3, 1, 2]);
  });

  it('handles arrivals given out of order', () => {
    const s = hold(createRush(makePlan([arrival(1, 500), arrival(0, 100)])), 500);
    expect(s.spots.map((c) => c?.arrival.id ?? null)).toEqual([0, 1, null]);
  });
});

describe('making a glass', () => {
  it('takes prepMs of Space held at the prep station, and reserves (not uses) stock', () => {
    let s = createRush(makePlan([], { inventory: stock(3) }));
    s = hold(s, RUSH.prepMs - FRAME, { space: true });
    expect(s.holdingGlass).toBe(false);
    expect(taskProgress(s)).toBeCloseTo(0.99);
    s = hold(s, FRAME, { space: true });
    expect(s.holdingGlass).toBe(true);
    expect(s.events).toContainEqual({ kind: 'glassReady', atMs: RUSH.prepMs });
    expect(stockLeft(s)).toEqual(stock(3));
    expect(unreservedGlasses(s)).toBe(2);
  });

  it('releasing Space or moving drops the half-made glass', () => {
    let s = createRush(makePlan([]));
    s = hold(s, 900, { space: true });
    s = hold(s, FRAME); // let go
    expect(s.task.kind).toBe('idle');
    s = hold(s, 900, { space: true });
    expect(s.holdingGlass).toBe(false);
    s = step(s, FRAME, { ...NO_INPUT, space: true, left: true }); // walk off
    expect(s.task.kind).toBe('idle');
    expect(s.kidX).toBeLessThan(RUSH.prepX);
    expect(s.holdingGlass).toBe(false);
  });

  it('does nothing away from the prep station', () => {
    let s = walkTo(createRush(makePlan([])), RUSH.spotX[0]);
    s = hold(s, 3_000, { space: true });
    expect(s.holdingGlass).toBe(false);
    expect(s.task.kind).toBe('idle');
  });

  it('the kid can carry only one glass', () => {
    let s = makeGlass(createRush(makePlan([], { inventory: stock(5) })));
    s = hold(s, 3_000, { space: true });
    expect(s.holdingGlass).toBe(true);
    expect(s.task.kind).toBe('idle');
    expect(unreservedGlasses(s)).toBe(4);
  });
});

describe('serving', () => {
  it('a full make-and-serve uses exactly 1 of each item and pays price + tip', () => {
    const plan = makePlan([arrival(7, 0, { type: 'worker', patienceMs: 15_000, tipRate: 0.15 })], {
      inventory: stock(5),
    });
    let s = makeGlass(createRush(plan)); // t = 1000
    expect(s.used).toEqual(stock(0));
    s = walkTo(s, RUSH.spotX[0]); // t = 1720
    s = press(s);
    expect(s.task.kind).toBe('serving');
    s = hold(s, RUSH.serveMs); // t = 2520

    const o = toOutcome(s);
    expect(o.served).toEqual([{ arrivalId: 7, type: 'worker', paid: 2, tip: 0.3, bar: 'green', atMs: 2_520 }]);
    expect(o.used).toEqual(stock(1));
    expect(stockLeft(s)).toEqual(stock(4));
    expect(earned(s)).toBe(2.3);
    expect(s.spots[0]).toBeNull();
    expect(s.holdingGlass).toBe(false);
    expect(s.events).toContainEqual({ kind: 'served', atMs: 2_520, spot: 0, amount: 2.3, text: '+$2.30' });
  });

  it('pressing Space at a customer without a glass does nothing', () => {
    let s = walkTo(createRush(makePlan([arrival(0, 0)])), RUSH.spotX[0]);
    s = hold(press(s), 1_000);
    expect(s.task.kind).toBe('idle');
    expect(s.served).toHaveLength(0);
  });

  it('needs a fresh press: holding Space from the prep station does not auto-serve', () => {
    let s = makeGlass(createRush(makePlan([arrival(0, 0)])));
    for (let i = 0; i < 1_000 && s.kidX > RUSH.spotX[0]; i++) s = step(s, FRAME, { ...NO_INPUT, left: true, space: true });
    expect(spotInReach(s)).toBe(0);
    s = hold(s, 1_000, { space: true });
    expect(s.task.kind).toBe('idle');
    s = press(release(s));
    expect(s.task.kind).toBe('serving');
  });

  it('the serve lock blocks every other action for serveMs', () => {
    let s = makeGlass(createRush(makePlan([arrival(0, 0), arrival(1, 0)])));
    s = press(release(walkTo(s, RUSH.spotX[0])));
    const x = s.kidX;
    const servedPatience = s.spots[0]!.patienceLeftMs;
    const otherPatience = s.spots[1]!.patienceLeftMs;

    s = hold(s, RUSH.serveMs - FRAME, { left: true }); // try to walk away
    s = step(s, FRAME - 1, { ...NO_INPUT, space: true }); // try to press Space again
    s = press(release(s));
    expect(s.task).toEqual({ kind: 'serving', spot: 0, elapsedMs: RUSH.serveMs - 1 });
    expect(s.kidX).toBe(x);
    expect(s.served).toHaveLength(0);
    // The world keeps going for everyone else; the customer being served stops losing patience.
    expect(s.spots[0]!.patienceLeftMs).toBe(servedPatience);
    expect(s.spots[1]!.patienceLeftMs).toBe(otherPatience - (RUSH.serveMs - 1));

    s = step(s, 1, { ...NO_INPUT, left: true });
    expect(s.served).toHaveLength(1);
    expect(s.task.kind).toBe('idle');
    expect(s.kidX).toBe(x);
    s = step(s, FRAME, { ...NO_INPUT, left: true });
    expect(s.kidX).toBeLessThan(x);
  });

  it('a customer being served cannot walk out, even with almost no patience left', () => {
    let s = makeGlass(createRush(makePlan([arrival(0, 0, { patienceMs: 2_000 })]))); // t = 1000
    s = walkTo(s, RUSH.spotX[0]); // t = 1720: 280ms of patience left
    s = serve(s, 0);
    expect(s.walkouts).toBe(0);
    expect(s.served[0].bar).toBe('red');
  });
});

describe('patience bar and tips', () => {
  it('maps patience fraction to bar color: green > 60%, yellow 30–60%, red < 30%', () => {
    expect(barFor(1)).toBe('green');
    expect(barFor(0.61)).toBe('green');
    expect(barFor(0.6)).toBe('yellow');
    expect(barFor(0.3)).toBe('yellow');
    expect(barFor(0.29)).toBe('red');
    expect(barFor(0)).toBe('red');
  });

  it('maps bar color to a tip multiplier of 1 / 0.5 / 0', () => {
    expect(tipFor(2, 0.3, 'green')).toBe(0.6);
    expect(tipFor(2, 0.3, 'yellow')).toBe(0.3);
    expect(tipFor(2, 0.3, 'red')).toBe(0);
    expect(tipFor(1.25, 0, 'green')).toBe(0);
  });

  // Grandma (30% tip rate, 10s patience) arrives at 0. The glass is ready at 1000 and the kid is at
  // spot 0 at 1720, then waits `waitMs` before pressing Space.
  it.each([
    { waitMs: 0, bar: 'green', tip: 0.6 }, // 82.8% left
    { waitMs: 3_000, bar: 'yellow', tip: 0.3 }, // 52.8% left
    { waitMs: 6_000, bar: 'red', tip: 0 }, // 22.8% left
  ])('serving after waiting $waitMs ms is $bar and tips $tip', ({ waitMs, bar, tip }) => {
    const plan = makePlan([arrival(0, 0, { type: 'grandma', tipRate: 0.3 })]);
    let s = walkTo(makeGlass(createRush(plan)), RUSH.spotX[0]);
    s = serve(hold(s, waitMs), 0);
    expect(s.served).toHaveLength(1);
    expect(s.served[0]).toMatchObject({ bar, paid: 2, tip });
  });
});

describe('walkouts', () => {
  it('at 0 patience the customer walks out: no payment and no stock used', () => {
    let s = makeGlass(createRush(makePlan([arrival(1, 0, { patienceMs: 2_000 })]))); // t = 1000
    s = hold(s, 990);
    expect(s.walkouts).toBe(0);
    s = hold(s, FRAME);
    expect(s.walkouts).toBe(1);
    expect(s.spots[0]).toBeNull();
    expect(s.events).toContainEqual({ kind: 'walkout', atMs: 2_000, spot: 0 });
    // The glass the kid made stays reserved for someone else; nothing was used.
    expect(s.holdingGlass).toBe(true);
    expect(toOutcome(s)).toMatchObject({ served: [], walkouts: 1, used: stock(0) });
    expect(earned(s)).toBe(0);
  });
});

describe('selling out', () => {
  it('ends the day when stock runs out and turns everyone waiting or yet to arrive into sold-out misses', () => {
    const plan = makePlan([arrival(0, 0), arrival(1, 100), arrival(2, 200), arrival(3, 60_000), arrival(4, 90_000)], {
      inventory: { lemons: 5, sugar: 1, ice: 5, cups: 5 }, // only 1 glass's worth
    });
    let s = makeGlass(createRush(plan));
    // Holding the last glass: nothing unreserved, but the day goes on.
    expect(unreservedGlasses(s)).toBe(0);
    expect(isOver(s)).toBe(false);

    s = serve(s, 0);
    expect(s.phase).toBe('soldOut');
    expect(isOver(s)).toBe(true);
    const o = toOutcome(s);
    expect(o.served).toHaveLength(1);
    expect(o.soldOutMisses).toBe(4); // 2 waiting + 2 yet to arrive
    expect(o.soldOutAtMs).toBe(o.served[0].atMs);
    expect(o.used).toEqual(stock(1));
    expect(o.walkouts + o.noRoom).toBe(0);
    expect(s.clockMs).toBe(o.soldOutAtMs);
    expect(s.events).toContainEqual({ kind: 'soldOut', atMs: o.soldOutAtMs });

    // Once over, the Rush ignores time and input.
    const later = step(s, 60_000, { left: true, right: false, space: true });
    expect(toOutcome(later)).toEqual(o);
    expect(later.clockMs).toBe(s.clockMs);
  });
});

describe('closing time', () => {
  const plan = makePlan([arrival(0, 1_000, { patienceMs: 60_000 }), arrival(1, 9_000, { patienceMs: 60_000 })], {
    dayLengthMs: 10_000,
  });

  it('ends the day at dayLengthMs; customers still waiting leave and are not walkouts', () => {
    let s = hold(createRush(plan), 9_990);
    expect(s.phase).toBe('open');
    expect(s.spots.filter(Boolean)).toHaveLength(2);
    s = hold(s, FRAME);
    expect(s.phase).toBe('closed');
    expect(s.clockMs).toBe(10_000);
    expect(s.leftAtClose).toBe(2);
    expect(toOutcome(s)).toEqual({
      served: [],
      walkouts: 0,
      noRoom: 0,
      soldOutMisses: 0,
      soldOutAtMs: null,
      leftAtClose: 2,
      used: stock(0),
    });
  });

  it('one huge step cannot run the clock past closing', () => {
    const s = step(createRush(plan), 1e9, NO_INPUT);
    expect(s.phase).toBe('closed');
    expect(s.clockMs).toBe(10_000);
    expectInvariants(s);
  });

  it('a serve still in progress at closing is abandoned and uses no stock', () => {
    const short = makePlan([arrival(0, 0)], { dayLengthMs: 2_000 });
    let s = walkTo(makeGlass(createRush(short)), RUSH.spotX[0]); // t = 1720
    s = serve(s, 0); // the lock would end at 2520
    expect(s.phase).toBe('closed');
    expect(toOutcome(s)).toMatchObject({ served: [], walkouts: 0, used: stock(0) });
    expect(s.leftAtClose).toBe(1);
  });
});

describe('determinism and invariants', () => {
  it('the same plan and the same inputs always give the same outcome', () => {
    const a = play(fixturePlan, bot);
    const b = play(fixturePlan, bot);
    expect(a).toEqual(b);
    expect(toOutcome(a)).toEqual(toOutcome(b));
    // Sanity: a competent player serves most of the fixture day.
    expect(a.served.length).toBeGreaterThanOrEqual(15);
    expectInvariants(a);
  });

  it('step never mutates the state it is given', () => {
    const s = play(fixturePlan, bot, () => 16, deepFreeze);
    expectInvariants(s);
  });

  it('random plans, frame times and key mashing never break the rules (40 seeds)', () => {
    const TYPES: { type: CustomerTypeId; patienceMs: number; tipRate: number }[] = [
      { type: 'kid', patienceMs: 18_000, tipRate: 0 },
      { type: 'jogger', patienceMs: 12_000, tipRate: 0.1 },
      { type: 'grandma', patienceMs: 25_000, tipRate: 0.3 },
      { type: 'worker', patienceMs: 15_000, tipRate: 0.15 },
    ];
    const run = (seed: number) => {
      const rand = mulberry32(seed);
      const n = Math.floor(rand() * 45);
      const arrivals = Array.from({ length: n }, (_, id) => {
        const t = TYPES[Math.floor(rand() * TYPES.length)];
        return arrival(id, Math.floor(rand() * 120_000), t);
      });
      const inventory = { lemons: Math.floor(rand() * 30), sugar: 30, ice: Math.floor(rand() * 30), cups: 30 };
      const plan = makePlan(arrivals, { inventory, price: 0.5 + Math.floor(rand() * 10) * 0.25 });
      return play(
        plan,
        (s) => (rand() < 0.3 ? { left: rand() < 0.5, right: rand() < 0.5, space: rand() < 0.5 } : bot(s)),
        () => 1 + rand() * 60,
      );
    };
    const seen = { served: 0, walkouts: 0, noRoom: 0, soldOut: 0, closed: 0 };
    for (let seed = 1; seed <= 40; seed++) {
      const s = run(seed);
      expectInvariants(s);
      expect(toOutcome(run(seed))).toEqual(toOutcome(s));
      seen.served += s.served.length;
      seen.walkouts += s.walkouts;
      seen.noRoom += s.noRoom;
      seen.soldOut += s.phase === 'soldOut' ? 1 : 0;
      seen.closed += s.phase === 'closed' ? 1 : 0;
    }
    // The fuzz really exercises every way a customer can leave and both ways a day can end.
    for (const count of Object.values(seen)) expect(count).toBeGreaterThan(0);
  });
});
