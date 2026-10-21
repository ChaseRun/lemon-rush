// Rules for the window-style Rush: a pure, deterministic state machine. No DOM, no clock, no randomness.
// The view feeds it (dtMs, input) once per frame and draws whatever comes back.
//
// The player stands behind a service window. Arrivals join one line; the first `windows` people in it are
// at a window and can be handed a glass. Lemonade comes from a 10-glass jug made through three graded
// mini-games (squeeze → sugar → stir); each glass is placed, iced, poured (a timing mini-game) and handed over.
//
// Stock rules match the engine (GAME_DESIGN §6): making a jug uses min(10, lemons, sugar) lemons + sugar
// right away; a glass reserves 1 cup + 1 ice when placed and uses them when served or spilled.

import type { Arrival, Bar, DayOutcome, DayPlan, Inventory, ServedRecord } from '../contract';
import { type Grade, type PourGrade, type WindowConfig, WINDOW_CONFIG } from './windowConfig';

// ---------- Pure grading helpers ----------

/** Patience bar color for the fraction of patience left (1 = just arrived, 0 = walking out). */
export function barFor(fractionLeft: number, cfg: WindowConfig = WINDOW_CONFIG): Bar {
  if (fractionLeft > cfg.bar.greenAbove) return 'green';
  if (fractionLeft >= cfg.bar.yellowFrom) return 'yellow';
  return 'red';
}

/** Squeeze: `taps` taps, `elapsedMs` from the first tap. Full fast = Perfect, full in the window = Good, else OK. */
export function gradeSqueeze(taps: number, elapsedMs: number, cfg: WindowConfig = WINDOW_CONFIG): Grade {
  const c = cfg.squeeze;
  if (taps < c.taps) return 'ok';
  if (elapsedMs <= c.perfectMs) return 'perfect';
  if (elapsedMs <= c.windowMs) return 'good';
  return 'ok';
}

/** Sugar: distance of the released level from the band center. */
export function gradeSugar(level: number, center: number, cfg: WindowConfig = WINDOW_CONFIG): Grade {
  const d = Math.abs(level - center);
  if (d <= cfg.sugar.perfectTol + 1e-9) return 'perfect';
  if (d <= cfg.sugar.bandHalf + 1e-9) return 'good';
  return 'ok';
}

/** Stir: `strokes` direction changes, `elapsedMs` from the first stroke. */
export function gradeStir(strokes: number, elapsedMs: number, cfg: WindowConfig = WINDOW_CONFIG): Grade {
  const c = cfg.stir;
  if (strokes < c.strokes) return 'ok';
  if (elapsedMs <= c.perfectMs) return 'perfect';
  if (elapsedMs <= c.goodMs) return 'good';
  return 'ok';
}

/** Pour: released fill level (0 = empty glass, upperLine = brim line). */
export function gradePour(fill: number, cfg: WindowConfig = WINDOW_CONFIG): PourGrade {
  if (fill > cfg.pour.upperLine) return 'spill';
  if (fill >= cfg.pour.lowerLine) return 'perfect';
  return 'under';
}

/** The three step grades combine into one jug quality. */
export function gradeJug(squeeze: Grade, sugar: Grade, stir: Grade, cfg: WindowConfig = WINDOW_CONFIG): Grade {
  const pts = cfg.jugPoints[squeeze] + cfg.jugPoints[sugar] + cfg.jugPoints[stir];
  if (pts >= cfg.jugPerfectFrom) return 'perfect';
  if (pts >= cfg.jugGoodFrom) return 'good';
  return 'ok';
}

/** Round to cents. The epsilon keeps float noise (0.12499999…) from rounding a half-cent down. */
const round2 = (n: number) => Math.round(n * 100 + 1e-7) / 100;

/** Tip = price × tipRate × bar multiplier × pour multiplier × jug quality multiplier, rounded to cents. */
export function tipFor(
  price: number,
  tipRate: number,
  bar: Bar,
  pour: Exclude<PourGrade, 'spill'>,
  jug: Grade,
  cfg: WindowConfig = WINDOW_CONFIG,
): number {
  return round2(price * tipRate * cfg.barTip[bar] * cfg.pourTip[pour] * cfg.jugTip[jug]);
}

// ---------- State ----------

export interface LineCustomer {
  arrival: Arrival;
  /** When they joined the line (= arrival.atMs). Patience drains from here. */
  joinedAtMs: number;
}

