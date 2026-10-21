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
  inMiniGame,
  type PourTask,
  patienceFraction,
  pourLevel,
  earned,
  freeCupSets,
  isOver,
  reservedGlasses,
  spotInReach,
  stationTask,
  step,
  stockLeft,
  taskProgress,
  tipFor,
  toOutcome,
  unreservedGlasses,
} from './rushRules';
import { STIR_ORDER, glassTipMultiplier, pourBandCenter, pourFill, pourRateAt, scoopAt } from './miniGames';

// ---------- Test helpers: build plans and drive the rules with scripted keys ----------

/** Every helper advances time in 10ms frames, like a 100fps game loop. */
const FRAME = 10;

const stock = (n: number): Inventory => ({ lemons: n, sugar: n, ice: n, cups: n });
/** Expected `used`: lemons + sugar for every glass filled into the jug, cups + ice for every glass served. */
const usage = (filled: number, served: number): Inventory => ({ lemons: filled, sugar: filled, ice: served, cups: served });

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

// ---- Mini-game drivers (see miniGames.ts). Each one plays exactly as a player would, frame by frame. ----

const P = RUSH.pour;

/** One frame of Space at the station with the jug empty starts the jug mini-game; then let go. */
const startJugGame = (s: RushState) => release(hold(s, FRAME, { space: true }));

/** Squeeze: `taps` alternating ← → presses, one per frame. */
function squeeze(s: RushState, taps: number): RushState {
  for (let i = 0; i < taps; i++) s = step(s, FRAME, { ...NO_INPUT, left: i % 2 === 0, right: i % 2 === 1 });
  return s;
}

/** Sweeten: tap Space right now, or wait (frame by frame) until the scoop is within `tol` of the sweet spot. */
function sweeten(s: RushState, when: 'now' | 'onSpot', tol = 0.011): RushState {
  if (when === 'onSpot') {
    for (let i = 0; i < 1_000; i++) {
      const t = s.task;
      if (t.kind !== 'makingJug' || t.beat !== 'sweeten' || Math.abs(scoopAt(t.beatMs) - t.sweetSpot) <= tol) break;
      s = hold(s, FRAME);
    }
  }
  return release(press(s));
}

/** Stir: the next `steps` keys of the circle (↑ → ↓ ←), one per frame. */
function stir(s: RushState, steps: number): RushState {
  for (let i = 0; i < steps; i++) s = step(s, FRAME, { ...NO_INPUT, [STIR_ORDER[i % STIR_ORDER.length]]: true });
  return release(s);
}

/** Let the current mini-game run out on its own (timeouts). */
function waitOut(s: RushState): RushState {
  for (let i = 0; i < 10_000 && (s.task.kind === 'makingJug' || s.task.kind === 'pouring'); i++) s = hold(s, FRAME);
  return s;
}

/** Make a jug at the station: ★★★ = every beat great; ★★ = great / poor / great (fast); ★ = every beat times out. */
function makeJug(s: RushState, stars: 1 | 2 | 3): RushState {
  s = startJugGame(s);
  if (stars === 1) return waitOut(s);
  s = squeeze(s, RUSH.jug.squeeze.taps);
  s = sweeten(s, stars === 3 ? 'onSpot' : 'now');
  return stir(s, RUSH.jug.stir.steps);
}

/**
 * Hold Space to pour, letting go as soon as the fill *after the drip* would reach `target`, then wait for
 * the drip. (Overshoot is at most one frame of flow plus its effect on the drip.)
 */
function pourTo(s: RushState, target: number): RushState {
  s = hold(s, FRAME, { space: true });
  for (let i = 0; i < 1_000; i++) {
    const t = s.task;
    if (t.kind !== 'pouring' || t.dripMs !== null || pourFill(t.holdMs, P.dripMs) >= target) break;
    s = hold(s, FRAME, { space: true });
  }
  return waitOut(s);
}

/** Fill targets for the next glass's band. */
const nextCenter = (s: RushState) => pourBandCenter(s.pours);
const pourGood = (s: RushState) => pourTo(s, nextCenter(s) - P.bandHalf + 0.005); // ends ~0.05–0.085 under center
const pourPerfect = (s: RushState) => pourTo(s, nextCenter(s) - 0.02);
const pourShort = (s: RushState) => pourTo(s, nextCenter(s) - P.bandHalf - 0.15);
const pourToBrim = (s: RushState) => pourTo(s, 2); // never lets go: spills at the brim

/** A first glass (jug + pour) and a later glass (pour only) take at most this long, padded to exactly this. */
const FIRST_GLASS_MS = 2_300;
const NEXT_GLASS_MS = 1_000;

/**
 * Walk to the prep station; make a ★★ jug if it's empty; pour a GOOD glass. ★★ and GOOD both tip ×1, so
 * tips match the plain bar rule. Then wait at the station until FIRST_GLASS_MS / NEXT_GLASS_MS has passed
 * since arriving, so tests can reason about exact times.
 */
