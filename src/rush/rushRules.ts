// The Rush (GAME_DESIGN.md §6) as a plain, deterministic state machine. No DOM, no clock, no randomness:
// time only moves through the dtMs passed to step(), so the same plan + the same inputs always give
// the same DayOutcome. RushGame.tsx is just a renderer and keyboard adapter on top of this file.
//
//   createRush(plan) ──step(dt, input)*──► isOver ──► toOutcome(state): DayOutcome
//
// Each step is cut into slices of at most RUSH.maxSliceMs. Every slice runs, in order:
//   1. the kid (finish/continue a task, start a new one, or walk)
//   2. patience drains for everyone waiting (not the customer being served); 0 → walkout
//   3. arrivals due by now take the first free spot, or count as no-room
//   4. 5pm closing
// A serve completing can sell the stand out (step 1), which ends the day on the spot.
//
// Stock flow:
//   lemons + sugar ──fill (used right away)──► jug ──pour (sets aside 1 cup + 1 ice)──► glass in hand
//   ──serve (uses that cup + ice)──► sold
// So used.lemons == used.sugar == glasses filled, used.cups == used.ice == glasses served.
// Lemonade still in the jug or in the kid's hand when the day ends is poured out (DayOutcome.pouredOut):
// its lemons + sugar stay used; the cup + ice of a glass in hand go back to stock.

import type { Arrival, Bar, DayOutcome, DayPlan, Inventory, ServedRecord } from '../contract';
import { ITEMS } from '../contract';
import { RUSH } from './rushConfig';

// ---------- Types ----------

export interface RushInput {
  left: boolean;
  right: boolean;
  /** Level, not edge: true while Space is held. step() detects presses itself. */
  space: boolean;
}

export const NO_INPUT: RushInput = { left: false, right: false, space: false };

export interface WaitingCustomer {
  arrival: Arrival;
  /** Counts down from arrival.patienceMs while waiting. Frozen once the kid starts serving them. */
  patienceLeftMs: number;
}

export type KidTask =
  | { kind: 'idle' }
  /** Holding Space at the prep station with the jug empty. Takes RUSH.fillJugMs. */
  | { kind: 'filling'; elapsedMs: number }
  /** Holding Space at the prep station, empty-handed, with lemonade in the jug. Takes RUSH.pourMs. */
  | { kind: 'pouring'; elapsedMs: number }
  /** Serve lock: nothing else can happen until elapsedMs reaches RUSH.serveMs. */
  | { kind: 'serving'; spot: number; elapsedMs: number };

export type RushPhase = 'open' | 'soldOut' | 'closed';

/** Things that happened during the most recent step(), for the renderer (pop-ups, sounds). */
export type RushEvent =
  | { kind: 'jugFilled'; atMs: number; glasses: number }
  | { kind: 'poured'; atMs: number }
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
  /** The kid can carry at most one glass. It sets aside 1 cup + 1 ice, used only when the serve completes. */
  holdingGlass: boolean;
  task: KidTask;
  /** One entry per spot in RUSH.spotX. */
  spots: (WaitingCustomer | null)[];
  /** Space as of the previous step, to tell a fresh press from a held key. */
  spaceWasDown: boolean;
  served: ServedRecord[];
  walkouts: number;
  noRoom: number;
  soldOutMisses: number;
  soldOutAtMs: number | null;
  /** Still waiting (or mid-serve) at 5pm, or never arrived before closing. They just leave: not walkouts. */
  leftAtClose: number;
  /** Glasses' worth of lemonade thrown away at day end (jug + glass in hand). 0 while the day is open. */
  pouredOut: number;
  /** Stock consumed so far: lemons + sugar when the jug is filled, cups + ice when a serve completes. */
  used: Inventory;
  /** Emitted during the most recent step() only. */
  events: RushEvent[];
}

const IDLE: KidTask = { kind: 'idle' };

// ---------- Small pure helpers ----------

const round2 = (n: number) => Math.round(n * 100) / 100;
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