/** The jug mini-game in progress. Each step remembers the grades before it. */
export type JugStep =
  | { kind: 'squeeze'; taps: number; elapsedMs: number; started: boolean }
  | { kind: 'sugarReady'; squeeze: Grade }
  | { kind: 'sugar'; squeeze: Grade; level: number; pouring: boolean; center: number }
  | { kind: 'stir'; squeeze: Grade; sugar: Grade; strokes: number; lastDir: 'left' | 'right' | null; elapsedMs: number; started: boolean };

export interface Jug {
  /** Glasses' worth of lemonade in the jug (already paid for in lemons + sugar). */
  glasses: number;
  /** Quality of the lemonade in it; null while empty or still being made. */
  quality: Grade | null;
  /** Non-null while the squeeze / sugar / stir mini-game runs. The jug can't pour until it's done. */
  making: JugStep | null;
}

export interface Glass {
  ice: boolean;
  /** empty: placed (cup + ice reserved). pouring: Space held. poured: ready to hand over. */
  phase: 'empty' | 'pouring' | 'poured';
  /** 0..upperLine (anything past upperLine is a spill). */
  fill: number;
  pour: Exclude<PourGrade, 'spill'> | null;
  /** Quality of the jug this glass was poured from. */
  jugQuality: Grade | null;
}

export type WindowEvent =
  | { type: 'arrive'; id: number }
  | { type: 'noRoom'; id: number }
  | { type: 'walkout'; id: number }
  | { type: 'grade'; step: 'squeeze' | 'sugar' | 'stir'; grade: Grade }
  | { type: 'jugReady'; glasses: number; quality: Grade }
  | { type: 'jugStarted'; glasses: number }
  | { type: 'glassPlaced' }
  | { type: 'iced' }
  | { type: 'poured'; grade: Exclude<PourGrade, 'spill'> }
  | { type: 'spill' }
  | { type: 'served'; record: ServedRecord; window: number }
  | { type: 'blocked'; reason: string }
  | { type: 'soldOut' }
  | { type: 'closed' };

export interface WindowRushState {
  plan: DayPlan;
  config: WindowConfig;
  timeMs: number;
  /** Index into plan.arrivals of the next person who hasn't shown up yet. */
  nextArrival: number;
  /** Front `config.windows` entries stand at a window. */
  line: LineCustomer[];
  jug: Jug;
  jugsMade: number;
  glass: Glass | null;
  /** Space held at the end of the last step (for press detection). */
  spaceDown: boolean;
  used: Inventory;
  /** Total glasses' worth ever put in a jug (= used lemons = used sugar). */
  filled: number;
  spilled: number;
  served: ServedRecord[];
  earned: number;
  walkouts: number;
  noRoom: number;
  soldOutMisses: number;
  soldOutAtMs: number | null;
  leftAtClose: number;
  pouredOut: number;
  over: boolean;
  endReason: 'closed' | 'soldOut' | null;
  /** Events emitted by the most recent step (or by create). The view turns these into pops and sounds. */
  events: WindowEvent[];
}

export type WindowAction =
  /** Lemon crate: start a jug (only when it's empty). */
  | { type: 'lemons' }
  /** Sugar bag: begin the sugar step once the squeeze is done. */
  | { type: 'sugar' }
  /** Cooler: drop an ice cube into the placed glass. */
  | { type: 'ice' }
  /** Cup stack: place a glass (reserves 1 cup + 1 ice). */
  | { type: 'cup' }
  /** Hand the poured glass to the customer at a window (default: window 0). */
  | { type: 'handOver'; window?: number }
  /** A stir stroke (← / → or a mouse swing). */
  | { type: 'stir'; dir: 'left' | 'right' };

export interface WindowInput {
  /** Space is held this frame. A press is a false → true change between steps. */
  space: boolean;
  /** One-shot actions (clicks, key presses) since the last step, applied in order before time advances. */
  actions?: readonly WindowAction[];
}

// ---------- Stock helpers ----------

/** Stock not yet used (a placed glass's reservation still counts as available here). */
function left(s: WindowRushState, item: keyof Inventory): number {
  return s.plan.inventory[item] - s.used[item];
}

/** Cups and ice free to place a new glass (excludes the one reserved by a glass on the counter). */
export function freeForGlass(s: WindowRushState): { cups: number; ice: number } {
  const reserved = s.glass ? 1 : 0;
  return { cups: left(s, 'cups') - reserved, ice: left(s, 'ice') - reserved };
}

export function lemonsLeft(s: WindowRushState): number {
  return left(s, 'lemons');
}
export function sugarLeft(s: WindowRushState): number {
  return left(s, 'sugar');
}

