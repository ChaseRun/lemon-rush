// The Rush (GAME_DESIGN.md §6) as a plain, deterministic state machine. No DOM, no clock, no randomness:
// time only moves through the dtMs passed to step(), so the same plan + the same inputs always give
// the same DayOutcome. RushGame.tsx is just a renderer and keyboard adapter on top of this file.
//
//   createRush(plan) ──step(dt, input)*──► isOver ──► toOutcome(state): DayOutcome
//
// Each step is cut into slices of at most RUSH.maxSliceMs. Every slice runs, in order:
//   1. the kid (continue a task or mini-game, start a new one, or walk)
//   2. patience drains for everyone waiting (not the customer being served); 0 → walkout
//   3. arrivals due by now take the first free spot, or count as no-room
//   4. 5pm closing
// A serve, a spilled pour or a dumped jug can sell the stand out (step 1), which ends the day on the spot.
//
// Two prep-station actions are short mini-games (graders in miniGames.ts, numbers in RUSH.pour / RUSH.jug).
// The world keeps running during them: patience drains, people arrive and walk out.
//   - Make a jug (jug empty, hold Space): SQUEEZE (alternate <- ->) -> SWEETEN (tap Space on the sweet spot)
//     -> STIR (up right down left, 2 laps). The beat grades give the jug 1-3 stars (tip x0.8 / x1 / x1.25).
//     Holding <- or -> alone for RUSH.jug.walkAwayMs walks away and dumps the jug (its lemonade is poured out).
//   - Pour a glass (jug has lemonade, hands free, hold Space): fill ramps up while held, drips briefly after
//     release, then is graded against a target band: PERFECT x1.2, GOOD x1, SHORT x0.5, or SPILL.
//     Releasing or walking during the first RUSH.pour.tiltMs (before anything flows) cancels for free.
// While a mini-game runs the arrow keys belong to it: the kid doesn't walk.
//
// Stock flow:
//   lemons + sugar --start a jug (used right away)--> jug --pour--> glass in hand (sets aside 1 cup + 1 ice)
//   --serve (uses that cup + ice)--> sold
//   A spilled pour uses 1 cup + 1 ice and its lemonade is poured out.
// So used.lemons == used.sugar == glasses put in jugs, used.cups == used.ice == served + spilled, and every
// glass of lemonade is in the jug, in hand, served, or poured out (spilled, dumped, or left at day end).
// Lemonade still in the jug or in the kid's hand when the day ends is poured out (DayOutcome.pouredOut):
// its lemons + sugar stay used; the cup + ice of a glass in hand go back to stock.

import type { Arrival, Bar, DayOutcome, DayPlan, Inventory, ServedRecord } from '../contract';
import { ITEMS } from '../contract';
import { RUSH } from './rushConfig';
import {
  type BeatGrade,
  type JugBeat,
  type JugStars,
  type PourGrade,
  STIR_ORDER,
  glassTipMultiplier,
  gradePour,
  gradeSqueeze,
  gradeStir,
  gradeSweeten,
  jugStars,
  pourBandCenter,
  pourFill,
  scoopAt,
  sweetSpotFor,
} from './miniGames';

// ---------- Types ----------

export interface RushInput {
  left: boolean;
  right: boolean;
  /** Level, not edge: true while Space is held. step() detects presses itself. */
  space: boolean;
  /** Up / down arrows: only used by the STIR beat. Optional so older callers needn't pass them. */
  up?: boolean;
  down?: boolean;
}

export const NO_INPUT: RushInput = { left: false, right: false, space: false, up: false, down: false };

/** Keys pressed (up -> down) since the previous step. */
interface Pressed {
  space: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}
const NOT_PRESSED: Pressed = { space: false, left: false, right: false, up: false, down: false };

/** The glass in the kid's hand carries how well it was poured and the stars of the jug it came from. */
export interface HeldGlass {
  pour: Exclude<PourGrade, 'spill'>;
  stars: JugStars;
}

