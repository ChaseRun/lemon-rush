// View-only animation state for the window Rush: customers walking up the sidewalk, leaving, pop-ups and
// shakes. Pure and DOM-free. It reads the rules' state and events but never feeds back into them, so it
// can't change an outcome.

import type { CustomerTypeId } from '../contract';
import { WINDOW_VIEW } from './windowConfig';
import type { Grade, PourGrade } from './windowConfig';
import type { WindowEvent, WindowRushState } from './windowRules';
import { money } from './windowView';

/** Depth along the sidewalk: 0 = far (horizon), 1 = at the window. Index = place in line. */
export const LINE_DEPTH = [1, 0.6, 0.44, 0.33, 0.26, 0.21, 0.17];
/** Sideways lane (-1..1) per place in line so people behind peek out. */
export const LINE_LANE = [0, -0.5, 0.45, -0.35, 0.3, -0.25, 0.2];
/** Depth units per ms when walking. */
const WALK_SPEED = 0.00055;

export interface Walker {
  id: number;
  type: CustomerTypeId;
  d: number;
  lane: number;
  moving: boolean;
}

export interface Leaver {
  type: CustomerTypeId;
  d: number;
  lane: number;
  ageMs: number;
  mood: 'happy' | 'angry' | 'meh';
}

export interface Pop {
  kind: 'grade' | 'coin' | 'toast' | 'small';
  text: string;
  sub?: string;
  color: string;
  x: number;
  y: number;
  ageMs: number;
}

export interface Fx {
  animMs: number;
  walkers: Map<number, Walker>;
  leavers: Leaver[];
  pops: Pop[];
  shakeMs: number;
  /** Counts down after each squeeze tap (lemon squish). */
  squishMs: number;
  /** Counts down after an ice cube drops. */
  plinkMs: number;
  /** Spoon angle, eased toward the last stir direction. */
  spoon: number;
  spoonTarget: number;
  /** Puddle after a spill. */
  spillMs: number;
  /** Time since the Rush ended (for the closing sign). */
  overMs: number;
  tapCount: number;
}

export function createFx(): Fx {
  return {
    animMs: 0,
    walkers: new Map(),
    leavers: [],
    pops: [],
    shakeMs: 0,
    squishMs: 0,
    plinkMs: 0,
    spoon: 0,
    spoonTarget: 0,
    spillMs: 0,
    overMs: 0,
    tapCount: 0,
  };
}

const GRADE_TEXT: Record<Grade, string> = { perfect: 'PERFECT!', good: 'GOOD', ok: 'OK' };
export const GRADE_COLOR: Record<Grade, string> = { perfect: '#ffd43b', good: '#8fd3ff', ok: '#ffffff' };
const POUR_TEXT: Record<Exclude<PourGrade, 'spill'>, [string, string]> = {
  perfect: ['NICE POUR!', 'full tip'],
  under: ['UNDERFILLED', 'tip ×½'],
};

function pop(fx: Fx, p: Omit<Pop, 'ageMs'>) {
  if (p.kind === 'grade') fx.pops = fx.pops.filter((q) => q.kind !== 'grade'); // one big pop at a time
  if (p.kind === 'toast') fx.pops = fx.pops.filter((q) => q.kind !== 'toast');
  fx.pops.push({ ...p, ageMs: 0 });
}