/** True if the glass on the counter already holds lemonade. */
function glassHasLemonade(g: Glass | null): boolean {
  return g !== null && g.phase !== 'empty';
}

/**
 * Can another glass still reach a customer? A glass holding lemonade always can. Otherwise we need a
 * cup + ice (an empty placed glass's reservation counts) and lemonade in the jug or the makings of a jug.
 */
export function canProduce(s: WindowRushState): boolean {
  if (glassHasLemonade(s.glass)) return true;
  if (left(s, 'cups') < 1 || left(s, 'ice') < 1) return false;
  if (s.jug.glasses > 0) return true;
  return left(s, 'lemons') >= 1 && left(s, 'sugar') >= 1;
}

/** Fraction of patience left for a customer at time t (1 → 0). */
export function patienceLeft(c: LineCustomer, t: number): number {
  const p = c.arrival.patienceMs;
  if (p <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - (t - c.joinedAtMs) / p));
}

// ---------- Create / step ----------

export function createWindowRush(plan: DayPlan, config: WindowConfig = WINDOW_CONFIG): WindowRushState {
  const s: WindowRushState = {
    plan,
    config,
    timeMs: 0,
    nextArrival: 0,
    line: [],
    jug: { glasses: 0, quality: null, making: null },
    jugsMade: 0,
    glass: null,
    spaceDown: false,
    used: { lemons: 0, sugar: 0, ice: 0, cups: 0 },
    filled: 0,
    spilled: 0,
    served: [],
    earned: 0,
    walkouts: 0,
    noRoom: 0,
    soldOutMisses: 0,
    soldOutAtMs: null,
    leftAtClose: 0,
    pouredOut: 0,
    over: false,
    endReason: null,
    events: [],
  };
  // Nothing to sell at all: the stand is sold out before it opens.
  if (!canProduce(s)) endSoldOut(s);
  return s;
}

export function isOver(s: WindowRushState): boolean {
  return s.over;
}

function clone(s: WindowRushState): WindowRushState {
  return {
    ...s,
    line: s.line.slice(),
    jug: { ...s.jug, making: s.jug.making ? { ...s.jug.making } : null },
    glass: s.glass ? { ...s.glass } : null,
    used: { ...s.used },
    served: s.served.slice(),
    events: [],
  };
}

export function step(state: WindowRushState, dtMs: number, input: WindowInput): WindowRushState {
  if (state.over) return state.events.length ? { ...state, events: [] } : state;
  const s = clone(state);
  const dayEnd = s.plan.dayLengthMs;
  const dt = Math.max(0, Math.min(Number.isFinite(dtMs) ? dtMs : 0, dayEnd - s.timeMs));
  const pressed = input.space && !s.spaceDown;

  // 1. Clicks and key presses happen "now", before time moves.
  for (const a of input.actions ?? []) applyAction(s, a);
  if (!canProduce(s)) {
    endSoldOut(s);
    s.spaceDown = input.space;
    return s;
  }

  // 2. Timed mini-games driven by Space (and the stir clock).
  tickJug(s, dt, input.space, pressed);
  tickPour(s, dt, input.space, pressed);
  s.spaceDown = input.space;

  // 3. Advance the clock: arrivals and walkouts in time order.
  advanceLine(s, s.timeMs + dt);
  s.timeMs += dt;

  // 4. End conditions.
  if (!canProduce(s)) endSoldOut(s);
  else if (s.timeMs >= dayEnd) endClosed(s);
  return s;
}

// ---------- Actions ----------

function block(s: WindowRushState, reason: string) {
  s.events.push({ type: 'blocked', reason });
}

function applyAction(s: WindowRushState, a: WindowAction) {
  switch (a.type) {
    case 'lemons':
      return startJug(s);
    case 'sugar': {
      const m = s.jug.making;
      if (m?.kind !== 'sugarReady') return block(s, m ? 'Not yet!' : 'Start a jug with the lemons first');
      const centers = s.config.sugar.centers;
      s.jug.making = { kind: 'sugar', squeeze: m.squeeze, level: 0, pouring: false, center: centers[s.jugsMade % centers.length] };
      return;
    }
    case 'stir': {
      const m = s.jug.making;
      if (m?.kind !== 'stir') return;
      if (m.lastDir === a.dir) return; // must alternate
      if (!m.started) {
        m.started = true;
        m.elapsedMs = 0;
      }
      m.lastDir = a.dir;
      m.strokes += 1;
      if (m.strokes >= s.config.stir.strokes) finishStir(s, m);
      return;
    }
    case 'cup': {
      if (s.glass) return block(s, 'One glass at a time');
      const free = freeForGlass(s);
      if (free.cups < 1) return block(s, 'Out of cups!');
      if (free.ice < 1) return block(s, 'Out of ice!');
      s.glass = { ice: false, phase: 'empty', fill: 0, pour: null, jugQuality: null };
      s.events.push({ type: 'glassPlaced' });
      return;
    }
    case 'ice': {
      if (!s.glass) return block(s, 'Place a cup first');
      if (s.glass.ice) return block(s, 'Already iced');
      s.glass.ice = true;
      s.events.push({ type: 'iced' });
      return;
    }
    case 'handOver':
      return handOver(s, a.window ?? 0);
  }
}