/** Pour-to-the-line mini-game. */
export interface PourTask {
  kind: 'pouring';
  /** How long Space has been held (the first RUSH.pour.tiltMs only tilts the jug). */
  holdMs: number;
  /** ms dripped since Space was released, or null while still held. */
  dripMs: number | null;
  /** Target-band center for this glass (0..1 of the glass). */
  center: number;
}

/** Squeeze -> sweeten -> stir mini-game. The jug's lemons + sugar were used when it started. */
export interface JugTask {
  kind: 'makingJug';
  beat: JugBeat;
  /** ms into the current beat. */
  beatMs: number;
  /** Squeeze taps or stir steps landed in this beat. */
  count: number;
  /** Squeeze: the last direction tapped (taps must alternate). */
  lastDir: 'left' | 'right' | null;
  /** Grades of the finished beats, in order. */
  grades: BeatGrade[];
  /** Sweeten: where the sweet spot is for this jug (0..1). */
  sweetSpot: number;
  /** How long <- or -> (alone) has been held: reaching RUSH.jug.walkAwayMs walks away. */
  awayMs: number;
}

export interface WaitingCustomer {
  arrival: Arrival;
  /** Counts down from arrival.patienceMs while waiting. Frozen once the kid starts serving them. */
  patienceLeftMs: number;
}

export type KidTask =
  | { kind: 'idle' }
  /** Started by holding Space at the prep station with the jug empty. */
  | JugTask
  /** Started by holding Space at the prep station, empty-handed, with lemonade in the jug. */
  | PourTask
  /** Serve lock: nothing else can happen until elapsedMs reaches RUSH.serveMs. */
  | { kind: 'serving'; spot: number; elapsedMs: number };

export type RushPhase = 'open' | 'soldOut' | 'closed';

/** Things that happened during the most recent step(), for the renderer (pop-ups, sounds). */
export type RushEvent =
  | { kind: 'jugStarted'; atMs: number; glasses: number }
  | { kind: 'beat'; atMs: number; beat: JugBeat; grade: BeatGrade }
  | { kind: 'jugMade'; atMs: number; glasses: number; stars: JugStars }
  | { kind: 'jugDumped'; atMs: number; glasses: number }
  | { kind: 'poured'; atMs: number; grade: Exclude<PourGrade, 'spill'>; fill: number }
  | { kind: 'spilled'; atMs: number; fill: number }
  | { kind: 'served'; atMs: number; spot: number; amount: number; text: string }
  | { kind: 'walkout'; atMs: number; spot: number }
  | { kind: 'noRoom'; atMs: number; arrivalId: number }
  | { kind: 'soldOut'; atMs: number }
  | { kind: 'closed'; atMs: number };

