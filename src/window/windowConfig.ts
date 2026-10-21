// Tuning numbers for the window-style Rush. Rules (windowRules.ts) and the view (WindowRush.tsx) both
// read from here; nothing in this file depends on the DOM.

import type { Bar } from '../contract';

export type Grade = 'perfect' | 'good' | 'ok';
export type PourGrade = 'perfect' | 'under' | 'spill';

export interface WindowConfig {
  windows: number;
  maxLine: number;
  jugCapacity: number;
  bar: { greenAbove: number; yellowFrom: number };
  barTip: Record<Bar, number>;
  squeeze: { taps: number; perfectMs: number; windowMs: number };
  sugar: { ratePerMs: number; centers: readonly number[]; bandHalf: number; perfectTol: number };
  stir: { strokes: number; perfectMs: number; goodMs: number; limitMs: number };
  jugPoints: Record<Grade, number>;
  jugPerfectFrom: number;
  jugGoodFrom: number;
  jugTip: Record<Grade, number>;
  pour: { ratePerMs: number; lowerLine: number; upperLine: number };
  pourTip: Record<Exclude<PourGrade, 'spill'>, number>;
}

export const WINDOW_CONFIG: Readonly<WindowConfig> = {
  /** Service windows open at once. 1 today; upgrades may add 2–3. Customers at line index < windows are served. */
  windows: 1,
  /** Most customers in line, counting the ones standing at a window. An arrival who finds it full leaves (noRoom). */
  maxLine: 4,
  /** Glasses one jug holds. Must match the engine (GAME_DESIGN §6). */
  jugCapacity: 10,

  /** Patience bar thresholds, as the fraction of patience left. Green above 60%, yellow 30–60%, red below 30%. */
  bar: { greenAbove: 0.6, yellowFrom: 0.3 },
  /** Tip multiplier by patience bar color at hand-over (GAME_DESIGN §6). */
  barTip: { green: 1, yellow: 0.5, red: 0 },

  /** Step 1 of a jug: tap Space to fill the squeeze meter. The clock starts on the first tap. */
  squeeze: {
    /** Taps to fill the meter. */
    taps: 10,
    /** Full within this long (first tap to last) = Perfect. */
    perfectMs: 1800,
    /** Full within this long = Good. Also the hard limit: not full by now = OK. */
    windowMs: 3000,
  },

  /** Step 2: hold Space to pour sugar; release inside the green band. */
  sugar: {
    /** Level gained per ms while held (0 → 1 in 1.6s). Reaching 1 ends the pour. */
    ratePerMs: 1 / 1600,
    /** Band centers, cycled per jug so every jug feels a little different. */
    centers: [0.62, 0.5, 0.72, 0.56],
    /** Half the green band's height. Inside the band = Good (or Perfect near the center). Outside = OK. */
    bandHalf: 0.09,
    /** Within this of the center = Perfect. */
    perfectTol: 0.03,
  },

  /** Step 3: alternate ← / → to stir. A stroke counts only when it changes direction. */
  stir: {
    strokes: 8,
    /** All strokes within this long (first stroke to last) = Perfect. */
    perfectMs: 2000,
    /** Within this long = Good. */
    goodMs: 3200,
    /** Hard limit: the step ends here even if unfinished (= OK). */
    limitMs: 4500,
  },

  /** How the three step grades combine into a jug quality: points per grade, then thresholds on the sum (0–6). */
  jugPoints: { perfect: 2, good: 1, ok: 0 },
  jugPerfectFrom: 5,
  jugGoodFrom: 3,
  /** Tip multiplier for every glass poured from a jug of this quality. */
  jugTip: { perfect: 1.25, good: 1, ok: 0.8 },

  /** Pouring a glass: hold Space, release between the two fill lines. Past the upper line it overflows. */
  pour: {
    /** Fill gained per ms while held (0 → 1 in 1.2s). */
    ratePerMs: 1 / 1200,
    lowerLine: 0.7,
    upperLine: 0.9,
  },
  /** Tip multiplier by pour grade. A spill is never served. */
  pourTip: { perfect: 1, under: 0.5 },
};

/** Overrides for tests and future upgrades (e.g. { windows: 2 }). Shallow merge. */
export function windowConfig(overrides: Partial<WindowConfig> = {}): WindowConfig {
  return { ...WINDOW_CONFIG, ...overrides };
}

/** View-only numbers: canvas size, frame clamp, animation timings. Never read by the rules. */
export const WINDOW_VIEW = {
  width: 960,
  height: 540,
  /** Longest frame step (ms). A background tab shouldn't fast-forward the day. */
  maxFrameMs: 100,
  /** How long the SOLD OUT / CLOSED sign shows before onFinish. */
  endBannerMs: 1800,
  /** Grade / coin pop lifetime. */
  popMs: 1100,
  /** Spill screen shake length and amplitude (px). Off under prefers-reduced-motion. */
  shakeMs: 350,
  shakePx: 7,
  /** Mouse travel (canvas px) that counts as a stir stroke once direction reverses. */
  stirMousePx: 28,
  /** How fast line positions ease toward their target (fraction per ms). */
  walkEase: 0.006,
} as const;