function startJug(s: WindowRushState) {
  if (s.jug.making) return block(s, 'Already making a jug');
  if (s.jug.glasses > 0) return block(s, 'Jug still has lemonade');
  const glasses = Math.min(s.config.jugCapacity, lemonsLeft(s), sugarLeft(s));
  if (glasses < 1) return block(s, lemonsLeft(s) < 1 ? 'Out of lemons!' : 'Out of sugar!');
  // Filling uses the lemons + sugar immediately (matches the engine).
  s.used.lemons += glasses;
  s.used.sugar += glasses;
  s.filled += glasses;
  s.jugsMade += 1;
  s.jug = { glasses, quality: null, making: { kind: 'squeeze', taps: 0, elapsedMs: 0, started: false } };
  s.events.push({ type: 'jugStarted', glasses });
}

function handOver(s: WindowRushState, window: number) {
  const g = s.glass;
  if (!g || g.phase !== 'poured' || !g.pour || !g.jugQuality) return block(s, g ? 'Finish the glass first' : 'No glass ready');
  if (window < 0 || window >= s.config.windows) return;
  const c = s.line[window];
  if (!c) return block(s, 'Nobody at the window');
  const bar = barFor(patienceLeft(c, s.timeMs), s.config);
  const paid = s.plan.price;
  const tip = tipFor(paid, c.arrival.tipRate, bar, g.pour, g.jugQuality, s.config);
  const record: ServedRecord = { arrivalId: c.arrival.id, type: c.arrival.type, paid, tip, bar, atMs: s.timeMs };
  s.served.push(record);
  s.earned = round2(s.earned + paid + tip);
  s.used.cups += 1;
  s.used.ice += 1;
  s.glass = null;
  s.line.splice(window, 1);
  s.events.push({ type: 'served', record, window });
}

// ---------- Timed mini-games ----------

function tickJug(s: WindowRushState, dt: number, space: boolean, pressed: boolean) {
  const m = s.jug.making;
  if (!m) return;
  const cfg = s.config;
  switch (m.kind) {
    case 'squeeze': {
      if (m.started) m.elapsedMs += dt;
      if (pressed) {
        if (!m.started) {
          m.started = true;
          m.elapsedMs = 0;
        }
        m.taps += 1;
      }
      if (m.taps >= cfg.squeeze.taps || (m.started && m.elapsedMs >= cfg.squeeze.windowMs)) {
        const grade = gradeSqueeze(m.taps, m.elapsedMs, cfg);
        s.events.push({ type: 'grade', step: 'squeeze', grade });
        s.jug.making = { kind: 'sugarReady', squeeze: grade };
      }
      return;
    }
    case 'sugar': {
      if (!m.pouring && pressed) m.pouring = true;
      if (!m.pouring) return;
      if (space) {
        m.level = Math.min(1, m.level + dt * cfg.sugar.ratePerMs);
        if (m.level < 1) return;
      }
      // Released (or the bag ran to the top).
      const grade = gradeSugar(m.level, m.center, cfg);
      s.events.push({ type: 'grade', step: 'sugar', grade });
      s.jug.making = { kind: 'stir', squeeze: m.squeeze, sugar: grade, strokes: 0, lastDir: null, elapsedMs: 0, started: false };
      return;
    }
    case 'stir': {
      if (!m.started) return;
      m.elapsedMs += dt;
      if (m.elapsedMs >= cfg.stir.limitMs) finishStir(s, m);
      return;
    }
    case 'sugarReady':
      return;
  }
}

function finishStir(s: WindowRushState, m: Extract<JugStep, { kind: 'stir' }>) {
  const grade = gradeStir(m.strokes, m.elapsedMs, s.config);
  s.events.push({ type: 'grade', step: 'stir', grade });
  const quality = gradeJug(m.squeeze, m.sugar, grade, s.config);
  s.jug = { glasses: s.jug.glasses, quality, making: null };
  s.events.push({ type: 'jugReady', glasses: s.jug.glasses, quality });
}