/** Plain, JSON-serializable data. step() never mutates it; it returns a new state. */
export interface RushState {
  plan: DayPlan;
  /** plan.arrivals sorted by atMs (stable), consumed front to back via nextArrival. */
  queue: Arrival[];
  nextArrival: number;
  /** ms since opening, 0..plan.dayLengthMs. Stops when the stand sells out. */
  clockMs: number;
  phase: RushPhase;
  kidX: number;
  /** Glasses of lemonade in the jug, 0..RUSH.jugCapacity. Their lemons + sugar are already used. Starts empty. */
  jug: number;
  /** Stars of the lemonade in the jug; null while it's empty or still being made. */
  jugStars: JugStars | null;
  /** The kid can carry at most one glass. It sets aside 1 cup + 1 ice, used only when the serve completes. */
  holdingGlass: boolean;
  /** What the glass in hand carries (null exactly when holdingGlass is false). */
  glass: HeldGlass | null;
  /** Pours graded so far today (spills included). Picks each glass's target band. */
  pours: number;
  /** Jugs started today. Picks each jug's sweet spot. */
  jugsStarted: number;
  /** Glasses spilled while pouring (each used 1 cup + 1 ice; its lemonade is in pouredOut). */
  spilled: number;
  /** Glasses' worth of lemonade dumped by walking away mid-jug (also in pouredOut). */
  dumped: number;
  task: KidTask;
  /** One entry per spot in RUSH.spotX. */
  spots: (WaitingCustomer | null)[];
  /** Space as of the previous step, to tell a fresh press from a held key. */
  spaceWasDown: boolean;
  /** Arrow keys as of the previous step (mini-games react to presses, not holds). */
  arrowsWasDown: { left: boolean; right: boolean; up: boolean; down: boolean };
  served: ServedRecord[];
  walkouts: number;
  noRoom: number;
  soldOutMisses: number;
  soldOutAtMs: number | null;
  /** Still waiting (or mid-serve) at 5pm, or never arrived before closing. They just leave: not walkouts. */
  leftAtClose: number;
  /** Glasses' worth of lemonade thrown away: spills + dumped jugs during the day (spilled + dumped), plus
   *  the jug and the glass in hand at day end. */
  pouredOut: number;
  /** Stock consumed so far: lemons + sugar when a jug is started, cups + ice when a serve completes or a pour spills. */
  used: Inventory;
  /** Emitted during the most recent step() only. */
  events: RushEvent[];
}

const IDLE: KidTask = { kind: 'idle' };

// ---------- Small pure helpers ----------

/** Round to cents. The epsilon keeps float noise (0.29999...) from rounding a half-cent down. */
const round2 = (n: number) => Math.round(n * 100 + 1e-7) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Same rule as the engine's glassesMakeable, kept local so the Rush never imports src/core. */
export function glassesMakeable(inv: Inventory): number {
  return Math.max(0, Math.min(...ITEMS.map((item) => inv[item])));
}

/** Patience bar color for a fraction 0..1. Green > 60%, yellow 30–60%, red < 30%. */
export function barFor(fraction: number): Bar {
  if (fraction > RUSH.barThresholds.greenAbove) return 'green';
  if (fraction >= RUSH.barThresholds.redBelow) return 'yellow';
  return 'red';
}

/**
 * tip = price × tipRate × (1 / 0.5 / 0 on green / yellow / red) × the glass's multiplier
 * (pour grade × jug stars, see glassTipMultiplier), rounded to cents.
 */
export function tipFor(price: number, tipRate: number, bar: Bar, glassMultiplier = 1): number {
  return round2(price * tipRate * RUSH.tipMultiplier[bar] * glassMultiplier);
}

export function patienceFraction(c: WaitingCustomer): number {
  return c.arrival.patienceMs > 0 ? clamp(c.patienceLeftMs / c.arrival.patienceMs, 0, 1) : 0;
}

/** "+$2.30" */
export function popupText(amount: number): string {
  return `+$${amount.toFixed(2)}`;
}

// ---------- Selectors (also used by the renderer) ----------

/**
 * Opening stock minus what's been used. Lemons + sugar already in the jug are gone (used at fill time);
 * the cup + ice of the glass in the kid's hand are still counted here (set aside, used at serve time).
 */
export function stockLeft(s: RushState): Inventory {
  const inv = { ...s.plan.inventory };
  for (const item of ITEMS) inv[item] -= s.used[item];
  return inv;
}

/**
 * Lemonade made but not yet served: the jug plus the glass in the kid's hand. Its lemons + sugar are
 * already used; if the day ended now, this is how much would be poured out.
 */
export function reservedGlasses(s: RushState): number {
  return s.jug + (s.holdingGlass ? 1 : 0);
}

/** Glasses of lemonade the remaining lemons + sugar can still make (what a fill can draw on). */
export function fillableGlasses(s: RushState): number {
  const left = stockLeft(s);
  return Math.max(0, Math.min(left.lemons, left.sugar));
}