/** tip = price × tipRate × (1 / 0.5 / 0 on green / yellow / red), rounded to cents. */
export function tipFor(price: number, tipRate: number, bar: Bar): number {
  return round2(price * tipRate * RUSH.tipMultiplier[bar]);
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
 * What holding Space at the prep station would do right now, or null if nothing.
 * Fill: the jug is empty and there are lemons + sugar (cups and ice don't matter).
 * Pour: there's lemonade in the jug, the kid's hands are free, and there's a free cup + ice.
 */
export function stationTask(s: RushState): 'filling' | 'pouring' | null {
  if (s.jug === 0) return fillableGlasses(s) > 0 ? 'filling' : null;
  return !s.holdingGlass && freeCupSets(s) > 0 ? 'pouring' : null;
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

/** How long each timed task takes. */
export function taskDurationMs(kind: 'filling' | 'pouring' | 'serving'): number {
  return { filling: RUSH.fillJugMs, pouring: RUSH.pourMs, serving: RUSH.serveMs }[kind];
}

/** 0..1 progress of the current fill, pour or serve, or null when idle. */
export function taskProgress(s: RushState): number | null {
  if (s.task.kind === 'idle') return null;
  return clamp(s.task.elapsedMs / taskDurationMs(s.task.kind), 0, 1);
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
    holdingGlass: false,
    task: IDLE,
    spots: RUSH.spotX.map(() => null),
    spaceWasDown: false,
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
 * fills the jug (when empty) or pours a glass (when empty-handed).
 * dtMs <= 0 still processes input (e.g. a press) without advancing time.
 */
export function step(state: RushState, dtMs: number, input: RushInput): RushState {
  if (isOver(state)) return state.events.length ? { ...state, events: [] } : state;

  const s = draft(state);
  const pressed = input.space && !state.spaceWasDown;
  let remaining = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  let first = true;
  do {
    const slice = Math.min(remaining, RUSH.maxSliceMs);
    remaining -= slice;
    advance(s, slice, input, first && pressed);
    first = false;
  } while (remaining > 0 && s.phase === 'open');
  s.spaceWasDown = input.space;
  return s;
}

/**
 * The player ended the day from the pause menu: the stand closes right now, exactly as it would at 5pm.
 * Everyone waiting or not yet arrived leaves (counted as leftAtClose, not held against the player),
 * a serve in progress is abandoned, and lemonade in the jug or in hand is poured out.
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

function advance(s: RushState, dt: number, input: RushInput, pressed: boolean): void {
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

function actKid(s: RushState, t0: number, dt: number, input: RushInput, pressed: boolean): void {
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);

  const holdingStill = input.space && dir === 0;

  // Filling and pouring need Space held and the kid standing still; otherwise they're cancelled
  // and start over next time (the jug and the kid's hands are unchanged).
  if ((s.task.kind === 'filling' || s.task.kind === 'pouring') && !holdingStill) s.task = IDLE;

  if (s.task.kind === 'idle') {
    const spot = pressed && s.holdingGlass ? customerSpotInReach(s) : null;
    const atStation = holdingStill && atPrepStation(s) ? stationTask(s) : null;
    if (spot !== null) {
      s.task = { kind: 'serving', spot, elapsedMs: 0 };
    } else if (atStation !== null) {
      s.task = { kind: atStation, elapsedMs: 0 };
    } else {
      s.kidX = clamp(s.kidX + dir * RUSH.kidSpeedPxPerMs * dt, RUSH.kidMinX, RUSH.kidMaxX);
      return;
    }
  }

  // A task started at the top of this slice spends the whole slice on it. Time left over in the slice
  // after a task finishes is not used (the kid acts again next slice).
  const task = s.task;
  if (task.kind === 'idle') return;
  const durationMs = taskDurationMs(task.kind);
  if (task.elapsedMs + dt < durationMs) {
    s.task = { ...task, elapsedMs: task.elapsedMs + dt };
    return;
  }
  const doneAtMs = t0 + (durationMs - task.elapsedMs);
  s.task = IDLE;
  if (task.kind === 'filling') finishFill(s, doneAtMs);
  else if (task.kind === 'pouring') finishPour(s, doneAtMs);
  else finishServe(s, task.spot, doneAtMs);
}

/** The jug takes min(capacity, lemons left, sugar left) glasses. Those lemons + sugar are used right away. */
function finishFill(s: RushState, atMs: number): void {
  s.jug = Math.min(RUSH.jugCapacity, fillableGlasses(s));
  s.used.lemons += s.jug;
  s.used.sugar += s.jug;
  s.events.push({ kind: 'jugFilled', atMs, glasses: s.jug });
}

/** One glass moves from the jug to the kid's hand, setting aside 1 cup + 1 ice until it's served. */
function finishPour(s: RushState, atMs: number): void {
  s.jug -= 1;
  s.holdingGlass = true;
  s.events.push({ kind: 'poured', atMs });
}

function customerSpotInReach(s: RushState): number | null {
  const i = spotInReach(s);
  return i !== null && s.spots[i] ? i : null;
}

function finishServe(s: RushState, spot: number, atMs: number): void {
  // The customer is always there: patience is frozen while being served, and closing ends the day first.
  const c = s.spots[spot]!;
  const bar = barFor(patienceFraction(c));
  const paid = s.plan.price;
  const tip = tipFor(paid, c.arrival.tipRate, bar);
  s.served.push({ arrivalId: c.arrival.id, type: c.arrival.type, paid, tip, bar, atMs });
  s.used.cups += 1; // the lemons + sugar were used when the jug was filled
  s.used.ice += 1;
  s.spots[spot] = null;
  s.holdingGlass = false;
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
  s.holdingGlass = false;
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
 * Only a completed serve can make this newly true, so it's checked there (and at opening).
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
 * 5pm: everyone still waiting just leaves. A serve still in progress is abandoned. Lemonade left in the
 * jug or the kid's hand is poured out.
 */
function close(s: RushState, atMs: number): void {
  s.phase = 'closed';
  s.leftAtClose += emptyStand(s);
  s.events.push({ kind: 'closed', atMs });
}