function makeGlass(s: RushState): RushState {
  s = walkTo(s, RUSH.prepX);
  const t0 = s.clockMs;
  const budget = s.jug === 0 ? FIRST_GLASS_MS : NEXT_GLASS_MS;
  if (s.jug === 0) s = makeJug(s, 2);
  s = pourGood(s);
  const spent = s.clockMs - t0;
  if (spent > budget) throw new Error(`makeGlass took ${spent}ms (budget ${budget})`);
  return isOver(s) ? s : hold(s, budget - spent);
}

/** Walking from the prep station to spot 0. */
const WALK_TO_SPOT0_MS = (RUSH.prepX - RUSH.spotX[0]) / RUSH.kidSpeedPxPerMs; // 720

/** Walk to a spot, press Space, and wait out the serve lock. */
function serve(s: RushState, spot: number): RushState {
  return hold(press(release(walkTo(s, RUSH.spotX[spot]))), RUSH.serveMs);
}

/** Wait until someone is at the counter, then serve the first spot taken. */
function serveFirstWaiting(s: RushState): RushState {
  for (let i = 0; i < 100_000 && s.spots.every((c) => c === null); i++) s = hold(s, FRAME);
  return serve(s, s.spots.findIndex((c) => c !== null));
}

/**
 * A simple competent player: make a jug / pour at the station, carry the glass to the least patient
 * customer, repeat. `aim` picks where it lets go of a pour ('spill' never lets go).
 */