/** Cup + ice sets not set aside for the glass in the kid's hand (what pours can draw on). */
export function freeCupSets(s: RushState): number {
  const left = stockLeft(s);
  return Math.max(0, Math.min(left.cups, left.ice) - (s.holdingGlass ? 1 : 0));
}

/**
 * Further glasses the remaining stock could still make and serve, on top of the lemonade already made
 * (jug + hand): new lemonade needs lemons + sugar, and every glass, old or new, needs a free cup + ice.
 */
export function unreservedGlasses(s: RushState): number {
  return Math.max(0, Math.min(fillableGlasses(s), freeCupSets(s) - s.jug));
}

/**
 * What holding Space at the prep station would start right now, or null if nothing.
 * Make a jug: the jug is empty and there are lemons + sugar (cups and ice don't matter).
 * Pour: there's lemonade in the jug, the kid's hands are free, and there's a free cup + ice.
 */
export function stationTask(s: RushState): 'makingJug' | 'pouring' | null {
  if (s.jug === 0) return fillableGlasses(s) > 0 ? 'makingJug' : null;
  return !s.holdingGlass && freeCupSets(s) > 0 ? 'pouring' : null;
}

/** Fill level (0..1) of the glass being poured, or null when not pouring. */
export function pourLevel(s: RushState): number | null {
  return s.task.kind === 'pouring' ? pourFill(s.task.holdMs, s.task.dripMs ?? 0) : null;
}

/** True while a prep-station mini-game has the controls. */
export function inMiniGame(s: RushState): boolean {
  return s.task.kind === 'pouring' || s.task.kind === 'makingJug';
}

/** Price + tips earned so far. */
export function earned(s: RushState): number {
  return round2(s.served.reduce((sum, r) => sum + r.paid + r.tip, 0));
}

export function atPrepStation(s: RushState): boolean {
  return Math.abs(s.kidX - RUSH.prepX) <= RUSH.reachPx;
}

/** The spot the kid is standing at, or null. */
export function spotInReach(s: RushState): number | null {
  const i = RUSH.spotX.findIndex((x) => Math.abs(s.kidX - x) <= RUSH.reachPx);
  return i === -1 ? null : i;
}

/** 0..1 progress of the current serve, or null otherwise (mini-games have their own panel). */
export function taskProgress(s: RushState): number | null {
  if (s.task.kind !== 'serving') return null;
  return clamp(s.task.elapsedMs / RUSH.serveMs, 0, 1);
}

export function isOver(s: RushState): boolean {
  return s.phase !== 'open';
}

// ---------- The state machine ----------

export function createRush(plan: DayPlan): RushState {
  const s: RushState = {
    plan,
    queue: [...plan.arrivals].sort((a, b) => a.atMs - b.atMs),
    nextArrival: 0,
    clockMs: 0,
    phase: 'open',
    kidX: RUSH.kidStartX,
    jug: 0,
    jugStars: null,
    holdingGlass: false,
    glass: null,
    pours: 0,
    jugsStarted: 0,
    spilled: 0,
    dumped: 0,
    task: IDLE,
    spots: RUSH.spotX.map(() => null),
    spaceWasDown: false,
    arrowsWasDown: { left: false, right: false, up: false, down: false },
    served: [],
    walkouts: 0,
    noRoom: 0,
    soldOutMisses: 0,
    soldOutAtMs: null,
    leftAtClose: 0,
    pouredOut: 0,
    used: { lemons: 0, sugar: 0, ice: 0, cups: 0 },
    events: [],
  };
  // Opening with no stock: sold out at 9:00, and every arrival is a sold-out miss.
  checkSoldOut(s, 0);
  if (s.phase === 'open') admitArrivals(s, 0);
  if (s.phase === 'open' && plan.dayLengthMs <= 0) close(s, 0);
  return s;
}