function tickPour(s: WindowRushState, dt: number, space: boolean, pressed: boolean) {
  const g = s.glass;
  if (!g) return;
  const cfg = s.config;
  if (g.phase === 'empty') {
    if (!pressed || !g.ice) return;
    if (s.jug.making || s.jug.glasses < 1 || !s.jug.quality) return; // nothing to pour yet
    // Each pour takes one glass out of the jug, whatever happens next.
    s.jug.glasses -= 1;
    g.phase = 'pouring';
    g.jugQuality = s.jug.quality;
    if (s.jug.glasses === 0) s.jug.quality = null;
  }
  if (g.phase !== 'pouring') return;
  if (space) {
    g.fill += dt * cfg.pour.ratePerMs;
    if (gradePour(g.fill, cfg) === 'spill') {
      // Overflow: the lemonade is lost; the cup and ice are used (wasted).
      s.spilled += 1;
      s.pouredOut += 1;
      s.used.cups += 1;
      s.used.ice += 1;
      s.glass = null;
      s.events.push({ type: 'spill' });
    }
    return;
  }
  const grade = gradePour(g.fill, cfg);
  if (grade === 'spill') return; // unreachable: spills resolve while held
  g.phase = 'poured';
  g.pour = grade;
  s.events.push({ type: 'poured', grade });
}

// ---------- The line ----------

/** Process arrivals and walkouts up to time `to`, in time order (a walkout at the same moment frees room first). */
function advanceLine(s: WindowRushState, to: number) {
  const arrivals = s.plan.arrivals;
  for (;;) {
    const nextArr = s.nextArrival < arrivals.length ? arrivals[s.nextArrival].atMs : Infinity;
    let walkIdx = -1;
    let walkAt = Infinity;
    for (let i = 0; i < s.line.length; i++) {
      const c = s.line[i];
      const at = c.joinedAtMs + c.arrival.patienceMs;
      if (at < walkAt) {
        walkAt = at;
        walkIdx = i;
      }
    }
    if (walkAt <= to && walkAt <= nextArr) {
      const [c] = s.line.splice(walkIdx, 1);
      s.walkouts += 1;
      s.events.push({ type: 'walkout', id: c.arrival.id });
      continue;
    }
    if (nextArr <= to) {
      const a = arrivals[s.nextArrival++];
      if (s.line.length >= s.config.maxLine) {
        s.noRoom += 1;
        s.events.push({ type: 'noRoom', id: a.id });
      } else {
        s.line.push({ arrival: a, joinedAtMs: a.atMs });
        s.events.push({ type: 'arrive', id: a.id });
      }
      continue;
    }
    return;
  }
}

// ---------- Endings ----------

/** Lemonade in the jug and in a glass in hand is poured out; an unfinished glass's cup + ice go back to stock. */
function pourOutLeftovers(s: WindowRushState) {
  s.pouredOut += s.jug.glasses + (glassHasLemonade(s.glass) ? 1 : 0);
  s.jug = { glasses: 0, quality: null, making: null };
  s.glass = null;
}

function endSoldOut(s: WindowRushState) {
  const notYet = s.plan.arrivals.length - s.nextArrival;
  s.soldOutMisses += s.line.length + notYet;
  s.nextArrival = s.plan.arrivals.length;
  s.line = [];
  s.soldOutAtMs = s.timeMs;
  pourOutLeftovers(s);
  s.over = true;
  s.endReason = 'soldOut';
  s.events.push({ type: 'soldOut' });
}

/**
 * Close the stand at the current clock (5pm, or earlier via "End the day now"). Everyone in line and everyone
 * who hasn't arrived yet goes home (leftAtClose). A glass or jug mini-game in progress is abandoned.
 */
function endClosed(s: WindowRushState) {
  const notYet = s.plan.arrivals.length - s.nextArrival;
  s.leftAtClose += s.line.length + notYet;
  s.nextArrival = s.plan.arrivals.length;
  s.line = [];
  pourOutLeftovers(s);
  s.over = true;
  s.endReason = 'closed';
  s.events.push({ type: 'closed' });
}

/**
 * "End the day now" from the pause menu: closes the stand at the current clock exactly like the 5pm close.
 * Pure: returns a new state. No-op if the day is already over.
 */
export function endDayEarly(state: WindowRushState): WindowRushState {
  if (state.over) return state;
  const s = clone(state);
  endClosed(s);
  return s;
}

export function toOutcome(s: WindowRushState): DayOutcome {
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
