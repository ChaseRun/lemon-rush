// Small pure graders for the Rush's prep-station mini-games (pour to the line; squeeze → sweeten → stir).
// No state, no clock: rushRules.ts feeds them numbers and stores the results. Every number is in RUSH.

import { RUSH } from './rushConfig';

export type PourGrade = 'perfect' | 'good' | 'short' | 'spill';
export type BeatGrade = 'great' | 'good' | 'poor';
export type JugStars = 1 | 2 | 3;
export type JugBeat = 'squeeze' | 'sweeten' | 'stir';
export type StirKey = 'up' | 'right' | 'down' | 'left';

/** The stir circle: ↑ → ↓ ←, repeated. */
export const STIR_ORDER: readonly StirKey[] = ['up', 'right', 'down', 'left'];

const P = RUSH.pour;
const EPS = 1e-9;

/** Flow rate (glass fraction per ms) after `flowMs` of flowing: a linear ramp from startRate to fullRate. */
export function pourRateAt(flowMs: number): number {
  const t = Math.max(0, flowMs);
  return P.startRatePerMs + (P.fullRatePerMs - P.startRatePerMs) * Math.min(1, t / P.rampMs);
}

/** Glass fill after `flowMs` of flowing: the exact integral of pourRateAt, so it doesn't depend on frame size. */
export function pourFillAt(flowMs: number): number {
  const t = Math.max(0, flowMs);
  const dr = P.fullRatePerMs - P.startRatePerMs;
  if (t <= P.rampMs) return P.startRatePerMs * t + (dr * t * t) / (2 * P.rampMs);
  return P.startRatePerMs * P.rampMs + (dr * P.rampMs) / 2 + P.fullRatePerMs * (t - P.rampMs);
}

/**
 * Fill of a pour that was held `holdMs` (the first tiltMs only tilts the jug) and has dripped `dripMs`
 * since release (the drip runs at the release rate, for at most RUSH.pour.dripMs). Capped at the brim.
 */
export function pourFill(holdMs: number, dripMs: number): number {
  const flow = Math.max(0, holdMs - P.tiltMs);
  const drip = flow > 0 ? pourRateAt(flow) * Math.min(Math.max(0, dripMs), P.dripMs) : 0;
  return Math.min(P.brim, pourFillAt(flow) + drip);
}

/** Target-band center for the n-th pour of the day (0-based). Deterministic: cycles RUSH.pour.bandCenters. */
export function pourBandCenter(n: number): number {
  const c = P.bandCenters;
  return c[((Math.floor(n) % c.length) + c.length) % c.length];
}

/** Grade a final fill against a band center. Boundaries are inclusive (on the line counts as inside). */
export function gradePour(fill: number, center: number): PourGrade {
  if (fill > center + P.bandHalf + EPS) return 'spill';
  if (Math.abs(fill - center) <= P.perfectTol + EPS) return 'perfect';
  if (fill >= center - P.bandHalf - EPS) return 'good';
  return 'short';
}

/**
 * A "race" beat (squeeze, stir): `done` of `target` inputs; `doneAtMs` is when the last one landed
 * (null if never finished). GREAT = finished by greatMs; GOOD = at least goodCount; otherwise POOR.
 */
export function gradeRace(done: number, target: number, doneAtMs: number | null, greatMs: number, goodCount: number): BeatGrade {
  if (done >= target && doneAtMs !== null && doneAtMs <= greatMs) return 'great';
  if (done >= goodCount) return 'good';
  return 'poor';
}

export function gradeSqueeze(taps: number, doneAtMs: number | null): BeatGrade {
  const c = RUSH.jug.squeeze;
  return gradeRace(taps, c.taps, doneAtMs, c.greatMs, c.goodTaps);
}

export function gradeStir(steps: number, doneAtMs: number | null): BeatGrade {
  const c = RUSH.jug.stir;
  return gradeRace(steps, c.steps, doneAtMs, c.greatMs, c.goodSteps);
}

/** Scoop position 0..1 at `ms` into the sweeten beat: a triangle wave, 0 → 1 → 0, one pass per sweepMs. */
export function scoopAt(ms: number): number {
  const phase = (Math.max(0, ms) / RUSH.jug.sweeten.sweepMs) % 2;
  return phase <= 1 ? phase : 2 - phase;
}

/** Sweet-spot position for the n-th jug of the day (0-based). */
export function sweetSpotFor(n: number): number {
  const s = RUSH.jug.sweeten.spots;
  return s[((Math.floor(n) % s.length) + s.length) % s.length];
}

/** Sweeten: distance of the scoop from the sweet spot when Space was tapped (null = never tapped → POOR). */
export function gradeSweeten(scoop: number | null, spot: number): BeatGrade {
  if (scoop === null) return 'poor';
  const d = Math.abs(scoop - spot);
  if (d <= RUSH.jug.sweeten.greatTol + EPS) return 'great';
  if (d <= RUSH.jug.sweeten.goodTol + EPS) return 'good';
  return 'poor';
}

/** The three beat grades → jug stars (points 2/1/0 each; ≥5 = ★★★, ≥3 = ★★, else ★). */
export function jugStars(grades: readonly BeatGrade[]): JugStars {
  const c = RUSH.jug;
  const pts = grades.reduce((sum, g) => sum + c.points[g], 0);
  if (pts >= c.threeStarsFrom) return 3;
  if (pts >= c.twoStarsFrom) return 2;
  return 1;
}

/** Tip multiplier a glass carries: its pour grade × the stars of the jug it came from. */
export function glassTipMultiplier(pour: Exclude<PourGrade, 'spill'>, stars: JugStars): number {
  return RUSH.pourTip[pour] * RUSH.jugTip[stars];
}

/** Big pop-up text for a grade. */
export function pourPopText(g: PourGrade): string {
  return { perfect: 'PERFECT!', good: 'GOOD', short: 'SHORT...', spill: 'SPILL!' }[g];
}

export function jugPopText(stars: JugStars): string {
  return { 3: 'BEST LEMONADE!', 2: 'NICE JUG', 1: 'TOO SOUR!' }[stars];
}