/**
 * Advance the Rush by dtMs with the given keys held. Pure: returns a new state.
 * A Space press (up → down since the last step) can start a serve; holding Space at the prep station
 * starts the jug mini-game (when the jug is empty) or the pour mini-game (when empty-handed).
 * dtMs <= 0 still processes input (e.g. a press) without advancing time.
 */
export function step(state: RushState, dtMs: number, input: RushInput): RushState {
  if (isOver(state)) return state.events.length ? { ...state, events: [] } : state;

  const s = draft(state);
  const was = state.arrowsWasDown;
  const up = !!input.up;
  const down = !!input.down;
  const pressed: Pressed = {
    space: input.space && !state.spaceWasDown,
    left: input.left && !was.left,
    right: input.right && !was.right,
    up: up && !was.up,
    down: down && !was.down,
  };
  let remaining = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  let first = true;
  do {
    const slice = Math.min(remaining, RUSH.maxSliceMs);
    remaining -= slice;
    advance(s, slice, input, first ? pressed : NOT_PRESSED);
    first = false;
  } while (remaining > 0 && s.phase === 'open');
  s.spaceWasDown = input.space;
  s.arrowsWasDown = { left: input.left, right: input.right, up, down };
  return s;
}

/**
 * The player ended the day from the pause menu: the stand closes right now, exactly as it would at 5pm.
 * Everyone waiting or not yet arrived leaves (counted as leftAtClose, not held against the player),
 * a serve or mini-game in progress is abandoned (a glass mid-pour was never filled: no cup + ice used),
 * and lemonade in the jug (even a half-made jug) or in hand is poured out.
 */
export function endDayEarly(state: RushState): RushState {
  if (isOver(state)) return state;
  const s = draft(state);
  close(s, s.clockMs);
  return s;
}

export function toOutcome(s: RushState): DayOutcome {
  return {
    served: s.served.map((r) => ({ ...r })),
    walkouts: s.walkouts,
    noRoom: s.noRoom,
    soldOutMisses: s.soldOutMisses,
    soldOutAtMs: s.soldOutAtMs,
    leftAtClose: s.leftAtClose,
    pouredOut: s.pouredOut,
    used: { ...s.used },
  };
}

// ---------- Internals (mutate the private draft only) ----------

/** Copy everything step() may change, so the caller's state is never touched. */
function draft(s: RushState): RushState {
  return {
    ...s,
    spots: s.spots.map((c) => (c ? { ...c } : null)),
    served: [...s.served],
    used: { ...s.used },
    events: [],
  };
}

function advance(s: RushState, dt: number, input: RushInput, pressed: Pressed): void {
  const t0 = s.clockMs;
  const t1 = Math.min(t0 + dt, s.plan.dayLengthMs);
  const sliceMs = t1 - t0;
  s.clockMs = t1;

  actKid(s, t0, sliceMs, input, pressed);
  if (s.phase !== 'open') return; // a serve just sold the stand out
  drainPatience(s, t0, sliceMs);
  admitArrivals(s, t1);
  if (t1 >= s.plan.dayLengthMs) close(s, t1);
}

function actKid(s: RushState, t0: number, dt: number, input: RushInput, pressed: Pressed): void {
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);

  // Mini-games own the controls. A pour cancelled during its tilt hands the slice back (the kid may walk).
  if (s.task.kind === 'pouring' && pourTick(s, s.task, t0, dt, input, dir)) return;
  if (s.task.kind === 'makingJug') return jugTick(s, s.task, t0, dt, input, pressed);

  if (s.task.kind === 'idle') {
    const spot = pressed.space && s.holdingGlass ? customerSpotInReach(s) : null;
    const atStation = input.space && dir === 0 && atPrepStation(s) ? stationTask(s) : null;
    if (spot !== null) {
      s.task = { kind: 'serving', spot, elapsedMs: 0 };
    } else if (atStation === 'makingJug') {
      // This slice is spent setting up; the beat clock starts next slice.
      return startJug(s, t0);
    } else if (atStation === 'pouring') {
      s.task = { kind: 'pouring', holdMs: 0, dripMs: null, center: pourBandCenter(s.pours) };
      pourTick(s, s.task, t0, dt, input, dir);
      return;
    } else {
      s.kidX = clamp(s.kidX + dir * RUSH.kidSpeedPxPerMs * dt, RUSH.kidMinX, RUSH.kidMaxX);
      return;
    }
  }

  // Serving. A serve started at the top of this slice spends the whole slice on it. Time left over in the
  // slice after it finishes is not used (the kid acts again next slice).
  const task = s.task;
  if (task.kind !== 'serving') return;
  if (task.elapsedMs + dt < RUSH.serveMs) {
    s.task = { ...task, elapsedMs: task.elapsedMs + dt };
    return;
  }
  finishServe(s, task.spot, t0 + (RUSH.serveMs - task.elapsedMs));
}