/** Advance view animation by dt and react to the latest step's events. Mutates fx (view-only). */
export function updateFx(fx: Fx, prev: WindowRushState, s: WindowRushState, dt: number, reducedMotion: boolean) {
  fx.animMs += dt;
  fx.shakeMs = Math.max(0, fx.shakeMs - dt);
  fx.squishMs = Math.max(0, fx.squishMs - dt);
  fx.plinkMs = Math.max(0, fx.plinkMs - dt);
  fx.spillMs = Math.max(0, fx.spillMs - dt);
  if (s.over) fx.overMs += dt;
  fx.spoon += (fx.spoonTarget - fx.spoon) * Math.min(1, dt * 0.02);

  // Squeeze taps (view feedback per tap).
  const pm = prev.jug.making;
  const m = s.jug.making;
  if (m?.kind === 'squeeze' && pm?.kind === 'squeeze' && m.taps > pm.taps) {
    fx.squishMs = 120;
    fx.tapCount += m.taps - pm.taps;
  }
  if (m?.kind === 'stir' && m.lastDir && (pm?.kind !== 'stir' || pm.lastDir !== m.lastDir)) {
    fx.spoonTarget = m.lastDir === 'left' ? -1 : 1;
  }

  for (const e of s.events) onEvent(fx, prev, e, reducedMotion);

  // Walkers ease toward their place in line.
  const inLine = new Set<number>();
  s.line.forEach((c, i) => {
    const id = c.arrival.id;
    inLine.add(id);
    let w = fx.walkers.get(id);
    if (!w) {
      w = { id, type: c.arrival.type, d: 0, lane: LINE_LANE[Math.min(i, LINE_LANE.length - 1)] * 0.6, moving: true };
      fx.walkers.set(id, w);
    }
    const td = LINE_DEPTH[Math.min(i, LINE_DEPTH.length - 1)];
    const tl = LINE_LANE[Math.min(i, LINE_LANE.length - 1)];
    const step = WALK_SPEED * dt;
    const dd = td - w.d;
    w.moving = Math.abs(dd) > 0.002;
    w.d = Math.abs(dd) <= step ? td : w.d + Math.sign(dd) * step;
    w.lane += (tl - w.lane) * Math.min(1, dt * WINDOW_VIEW.walkEase);
  });
  for (const id of [...fx.walkers.keys()]) if (!inLine.has(id)) fx.walkers.delete(id);

  for (const l of fx.leavers) {
    l.ageMs += dt;
    l.d = Math.max(0, l.d - dt * (l.mood === 'angry' ? 0.0009 : 0.0006));
    l.lane += (l.lane >= 0 ? 1 : -1) * dt * 0.0011;
  }
  fx.leavers = fx.leavers.filter((l) => l.ageMs < 2200 && l.d > 0.02);
  for (const p of fx.pops) {
    p.ageMs += dt;
  }
  fx.pops = fx.pops.filter((p) => p.ageMs < (p.kind === 'grade' ? WINDOW_VIEW.popMs + 200 : WINDOW_VIEW.popMs));
}

function onEvent(fx: Fx, prev: WindowRushState, e: WindowEvent, reducedMotion: boolean) {
  switch (e.type) {
    case 'grade':
      pop(fx, {
        kind: 'grade',
        text: GRADE_TEXT[e.grade],
        sub: e.step === 'squeeze' ? 'Squeeze' : e.step === 'sugar' ? 'Sugar' : 'Stir',
        color: GRADE_COLOR[e.grade],
        x: 480,
        y: 238,
      });
      return;
    case 'jugReady': {
      const mult = e.quality === 'perfect' ? '×1.25' : e.quality === 'good' ? '×1' : '×0.8';
      pop(fx, {
        kind: 'grade',
        text: e.quality === 'perfect' ? 'PERFECT JUG!' : e.quality === 'good' ? 'GOOD JUG' : 'OK JUG',
        sub: `${e.glasses} glasses · tips ${mult}`,
        color: GRADE_COLOR[e.quality],
        x: 480,
        y: 238,
      });
      return;
    }
    case 'poured': {
      const [text, sub] = POUR_TEXT[e.grade];
      pop(fx, { kind: 'small', text, sub, color: e.grade === 'perfect' ? '#2f9e44' : '#f2b705', x: 660, y: 352 });
      return;
    }
    case 'spill':
      pop(fx, { kind: 'grade', text: 'SPILL!', sub: 'glass wasted', color: '#e8445f', x: 480, y: 238 });
      fx.spillMs = 900;
      if (!reducedMotion) fx.shakeMs = WINDOW_VIEW.shakeMs;
      return;
    case 'iced':
      fx.plinkMs = 260;
      return;
    case 'served': {
      const w = fx.walkers.get(e.record.arrivalId);
      fx.leavers.push({ type: e.record.type, d: w?.d ?? 1, lane: w?.lane ?? 0, ageMs: 0, mood: e.record.bar === 'red' ? 'meh' : 'happy' });
      fx.walkers.delete(e.record.arrivalId);
      const tip = e.record.tip > 0 ? ` (tip ${money(e.record.tip)})` : '';
      pop(fx, { kind: 'coin', text: `+${money(e.record.paid + e.record.tip)}`, sub: tip, color: '#ffd43b', x: 450, y: 170 });
      return;
    }
    case 'walkout': {
      const w = fx.walkers.get(e.id);
      const c = prev.line.find((x) => x.arrival.id === e.id);
      fx.leavers.push({ type: w?.type ?? c?.arrival.type ?? 'kid', d: w?.d ?? 0.5, lane: w?.lane ?? 0, ageMs: 0, mood: 'angry' });
      fx.walkers.delete(e.id);
      pop(fx, { kind: 'small', text: 'Hmph!', sub: 'walked out', color: '#e8445f', x: 450, y: 140 });
      return;
    }
    case 'noRoom':
      pop(fx, { kind: 'small', text: 'Line full!', sub: 'someone left', color: '#ffffff', x: 450, y: 120 });
      return;
    case 'blocked':
      pop(fx, { kind: 'toast', text: e.reason, color: '#e8445f', x: 480, y: 318 });
      return;
    default:
      return;
  }
}