function bot(s: RushState, aim: 'perfect' | 'short' | 'spill' = 'perfect'): RushInput {
  if (s.task.kind === 'serving') return NO_INPUT;
  const t = s.task;
  if (t.kind === 'makingJug') {
    if (t.beat === 'squeeze') return { ...NO_INPUT, left: t.lastDir !== 'left', right: t.lastDir === 'left' };
    if (t.beat === 'sweeten') return { ...NO_INPUT, space: !s.spaceWasDown && Math.abs(scoopAt(t.beatMs) - t.sweetSpot) <= 0.03 };
    return { ...NO_INPUT, [STIR_ORDER[t.count % STIR_ORDER.length]]: true };
  }
  if (t.kind === 'pouring') {
    const target = aim === 'spill' ? 2 : aim === 'short' ? t.center - 0.3 : t.center - 0.02;
    return { ...NO_INPUT, space: t.dripMs === null && pourFill(t.holdMs, RUSH.pour.dripMs) < target };
  }
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

/** Play a whole day. `watch` sees every state: the opening one and the result of each step. */
function play(
  plan: DayPlan,
  policy: (s: RushState, frame: number) => RushInput,
  frameMs: (frame: number) => number = () => 16,
  watch: (s: RushState) => void = () => {},
): RushState {
  let s = createRush(plan);
  watch(s);
  for (let i = 0; !isOver(s); i++) {
    if (i > 200_000) throw new Error('the Rush never ended');
    s = step(s, frameMs(i), policy(s, i));
    watch(s);
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

/** Things that must hold after every step, whatever the player does. Throws (cheaper than expect in a hot loop). */
function checkStep(s: RushState) {
  const fail = (why: string) => {
    const { jug, holdingGlass, used, pouredOut, clockMs } = s;
    throw new Error(`${why}: ${JSON.stringify({ clockMs, jug, holdingGlass, used, served: s.served.length, pouredOut })}`);
  };
  if (!(Number.isInteger(s.jug) && s.jug >= 0 && s.jug <= RUSH.jugCapacity)) fail('bad jug');
  if (s.used.lemons !== s.used.sugar) fail('lemons and sugar used unevenly');
  const servedOrSpilled = s.served.length + s.spilled;
  if (s.used.cups !== servedOrSpilled || s.used.ice !== servedOrSpilled) fail('cups/ice used without a serve or spill');
  if (s.holdingGlass !== (s.glass !== null)) fail('glass out of sync');
  if (s.jug > 0 && s.task.kind !== 'makingJug' && s.jugStars === null) fail('ungraded jug');
  // Every glass of lemonade ever filled is in the jug, in hand, served, or poured out.
  if (s.used.lemons !== reservedGlasses(s) + s.served.length + s.pouredOut) fail('lemonade not conserved');
  for (const item of ITEMS) if (stockLeft(s)[item] < 0) fail(`negative ${item}`);
  if (s.holdingGlass && Math.min(stockLeft(s).cups, stockLeft(s).ice) < 1) fail('glass in hand without a cup + ice');
  if (!isOver(s) && s.pouredOut !== s.spilled + s.dumped) fail('poured out while still open');
}

/** Things that must hold at the end of any Rush, whatever the player did. */
function expectInvariants(s: RushState) {
  expect(isOver(s)).toBe(true);
  checkStep(s);
  const o = toOutcome(s);
  const n = o.served.length;
  expect(o.used.lemons).toBe(o.used.sugar);
  expect(o.used.cups).toBe(n + s.spilled);
  expect(o.used.ice).toBe(n + s.spilled);
  expect(o.pouredOut).toBe(o.used.lemons - n); // filled − served
  expect(s).toMatchObject({ jug: 0, holdingGlass: false }); // the leftovers were poured out
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
    expect(s).toMatchObject({ clockMs: 0, phase: 'open', kidX: RUSH.kidStartX, jug: 0, holdingGlass: false });
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
      pouredOut: 0,
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

describe('the jug mini-game (squeeze → sweeten → stir)', () => {
  it('starts empty; holding Space at the station starts the jug and uses lemons + sugar right away', () => {
    let s = createRush(makePlan([], { inventory: stock(25) }));
    expect(stationTask(s)).toBe('makingJug');
    s = startJugGame(s);
    expect(s.task).toMatchObject({ kind: 'makingJug', beat: 'squeeze', count: 0 });
    expect(s.events).toEqual([]);
    expect(s.jug).toBe(RUSH.jugCapacity);
    expect(s.jugStars).toBeNull(); // not graded yet
    expect(s.used).toEqual(usage(10, 0));
    expect(stockLeft(s)).toEqual({ lemons: 15, sugar: 15, ice: 25, cups: 25 });
    expect(reservedGlasses(s)).toBe(10);
    expect(unreservedGlasses(s)).toBe(15);
    expect(inMiniGame(s)).toBe(true);
  });

  it.each([
    { inventory: { lemons: 4, sugar: 7, ice: 9, cups: 30 }, jug: 4 }, // lemons cap it
    { inventory: { lemons: 30, sugar: 6, ice: 30, cups: 30 }, jug: 6 }, // sugar caps it
    { inventory: { lemons: 30, sugar: 30, ice: 2, cups: 1 }, jug: 10 }, // cups and ice don't
  ])('a jug takes min(jugCapacity, lemons, sugar): $inventory → $jug', ({ inventory, jug }) => {
    const s = makeJug(createRush(makePlan([], { inventory })), 3);
    expect(s.jug).toBe(jug);
    expect(s.used).toEqual(usage(jug, 0));
    expect(isOver(s)).toBe(false);
  });

  it('a fast, accurate jug is ★★★: three GREAT beats, then the jug can be poured', () => {
    let s = startJugGame(createRush(makePlan([], { inventory: stock(25) })));
    s = squeeze(s, RUSH.jug.squeeze.taps - 1);
    expect(s.task).toMatchObject({ beat: 'squeeze', count: RUSH.jug.squeeze.taps - 1 });
    s = squeeze(s, 1); // the 8th tap was ← again: it doesn't alternate, so it doesn't count
    expect(s.task).toMatchObject({ beat: 'squeeze', count: RUSH.jug.squeeze.taps - 1 });
    s = step(s, FRAME, { ...NO_INPUT, right: true });
    expect(s.events).toContainEqual(expect.objectContaining({ kind: 'beat', beat: 'squeeze', grade: 'great' }));
    expect(s.task).toMatchObject({ beat: 'sweeten', beatMs: 0 });
    s = sweeten(s, 'onSpot');
    expect(s.task).toMatchObject({ beat: 'stir', grades: ['great', 'great'] });
    s = stir(s, 3);
    s = step(s, FRAME, { ...NO_INPUT, up: true }); // wrong key (wants ←): ignored
    expect(s.task).toMatchObject({ beat: 'stir', count: 3 });
    s = release(s);
    s = step(s, FRAME, { ...NO_INPUT, left: true });
    s = step(s, FRAME, { ...NO_INPUT, up: true });
    s = step(s, FRAME, { ...NO_INPUT, right: true });
    s = step(s, FRAME, { ...NO_INPUT, down: true });
    s = step(s, FRAME, { ...NO_INPUT, left: true });
    expect(s.task.kind).toBe('idle');
    expect(s.events).toContainEqual(expect.objectContaining({ kind: 'jugMade', glasses: 10, stars: 3 }));
    expect(s).toMatchObject({ jug: 10, jugStars: 3 });
    expect(stationTask(s)).toBe('pouring');
  });

  it('timeouts are never a failure: doing nothing makes a ★ jug after every beat window runs out', () => {
    const s0 = startJugGame(createRush(makePlan([], { inventory: stock(25) })));
    const s = waitOut(s0);
    const { squeeze: sq, sweeten: sw, stir: st } = RUSH.jug;
    expect(s.clockMs - s0.clockMs).toBe(sq.windowMs + sw.windowMs + st.windowMs);
    expect(s).toMatchObject({ jug: 10, jugStars: 1, task: { kind: 'idle' } });
  });

  it('★★ for a mixed jug (great / poor / great); the kid cannot walk while the mini-game has the arrows', () => {
    let s = startJugGame(createRush(makePlan([], { inventory: stock(25) })));
    const x = s.kidX;
    s = squeeze(s, RUSH.jug.squeeze.taps);
    s = sweeten(s, 'now'); // the scoop starts at 0, far from the sweet spot
    s = stir(s, RUSH.jug.stir.steps);
    expect(s.kidX).toBe(x);
    expect(s.jugStars).toBe(2);
  });

  it('holding ← (alone) for walkAwayMs walks away: the jug is dumped and counts as poured out', () => {
    let s = startJugGame(createRush(makePlan([], { inventory: stock(25) })));
    s = squeeze(s, 3);
    s = hold(s, RUSH.jug.walkAwayMs - FRAME, { left: true }); // not quite long enough
    expect(s.task.kind).toBe('makingJug');
    expect(s.kidX).toBe(RUSH.prepX);
    s = hold(s, FRAME, { left: true });
    expect(s.task.kind).toBe('idle');
    expect(s).toMatchObject({ jug: 0, jugStars: null, dumped: 10, pouredOut: 10, used: usage(10, 0) });
    expect(s.events).toContainEqual(expect.objectContaining({ kind: 'jugDumped', glasses: 10 }));
    s = hold(s, 100, { left: true }); // and now the kid walks
    expect(s.kidX).toBeLessThan(RUSH.prepX);
    expect(isOver(s)).toBe(false);
    checkStep(s);
  });

  it('dumping the last lemons sells the stand out on the spot', () => {
    let s = startJugGame(createRush(makePlan([arrival(0, 0)], { inventory: stock(3) })));
    s = hold(s, RUSH.jug.walkAwayMs + FRAME, { right: true }); // the first frame is a fresh press: it doesn't count
    expect(s.phase).toBe('soldOut');
    expect(toOutcome(s)).toMatchObject({ pouredOut: 3, soldOutMisses: 1, used: usage(3, 0) });
  });

  it('must be refilled after jugCapacity pours, which works even with a glass in hand', () => {
    // Spaced so the counter never overflows at any walking speed (this test is about the jug, not crowding).
    const arrivals = Array.from({ length: 11 }, (_, i) => arrival(i, i * 8_000, { patienceMs: 1_000_000 }));
    let s = createRush(makePlan(arrivals, { inventory: stock(25), dayLengthMs: 300_000 }));
    for (let poured = 1; poured <= RUSH.jugCapacity; poured++) {
      s = makeGlass(s); // makes a jug only the first time
      expect(s.jug).toBe(RUSH.jugCapacity - poured);
      if (poured < RUSH.jugCapacity) s = serveFirstWaiting(s);
    }
    expect(s.served).toHaveLength(9);
    // Jug empty, 10th glass in hand. Holding Space now starts a new jug instead of pouring.
    expect(stationTask(s)).toBe('makingJug');
    s = makeJug(s, 3);
    expect(s).toMatchObject({ jug: 10, jugStars: 3, holdingGlass: true, glass: { pour: 'good', stars: 2 } });
    expect(s.used).toEqual(usage(20, 9));
    s = serveFirstWaiting(s);
    expect(toOutcome(s).used).toEqual(usage(20, 10));
    expect(stockLeft(s)).toEqual({ lemons: 5, sugar: 5, ice: 15, cups: 15 });
  });

  it('does nothing away from the prep station', () => {
    let s = walkTo(createRush(makePlan([])), RUSH.spotX[0]);
    s = hold(s, 3_000, { space: true });
    expect(s).toMatchObject({ jug: 0, holdingGlass: false, task: { kind: 'idle' } });
  });
});

describe('pour to the line', () => {
  const filledJug = () => makeJug(createRush(makePlan([], { inventory: stock(25) })), 2);

  it('a GOOD pour moves one glass from the jug to the kid, setting aside (not using) a cup + ice', () => {
    let s = filledJug();
    expect(stationTask(s)).toBe('pouring');
    s = hold(s, FRAME, { space: true });
    expect(s.task).toMatchObject({ kind: 'pouring', holdMs: FRAME, dripMs: null, center: pourBandCenter(0) });
    s = pourGood(release(s));
    expect(s.events).toContainEqual(expect.objectContaining({ kind: 'poured', grade: 'good' }));
    expect(s).toMatchObject({ holdingGlass: true, glass: { pour: 'good', stars: 2 }, jug: 9, pours: 1 });
    expect(reservedGlasses(s)).toBe(10);
    expect(s.used).toEqual(usage(10, 0));
    expect(freeCupSets(s)).toBe(24);
  });

  it.each([
    { pour: pourPerfect, grade: 'perfect' },
    { pour: pourGood, grade: 'good' },
    { pour: pourShort, grade: 'short' },
  ] as const)('a pour graded $grade is carried by the glass', ({ pour, grade }) => {
    const s = pour(filledJug());
    expect(s.glass).toEqual({ pour: grade, stars: 2 });
    expect(s.jug).toBe(9);
  });

  it('SPILL: hold too long and it overflows at the brim; the lemonade is lost and its cup + ice are used', () => {
    let s = filledJug();
    s = pourToBrim(s);
    expect(s.events).toContainEqual(expect.objectContaining({ kind: 'spilled', fill: P.brim }));
    expect(s).toMatchObject({ holdingGlass: false, glass: null, jug: 9, spilled: 1, pouredOut: 1, pours: 1 });
    expect(s.used).toEqual({ lemons: 10, sugar: 10, cups: 1, ice: 1 });
    checkStep(s);
    // Releasing past the top line (after the drip) also spills.
    s = pourTo(release(s), pourBandCenter(1) + P.bandHalf + 0.03);
    expect(s).toMatchObject({ spilled: 2, pouredOut: 2, jug: 8, holdingGlass: false });
    expect(isOver(s)).toBe(false);
  });

  it('a spill of the last cup + ice sells the stand out', () => {
    const plan = makePlan([arrival(0, 0)], { inventory: { lemons: 5, sugar: 5, ice: 1, cups: 1 } });
    const s = pourToBrim(makeJug(createRush(plan), 2));
    expect(s.phase).toBe('soldOut');
    expect(toOutcome(s)).toMatchObject({ pouredOut: 5, soldOutMisses: 1, used: { lemons: 5, sugar: 5, cups: 1, ice: 1 } });
  });

  it('cancels for free before anything flows (letting go or walking during the tilt)', () => {
    let s = filledJug();
    s = hold(s, P.tiltMs, { space: true });
    expect(pourLevel(s)).toBe(0);
    s = hold(s, FRAME); // let go: nothing poured yet
    expect(s).toMatchObject({ task: { kind: 'idle' }, jug: 10, holdingGlass: false, pours: 0, used: usage(10, 0) });
    s = hold(s, 50, { space: true });
    s = step(s, FRAME, { ...NO_INPUT, space: true, left: true }); // walk off mid-tilt
    expect(s.task.kind).toBe('idle');
    expect(s.kidX).toBeLessThan(RUSH.prepX);
    expect(s).toMatchObject({ jug: 10, pours: 0, used: usage(10, 0) });
  });

  it('once lemonade flows the arrows are captured: the kid stays put until the pour is graded', () => {
    let s = hold(filledJug(), P.tiltMs + 100, { space: true });
    expect(pourLevel(s)).toBeGreaterThan(0);
    s = hold(s, 100, { space: true, left: true });
    expect(s.kidX).toBe(RUSH.prepX);
    expect(s.task.kind).toBe('pouring');
  });

  it('after letting go it drips for dripMs at the release rate, then stops', () => {
    let s = hold(filledJug(), 500, { space: true });
    const t = s.task as PourTask;
    const atRelease = pourFill(t.holdMs, 0);
    s = hold(s, P.dripMs - FRAME);
    expect(s.task.kind).toBe('pouring');
    s = hold(s, FRAME);
    const ev = s.events.find((e) => e.kind === 'poured');
    expect(ev).toBeDefined();
    expect(ev && 'fill' in ev ? ev.fill : 0).toBeCloseTo(atRelease + pourRateAt(t.holdMs - P.tiltMs) * P.dripMs, 9);
  });

  it('the target band moves from glass to glass, deterministically', () => {
    const centers = Array.from({ length: P.bandCenters.length }, (_, i) => pourBandCenter(i));
    expect(new Set(centers).size).toBeGreaterThan(1);
    expect(pourBandCenter(P.bandCenters.length)).toBe(centers[0]);
  });

  it('pouring needs a free cup and a free ice', () => {
    // In play the stand sells out first (see 'selling out'), so check the guard on a hand-built state.
    const filled = filledJug();
    for (const item of ['cups', 'ice'] as const) {
      const noneLeft: RushState = { ...filled, used: { ...filled.used, [item]: filled.plan.inventory[item] } };
      expect(stationTask(noneLeft)).toBeNull();
      expect(hold(noneLeft, 1_000, { space: true })).toMatchObject({ jug: 10, holdingGlass: false });
    }
  });

  it('the kid can carry only one glass: no pouring while holding one', () => {
    let s = makeGlass(createRush(makePlan([], { inventory: stock(5) }))); // jug 5 → 4 after the pour
    expect(stationTask(s)).toBeNull();
    s = hold(s, 3_000, { space: true });
    expect(s).toMatchObject({ jug: 4, holdingGlass: true, task: { kind: 'idle' } });
    expect(unreservedGlasses(s)).toBe(0);
  });
});

describe('tip multipliers stack: bar × pour × jug', () => {
  it('a PERFECT glass from a ★★★ jug on green tips ×1.2 × 1.25', () => {
    const plan = makePlan([arrival(0, 0, { type: 'worker', tipRate: 0.15, patienceMs: 60_000 })]);
    let s = pourPerfect(makeJug(createRush(plan), 3));
    expect(s.glass).toEqual({ pour: 'perfect', stars: 3 });
    s = serve(s, 0);
    expect(s.served[0]).toMatchObject({ bar: 'green', paid: 2, tip: 0.45 }); // 2 × 0.15 × 1 × 1.2 × 1.25
  });

  it('a SHORT glass from a ★ jug on yellow tips ×0.5 × 0.5 × 0.8', () => {
    const plan = makePlan([arrival(0, 0, { type: 'grandma', tipRate: 0.3, patienceMs: 10_000 })]);
    let s = pourShort(makeJug(createRush(plan), 1));
    expect(s.glass).toEqual({ pour: 'short', stars: 1 });
    s = walkTo(s, RUSH.spotX[0]);
    while (barFor(patienceFraction(s.spots[0]!)) !== 'yellow') s = hold(s, FRAME);
    s = serve(s, 0);
    expect(s.served[0]).toMatchObject({ bar: 'yellow', tip: 0.12 }); // 2 × 0.3 × 0.5 × 0.5 × 0.8
  });

  it('tipFor multiplies the glass multiplier in and rounds to cents', () => {
    expect(tipFor(2, 0.15, 'green', glassTipMultiplier('perfect', 3))).toBe(0.45);
    expect(tipFor(2, 0.3, 'red', glassTipMultiplier('perfect', 3))).toBe(0);
    expect(tipFor(1, 0.1, 'green', glassTipMultiplier('good', 2))).toBe(0.1);
  });
});

describe('serving', () => {
  it('fill → pour → serve: the serve uses exactly 1 cup + 1 ice and pays price + tip', () => {
    const plan = makePlan([arrival(7, 0, { type: 'worker', patienceMs: 15_000, tipRate: 0.15 })], {
      inventory: stock(5),
    });
    let s = makeGlass(createRush(plan)); // t = 2300; the fill used all 5 lemons + sugar
    expect(s.used).toEqual(usage(5, 0));
    s = walkTo(s, RUSH.spotX[0]); // t = 3020: 80% patience left
    s = press(s);
    expect(s.task.kind).toBe('serving');
    s = hold(s, RUSH.serveMs); // t = 3820
    const servedAt = FIRST_GLASS_MS + WALK_TO_SPOT0_MS + RUSH.serveMs;

    const o = toOutcome(s);
    expect(o.served).toEqual([{ arrivalId: 7, type: 'worker', paid: 2, tip: 0.3, bar: 'green', atMs: servedAt }]);
    expect(o.used).toEqual(usage(5, 1));
    expect(stockLeft(s)).toEqual({ lemons: 0, sugar: 0, ice: 4, cups: 4 });
    expect(s.jug).toBe(4);
    expect(earned(s)).toBe(2.3);
    expect(s.spots[0]).toBeNull();
    expect(s.holdingGlass).toBe(false);
    expect(s.events).toContainEqual({ kind: 'served', atMs: servedAt, spot: 0, amount: 2.3, text: '+$2.30' });
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
    let s = makeGlass(createRush(makePlan([arrival(0, 0, { patienceMs: 2_300 + (RUSH.prepX - RUSH.spotX[0]) / RUSH.kidSpeedPxPerMs + 480 })]))); // t = 2300
    s = walkTo(s, RUSH.spotX[0]); // 480ms of patience left on arrival
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

  // Grandma (30% tip rate, 10s patience) arrives at 0. The glass is poured at 2300 and the kid is at
  // spot 0 at 3020, then waits `waitMs` before pressing Space.
  it.each([
    { waitMs: 0, bar: 'green', tip: 0.6 }, // 69.8% left
    { waitMs: 2_000, bar: 'yellow', tip: 0.3 }, // 49.8% left
    { waitMs: 5_000, bar: 'red', tip: 0 }, // 19.8% left
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
    let s = makeGlass(createRush(makePlan([arrival(1, 0, { patienceMs: 3_000 })]))); // t = 2300
    s = hold(s, 690);
    expect(s.walkouts).toBe(0);
    s = hold(s, FRAME);
    expect(s.walkouts).toBe(1);
    expect(s.spots[0]).toBeNull();
    expect(s.events).toContainEqual({ kind: 'walkout', atMs: 3_000, spot: 0 });
    // The walkout uses nothing: the glass stays in hand (its cup + ice set aside), the jug keeps its lemonade.
    // The only stock used is the lemons + sugar that went into the jug.
    expect(s.holdingGlass).toBe(true);
    expect(s.jug).toBe(9);
    expect(toOutcome(s)).toMatchObject({ served: [], walkouts: 1, pouredOut: 0, used: usage(10, 0) });
    expect(earned(s)).toBe(0);
  });
});

describe('selling out', () => {
  it('sells out when lemons run out with the jug empty; everyone waiting or yet to arrive is a sold-out miss', () => {
    const plan = makePlan([arrival(0, 0), arrival(1, 100), arrival(2, 200), arrival(3, 60_000), arrival(4, 90_000)], {
      inventory: { lemons: 1, sugar: 5, ice: 5, cups: 5 }, // only 1 glass's worth of lemons
    });
    let s = makeGlass(createRush(plan)); // the fill only gets 1 glass; it's poured
    // Holding the last glass with the jug empty: nothing left to make, but the day goes on.
    expect(s).toMatchObject({ jug: 0, holdingGlass: true });
    expect(unreservedGlasses(s)).toBe(0);
    expect(isOver(s)).toBe(false);
    // There's nothing left to fill the jug with.
    expect(stationTask(s)).toBeNull();
    s = hold(s, 3_000, { space: true });
    expect(s.task.kind).toBe('idle');

    s = serve(s, 0);
    expect(s.phase).toBe('soldOut');
    expect(isOver(s)).toBe(true);
    const o = toOutcome(s);
    expect(o.served).toHaveLength(1);
    expect(o.soldOutMisses).toBe(4); // 2 waiting + 2 yet to arrive
    expect(o.soldOutAtMs).toBe(o.served[0].atMs);
    expect(o.used).toEqual(usage(1, 1));
    expect(o.pouredOut).toBe(0);
    expect(o.walkouts + o.noRoom).toBe(0);
    expect(s.clockMs).toBe(o.soldOutAtMs);
    expect(s.events).toContainEqual({ kind: 'soldOut', atMs: o.soldOutAtMs });

    // Once over, the Rush ignores time and input.
    const later = step(s, 60_000, { left: true, right: false, space: true });
    expect(toOutcome(later)).toEqual(o);
    expect(later.clockMs).toBe(s.clockMs);
  });

  it('lemonade left in the jug keeps the stand open; it sells out only when the jug and hands are empty', () => {
    const waiting = [0, 100, 200].map((t, i) => arrival(i, t, { patienceMs: 60_000 }));
    const plan = makePlan([...waiting, arrival(3, 100_000)], { inventory: stock(3) });
    let s = makeGlass(createRush(plan)); // jug 3 → 2 after the pour
    expect(unreservedGlasses(s)).toBe(0);
    s = serveFirstWaiting(s);
    expect(s).toMatchObject({ phase: 'open', jug: 2 });
    s = serveFirstWaiting(makeGlass(s));
    expect(s).toMatchObject({ phase: 'open', jug: 1 });
    s = serveFirstWaiting(makeGlass(s));
    expect(s).toMatchObject({ phase: 'soldOut', jug: 0 });
    expect(toOutcome(s)).toMatchObject({ soldOutMisses: 1, pouredOut: 0, used: usage(3, 3) });
    expect(s.served).toHaveLength(3);
  });

  it.each(['cups', 'ice'] as const)(
    'sells out when %s run out, even with lemonade in the jug, and that lemonade is poured out',
    (item) => {
      const waiting = [0, 100, 200].map((t, i) => arrival(i, t, { patienceMs: 60_000 }));
      const plan = makePlan([...waiting, arrival(3, 100_000)], { inventory: { ...stock(10), [item]: 2 } });
      let s = makeGlass(createRush(plan)); // fills 10 (cups and ice don't cap a fill), pours 1
      expect(s.jug).toBe(9);
      s = serveFirstWaiting(s);
      expect(s).toMatchObject({ phase: 'open', jug: 9 });
      s = serveFirstWaiting(makeGlass(s)); // the last cup + ice
      expect(s.phase).toBe('soldOut');
      const o = toOutcome(s);
      expect(o).toMatchObject({ pouredOut: 8, soldOutMisses: 2, used: usage(10, 2) }); // 1 waiting + 1 to come
      expect(o.soldOutAtMs).toBe(o.served[1].atMs);
      expect(s.jug).toBe(0);
      expect(stockLeft(s)).toEqual({ ...usage(0, 8), [item]: 0 });
    },
  );
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
      pouredOut: 0,
      used: stock(0),
    });
  });

  it('one huge step cannot run the clock past closing', () => {
    const s = step(createRush(plan), 1e9, NO_INPUT);
    expect(s.phase).toBe('closed');
    expect(s.clockMs).toBe(10_000);
    expectInvariants(s);
  });

  it('a serve still in progress at closing is abandoned: its cup + ice are not used, its lemonade is poured out', () => {
    const short = makePlan([arrival(0, 0)], { dayLengthMs: 3_500 });
    let s = walkTo(makeGlass(createRush(short)), RUSH.spotX[0]); // t = 3020
    s = serve(s, 0); // the lock would end at 3820
    expect(s.phase).toBe('closed');
    expect(toOutcome(s)).toMatchObject({ served: [], walkouts: 0, pouredOut: 10, used: usage(10, 0) });
    expect(s.leftAtClose).toBe(1);
  });

  it('lemonade left in the jug and in hand at closing is poured out: lemons + sugar gone, cup + ice kept', () => {
    const plan = makePlan([arrival(0, 0), arrival(1, 5_000, { patienceMs: 60_000 })], {
      inventory: stock(25),
      dayLengthMs: 20_000,
    });
    let s = serve(makeGlass(createRush(plan)), 0);
    s = makeGlass(s);
    expect(s).toMatchObject({ jug: 8, holdingGlass: true });
    s = hold(s, 20_000);
    expect(s.phase).toBe('closed');
    expect(s).toMatchObject({ jug: 0, holdingGlass: false });
    const o = toOutcome(s);
    expect(o.pouredOut).toBe(9); // 8 in the jug + 1 in hand
    expect(o.used).toEqual(usage(10, 1));
    expect(stockLeft(s)).toEqual({ lemons: 15, sugar: 15, ice: 24, cups: 24 });
    expect(o.leftAtClose).toBe(1);
  });
});

describe('determinism and invariants', () => {
  it('the same plan and the same inputs always give the same outcome', () => {
    const a = play(fixturePlan, (s) => bot(s));
    const b = play(fixturePlan, (s) => bot(s));
    expect(a).toEqual(b);
    expect(toOutcome(a)).toEqual(toOutcome(b));
    // Sanity: a competent player serves most of the fixture day.
    expect(a.served.length).toBeGreaterThanOrEqual(15);
    expectInvariants(a);
  });

  it('step never mutates the state it is given', () => {
    const s = play(fixturePlan, (st) => bot(st), () => 16, deepFreeze);
    expectInvariants(s);
  });

  it('random plans, frame times and key mashing never break the rules (40 seeds)', () => {
    const TYPES: { type: CustomerTypeId; patienceMs: number; tipRate: number }[] = [
      { type: 'kid', patienceMs: 18_000, tipRate: 0 },
      { type: 'jogger', patienceMs: 12_000, tipRate: 0.1 },
      { type: 'jogger', patienceMs: 3_000, tipRate: 0.1 }, // impatient: makes sure walkouts happen
      { type: 'grandma', patienceMs: 25_000, tipRate: 0.3 },
      { type: 'worker', patienceMs: 15_000, tipRate: 0.15 },
    ];
    const seen = {
      served: 0,
      walkouts: 0,
      noRoom: 0,
      soldOut: 0,
      closed: 0,
      partialFills: 0,
      refills: 0,
      pouredOutAtClose: 0,
      soldOutWithLemonadeLeft: 0,
      spills: 0,
      perfect: 0,
      good: 0,
      short: 0,
      jugStars: new Set<number>(),
    };
    const run = (seed: number) => {
      const rand = mulberry32(seed);
      let fills = 0;
      let filled = 0;
      const watch = (s: RushState) => {
        checkStep(s);
        for (const e of s.events) {
          if (e.kind === 'spilled') seen.spills += 1;
          if (e.kind === 'poured') seen[e.grade] += 1;
          if (e.kind === 'jugMade') seen.jugStars.add(e.stars);
          if (e.kind !== 'jugStarted') continue;
          fills += 1;
          filled += e.glasses;
          if (e.glasses < RUSH.jugCapacity) seen.partialFills += 1;
          if (fills === 2) seen.refills += 1;
        }
      };
      const n = Math.floor(rand() * 45);
      const arrivals = Array.from({ length: n }, (_, id) => {
        const t = TYPES[Math.floor(rand() * TYPES.length)];
        return arrival(id, Math.floor(rand() * 120_000), t);
      });
      const inventory = { lemons: Math.floor(rand() * 30), sugar: 30, ice: Math.floor(rand() * 30), cups: 30 };
      const plan = makePlan(arrivals, { inventory, price: 0.5 + Math.floor(rand() * 10) * 0.25 });
      // Alternate between bot play (~3s stretches) and bursts of random key mashing (~0.6s), so long
      // holds like a 2s jug fill sometimes finish and sometimes get interrupted.
      let mashing = false;
      const policy = (s: RushState): RushInput => {
        mashing = mashing ? rand() > 0.05 : rand() < 0.01;
        const mash = { left: rand() < 0.5, right: rand() < 0.5, space: rand() < 0.5, up: rand() < 0.3, down: rand() < 0.3 };
        return mashing ? mash : bot(s, (['perfect', 'perfect', 'short', 'spill'] as const)[s.pours % 4]);
      };
      const s = play(plan, policy, () => 1 + rand() * 60, watch);
      expect(s.used.lemons).toBe(filled); // lemons + sugar used == total filled
      return s;
    };
    for (let seed = 1; seed <= 40; seed++) {
      const s = run(seed);
      expectInvariants(s);
      expect(toOutcome(run(seed))).toEqual(toOutcome(s));
      seen.served += s.served.length;
      seen.walkouts += s.walkouts;
      seen.noRoom += s.noRoom;
      seen.soldOut += s.phase === 'soldOut' ? 1 : 0;
      seen.closed += s.phase === 'closed' ? 1 : 0;
      seen.pouredOutAtClose += s.phase === 'closed' && s.pouredOut > 0 ? 1 : 0;
      seen.soldOutWithLemonadeLeft += s.phase === 'soldOut' && s.pouredOut > 0 ? 1 : 0;
    }
    // The fuzz really exercises every way a customer can leave, both ways a day can end, short fills,
    // refills, and lemonade poured out at closing and at a cup/ice sell-out.
    const { jugStars: stars, ...counts } = seen;
    for (const [what, count] of Object.entries(counts)) expect(count, what).toBeGreaterThan(0);
    expect(stars.size).toBeGreaterThan(1);
  });
});