// ---------- Pour to the line ----------

/**
 * One slice of the pour. Returns false if it was cancelled before anything flowed (nothing used; the
 * caller lets the kid act normally), true if the slice was spent pouring (or the pour just finished).
 */
function pourTick(s: RushState, task: PourTask, t0: number, dt: number, input: RushInput, dir: number): boolean {
  let { holdMs, dripMs } = task;
  if (dripMs === null) {
    const flowing = holdMs > RUSH.pour.tiltMs;
    if (!flowing && (!input.space || dir !== 0)) {
      s.task = IDLE;
      return false;
    }
    // Once lemonade flows the arrows are captured: only letting go of Space stops the pour.
    if (input.space) holdMs += dt;
    else dripMs = dt;
  } else {
    dripMs += dt;
  }
  const fill = pourFill(holdMs, dripMs ?? 0);
  if (fill >= RUSH.pour.brim || (dripMs !== null && dripMs >= RUSH.pour.dripMs)) {
    finishPour(s, t0 + dt, fill, task.center);
  } else {
    s.task = { ...task, holdMs, dripMs };
  }
  return true;
}

/**
 * Grade the glass. Not a spill: one glass moves from the jug to the kid's hand (setting aside 1 cup + 1 ice),
 * carrying its pour grade and the jug's stars. Spill: the glass's lemonade is lost (poured out), its
 * cup + ice are used, and the kid stays empty-handed. Either way the jug goes down by 1.
 */
function finishPour(s: RushState, atMs: number, fill: number, center: number): void {
  const grade = gradePour(fill, center);
  const stars = s.jugStars ?? 1;
  s.task = IDLE;
  s.pours += 1;
  s.jug -= 1;
  if (s.jug === 0) s.jugStars = null;
  if (grade === 'spill') {
    s.used.cups += 1;
    s.used.ice += 1;
    s.spilled += 1;
    s.pouredOut += 1;
    s.events.push({ kind: 'spilled', atMs, fill });
    checkSoldOut(s, atMs);
    return;
  }
  s.holdingGlass = true;
  s.glass = { pour: grade, stars };
  s.events.push({ kind: 'poured', atMs, grade, fill });
}

// ---------- Make a jug: squeeze -> sweeten -> stir ----------

/** The jug takes min(capacity, lemons left, sugar left) glasses. Those lemons + sugar are used right away. */
function startJug(s: RushState, atMs: number): void {
  s.jug = Math.min(RUSH.jugCapacity, fillableGlasses(s));
  s.jugStars = null;
  s.used.lemons += s.jug;
  s.used.sugar += s.jug;
  s.task = {
    kind: 'makingJug',
    beat: 'squeeze',
    beatMs: 0,
    count: 0,
    lastDir: null,
    grades: [],
    sweetSpot: sweetSpotFor(s.jugsStarted),
    awayMs: 0,
  };
  s.jugsStarted += 1;
  s.events.push({ kind: 'jugStarted', atMs, glasses: s.jug });
}

