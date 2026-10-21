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
  /** Holding Space at the prep station. */
  | { kind: 'prepping'; elapsedMs: number }
  /** Serve lock: nothing else can happen until elapsedMs reaches RUSH.serveMs. */
  | { kind: 'serving'; spot: number; elapsedMs: number };

export type RushPhase = 'open' | 'soldOut' | 'closed';

/** Things that happened during the most recent step(), for the renderer (pop-ups, sounds). */
export type RushEvent =
  | { kind: 'glassReady'; atMs: number }
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
  /** The kid can carry at most one glass. A held glass reserves 1 of each item until served. */
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
  /** Still waiting (or mid-serve) at 5pm. They just leave: not walkouts. Not part of DayOutcome. */
  leftAtClose: number;
  /** Stock consumed so far (1 of each item per completed serve). */
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

/** Opening stock minus what's been used. Includes the glass the kid is holding (reserved, not used). */
export function stockLeft(s: RushState): Inventory {
  const inv = { ...s.plan.inventory };
  for (const item of ITEMS) inv[item] -= s.used[item];
  return inv;
}

/** Glasses the stock can still make, not counting the one the kid is holding. */
export function unreservedGlasses(s: RushState): number {
  return glassesMakeable(stockLeft(s)) - (s.holdingGlass ? 1 : 0);
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

/** 0..1 progress of the current prep or serve, or null when idle. */
export function taskProgress(s: RushState): number | null {
  if (s.task.kind === 'prepping') return clamp(s.task.elapsedMs / RUSH.prepMs, 0, 1);
  if (s.task.kind === 'serving') return clamp(s.task.elapsedMs / RUSH.serveMs, 0, 1);
  return null;
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
 * A Space press (up → down since the last step) can start a serve; holding Space makes a glass.
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

export function toOutcome(s: RushState): DayOutcome {
  return {
    served: s.served.map((r) => ({ ...r })),
    walkouts: s.walkouts,
    noRoom: s.noRoom,
    soldOutMisses: s.soldOutMisses,
    soldOutAtMs: s.soldOutAtMs,
    leftAtClose: s.leftAtClose,
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

  // Prepping needs Space held and the kid standing still; otherwise the half-made glass is dropped.
  if (s.task.kind === 'prepping' && !(input.space && dir === 0)) s.task = IDLE;

  if (s.task.kind === 'idle') {
    const spot = pressed && s.holdingGlass ? customerSpotInReach(s) : null;
    if (spot !== null) {
      s.task = { kind: 'serving', spot, elapsedMs: 0 };
    } else if (input.space && dir === 0 && !s.holdingGlass && atPrepStation(s) && unreservedGlasses(s) > 0) {
      s.task = { kind: 'prepping', elapsedMs: 0 };
    } else {
      s.kidX = clamp(s.kidX + dir * RUSH.kidSpeedPxPerMs * dt, RUSH.kidMinX, RUSH.kidMaxX);
      return;
    }
  }

  // A task started at the top of this slice spends the whole slice on it.
  const task = s.task;
  if (task.kind === 'prepping') {
    if (task.elapsedMs + dt >= RUSH.prepMs) {
      s.task = IDLE;
      s.holdingGlass = true; // reserves 1 of each item
      s.events.push({ kind: 'glassReady', atMs: t0 + (RUSH.prepMs - task.elapsedMs) });
    } else {
      s.task = { ...task, elapsedMs: task.elapsedMs + dt };
    }
  } else if (task.kind === 'serving') {
    if (task.elapsedMs + dt >= RUSH.serveMs) finishServe(s, task.spot, t0 + (RUSH.serveMs - task.elapsedMs));
    else s.task = { ...task, elapsedMs: task.elapsedMs + dt };
  }
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
  for (const item of ITEMS) s.used[item] += 1;
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
      // Walked out: no payment, no stock used (a glass the kid is holding stays reserved for someone else).
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

/** Remove everyone waiting plus everyone yet to arrive; returns how many that was. */
function emptyStand(s: RushState): number {
  const count = s.spots.filter((c) => c !== null).length + (s.queue.length - s.nextArrival);
  s.spots = s.spots.map(() => null);
  s.nextArrival = s.queue.length;
  s.task = IDLE;
  return count;
}

/** Sold out = the unreserved stock can't make a glass and the kid isn't holding one. Ends the day. */
function checkSoldOut(s: RushState, atMs: number): void {
  if (s.phase !== 'open' || s.holdingGlass || glassesMakeable(stockLeft(s)) > 0) return;
  s.phase = 'soldOut';
  s.clockMs = atMs;
  s.soldOutAtMs = atMs;
  s.soldOutMisses += emptyStand(s);
  s.events.push({ kind: 'soldOut', atMs });
}

/** 5pm: everyone still waiting just leaves. A serve still in progress is abandoned (no stock used). */
function close(s: RushState, atMs: number): void {
  s.phase = 'closed';
  s.leftAtClose += emptyStand(s);
  s.events.push({ kind: 'closed', atMs });
}
