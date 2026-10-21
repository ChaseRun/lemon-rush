// Pure view helpers for the window Rush: screen layout, hit-testing, the "what next?" hint, and the clock.
// No DOM, so they're unit-tested alongside the rules.

import type { WindowAction, WindowRushState } from './windowRules';
import { freeForGlass, lemonsLeft, sugarLeft } from './windowRules';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Everything is laid out on a 960×540 canvas. */
export const LAYOUT = {
  hud: { x: 0, y: 0, w: 960, h: 40 } as Rect,
  window: { x: 196, y: 58, w: 508, h: 262 } as Rect,
  sign: { x: 22, y: 78, w: 150, h: 112 } as Rect,
  ticket: { x: 728, y: 62, w: 210, h: 250 } as Rect,
  counterTop: 330,
  /** Where an item's feet sit on the counter. */
  shelf: 478,
  crate: { x: 22, y: 392, w: 118, h: 88 } as Rect,
  sugar: { x: 156, y: 378, w: 92, h: 102 } as Rect,
  cooler: { x: 264, y: 394, w: 118, h: 86 } as Rect,
  jug: { x: 432, y: 360, w: 112, h: 120 } as Rect,
  gauge: { x: 560, y: 360, w: 26, h: 120 } as Rect,
  glass: { x: 624, y: 384, w: 70, h: 96 } as Rect,
  cups: { x: 790, y: 380, w: 96, h: 100 } as Rect,
  /** Customer standing at window 0 (clickable for hand-over). */
  atWindow: { x: 360, y: 120, w: 180, h: 200 } as Rect,
} as const;

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** Click → action. The jug and glass are "hold" zones (mouse-down = Space), handled by the caller. */
export function actionAt(x: number, y: number): WindowAction | null {
  if (inRect(LAYOUT.crate, x, y)) return { type: 'lemons' };
  if (inRect(LAYOUT.sugar, x, y)) return { type: 'sugar' };
  if (inRect(LAYOUT.cooler, x, y)) return { type: 'ice' };
  if (inRect(LAYOUT.cups, x, y)) return { type: 'cup' };
  if (inRect(LAYOUT.atWindow, x, y) || inRect(LAYOUT.ticket, x, y)) return { type: 'handOver', window: 0 };
  return null;
}

/** Pressing on these acts like holding Space (mouse-only play). */
export function isHoldZone(x: number, y: number): boolean {
  return inRect(LAYOUT.jug, x, y) || inRect(LAYOUT.glass, x, y) || inRect(LAYOUT.gauge, x, y);
}

export type HintTarget = 'crate' | 'sugar' | 'cooler' | 'cups' | 'jug' | 'glass' | 'window' | null;

export interface Hint {
  text: string;
  target: HintTarget;
  /** Big flashing prompt for the timed bits. */
  urgent: boolean;
}

/** What the player should do next. Drives the prompt pill and the bouncing arrow. */
export function nextHint(s: WindowRushState): Hint {
  const m = s.jug.making;
  if (m) {
    switch (m.kind) {
      case 'squeeze':
        return { text: 'SQUEEZE! Tap SPACE fast', target: 'jug', urgent: true };
      case 'sugarReady':
        return { text: 'Grab the sugar  (click or 2)', target: 'sugar', urgent: false };
      case 'sugar':
        return { text: 'HOLD SPACE · let go in the green', target: 'jug', urgent: true };
      case 'stir':
        return { text: 'STIR! ← → ← →', target: 'jug', urgent: true };
    }
  }
  const g = s.glass;
  const atWindow = s.line.length > 0;
  if (g?.phase === 'poured') {
    return atWindow
      ? { text: 'Hand it over!  (click them or Enter)', target: 'window', urgent: false }
      : { text: 'Glass ready · waiting for a customer', target: null, urgent: false };
  }
  if (g?.phase === 'pouring') return { text: 'Let go between the lines!', target: 'glass', urgent: true };
  if (g && !g.ice) return { text: 'Add ice  (click cooler or 3)', target: 'cooler', urgent: false };
  if (g && s.jug.glasses > 0) return { text: 'HOLD SPACE to pour · let go between the lines', target: 'glass', urgent: false };
  if (s.jug.glasses === 0) {
    if (lemonsLeft(s) > 0 && sugarLeft(s) > 0) return { text: 'Make a jug  (click lemons or 1)', target: 'crate', urgent: false };
  }
  if (!g) {
    const free = freeForGlass(s);
    if (free.cups > 0 && free.ice > 0) return { text: 'Grab a cup  (click or 4)', target: 'cups', urgent: false };
  }
  return { text: '', target: null, urgent: false };
}

/** 9:00am at 0 → 5:00pm at dayLengthMs. */
export function clockLabel(timeMs: number, dayLengthMs: number): string {
  const frac = dayLengthMs > 0 ? Math.min(1, Math.max(0, timeMs / dayLengthMs)) : 1;
  const mins = 9 * 60 + Math.floor(frac * 8 * 60);
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')}${h24 < 12 ? 'am' : 'pm'}`;
}

export function money(n: number): string {
  return `$${n.toFixed(2)}`;
}