/** One slice of the jug mini-game. Presses land at the current beatMs, then the beat clock advances. */
function jugTick(s: RushState, prev: JugTask, t0: number, dt: number, input: RushInput, pressed: Pressed): void {
  const task: JugTask = { ...prev, grades: [...prev.grades] };
  s.task = task;

  // Walking away: <- or -> held on its own (no fresh arrow press) for walkAwayMs.
  const oneSide = input.left !== input.right;
  const freshArrow = pressed.left || pressed.right || pressed.up || pressed.down;
  task.awayMs = oneSide && !freshArrow ? task.awayMs + dt : 0;
  if (task.awayMs >= RUSH.jug.walkAwayMs) return dumpJug(s, t0 + dt);

  if (task.beat === 'squeeze') {
    const c = RUSH.jug.squeeze;
    for (const d of ['left', 'right'] as const) {
      if (pressed[d] && task.lastDir !== d && task.count < c.taps) {
        task.count += 1;
        task.lastDir = d;
      }
    }
    if (task.count >= c.taps) return nextBeat(s, task, gradeSqueeze(task.count, task.beatMs), t0);
    task.beatMs += dt;
    if (task.beatMs >= c.windowMs) nextBeat(s, task, gradeSqueeze(task.count, null), t0 + dt);
    return;
  }

  if (task.beat === 'sweeten') {
    if (pressed.space) return nextBeat(s, task, gradeSweeten(scoopAt(task.beatMs), task.sweetSpot), t0);
    task.beatMs += dt;
    if (task.beatMs >= RUSH.jug.sweeten.windowMs) nextBeat(s, task, gradeSweeten(null, task.sweetSpot), t0 + dt);
    return;
  }

  const c = RUSH.jug.stir;
  // Several keys pressed in the same step can complete several steps of the circle, in order.
  for (let i = 0; i < STIR_ORDER.length && task.count < c.steps; i++) {
    if (!pressed[STIR_ORDER[task.count % STIR_ORDER.length]]) break;
    task.count += 1;
  }
  if (task.count >= c.steps) return nextBeat(s, task, gradeStir(task.count, task.beatMs), t0);
  task.beatMs += dt;
  if (task.beatMs >= c.windowMs) nextBeat(s, task, gradeStir(task.count, null), t0 + dt);
}

const BEATS: readonly JugBeat[] = ['squeeze', 'sweeten', 'stir'];

function nextBeat(s: RushState, task: JugTask, grade: BeatGrade, atMs: number): void {
  task.grades.push(grade);
  s.events.push({ kind: 'beat', atMs, beat: task.beat, grade });
  const next = BEATS[BEATS.indexOf(task.beat) + 1];
  if (next) {
    task.beat = next;
    task.beatMs = 0;
    task.count = 0;
    task.lastDir = null;
    return;
  }
  const stars = jugStars(task.grades);
  s.jugStars = stars;
  s.task = IDLE;
  s.events.push({ kind: 'jugMade', atMs, glasses: s.jug, stars });
}

/** Walked away mid-jug: its lemonade is lost right now (lemons + sugar stay used; counted in pouredOut). */
function dumpJug(s: RushState, atMs: number): void {
  const glasses = s.jug;
  s.dumped += glasses;
  s.pouredOut += glasses;
  s.jug = 0;
  s.jugStars = null;
  s.task = IDLE;
  s.events.push({ kind: 'jugDumped', atMs, glasses });
  checkSoldOut(s, atMs);
}

// ---------- Serving ----------

function customerSpotInReach(s: RushState): number | null {
  const i = spotInReach(s);
  return i !== null && s.spots[i] ? i : null;
}

function finishServe(s: RushState, spot: number, atMs: number): void {
  // The customer is always there: patience is frozen while being served, and closing ends the day first.
  const c = s.spots[spot]!;
  const bar = barFor(patienceFraction(c));
  const paid = s.plan.price;
  const glass = s.glass ?? { pour: 'good', stars: 2 };
  const tip = tipFor(paid, c.arrival.tipRate, bar, glassTipMultiplier(glass.pour, glass.stars));
  s.served.push({ arrivalId: c.arrival.id, type: c.arrival.type, paid, tip, bar, atMs });
  s.used.cups += 1; // the lemons + sugar were used when the jug was filled
  s.used.ice += 1;
  s.spots[spot] = null;
  s.holdingGlass = false;
  s.glass = null;
  s.task = IDLE;
  s.events.push({ kind: 'served', atMs, spot, amount: round2(paid + tip), text: popupText(paid + tip) });
  checkSoldOut(s, atMs);
}

function drainPatience(s: RushState, t0: number, dt: number): void {
  const beingServed = s.task.kind === 'serving' ? s.task.spot : -1;
  s.spots.forEach((c, i) => {
    if (!c || i === beingServed) return;
    const before = c.patienceLeftMs;
    c.patienceLeftMs = Math.max(0, before - dt);
    if (c.patienceLeftMs <= 0) {
      // Walked out: no payment, no stock used (a glass the kid is holding stays in hand for someone else).
      s.spots[i] = null;
      s.walkouts += 1;
      s.events.push({ kind: 'walkout', atMs: t0 + Math.min(before, dt), spot: i });
    }
  });
}

function admitArrivals(s: RushState, now: number): void {
  while (s.nextArrival < s.queue.length && s.queue[s.nextArrival].atMs <= now) {
    const arrival = s.queue[s.nextArrival];
    s.nextArrival += 1;
    const free = s.spots.indexOf(null);
    if (free === -1) {
      s.noRoom += 1;
      s.events.push({ kind: 'noRoom', atMs: arrival.atMs, arrivalId: arrival.id });
    } else {
      s.spots[free] = { arrival, patienceLeftMs: arrival.patienceMs };
    }
  }
}

/**
 * Day end: remove everyone waiting plus everyone yet to arrive (returns how many that was), and pour out
 * the lemonade in the jug and in hand. Its lemons + sugar stay used; the held glass's cup + ice go back.
 */
function emptyStand(s: RushState): number {
  const count = s.spots.filter((c) => c !== null).length + (s.queue.length - s.nextArrival);
  s.spots = s.spots.map(() => null);
  s.nextArrival = s.queue.length;
  s.task = IDLE;
  s.pouredOut += reservedGlasses(s);
  s.jug = 0;
  s.jugStars = null;
  s.holdingGlass = false;
  s.glass = null;
  return count;
}

/** The kid can't get another glass to a customer: none in hand, and no way to pour one. */
function cannotProduceGlass(s: RushState): boolean {
  if (s.holdingGlass) return false;
  const jugStuckEmpty = s.jug === 0 && fillableGlasses(s) === 0;
  return jugStuckEmpty || freeCupSets(s) === 0;
}

/**
 * Sold out = not holding a glass, and either the jug is empty with no lemons or sugar to refill it, or
 * there's no free cup + ice to pour into. Ends the day; any lemonade left in the jug is poured out.
 * Only a completed serve, a spill or a dumped jug can make this newly true, so it's checked there
 * (and at opening).
 */
function checkSoldOut(s: RushState, atMs: number): void {
  if (s.phase !== 'open' || !cannotProduceGlass(s)) return;
  s.phase = 'soldOut';
  s.clockMs = atMs;
  s.soldOutAtMs = atMs;
  s.soldOutMisses += emptyStand(s);
  s.events.push({ kind: 'soldOut', atMs });
}

/**
 * 5pm: everyone still waiting just leaves. A serve or mini-game still in progress is abandoned. Lemonade
 * left in the jug (even a half-made jug) or the kid's hand is poured out.
 */
function close(s: RushState, atMs: number): void {
  s.phase = 'closed';
  s.leftAtClose += emptyStand(s);
  s.events.push({ kind: 'closed', atMs });
}
