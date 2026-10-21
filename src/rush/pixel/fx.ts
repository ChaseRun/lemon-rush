// View-only animation state for the Rush: which way the kid faces, pop-ups, customers walking off.
// Pure and DOM-free. It reads RushState (and the events of the latest step) but never feeds back into
// the rules, so it can't change an outcome.

import type { CustomerTypeId } from '../../contract';
import { RUSH, RUSH_VIEW } from '../rushConfig';
import type { RushEvent, RushState } from '../rushRules';
import { jugPopText, pourPopText } from '../miniGames';
import { COLORS } from './sprites';

/** Where mini-game grade pops appear (art px): above the prep station, nudged left to stay on screen. */
const GRADE_X = Math.round(RUSH.prepX / RUSH_VIEW.pixelScale) - 30;

/** Floating text (and coins) in art pixels. */
export interface Popup {
  text: string;
  color: string;
  x: number;
  y: number;
  ageMs: number;
  coins: boolean;
  /** Text size in CSS px (default: 16 with coins, 8 without). Mini-game grades pop big. */
  size?: number;
}

/** A customer leaving the counter after a serve (happy) or a walkout (angry). */
export interface Leaver {
  type: CustomerTypeId;
  x: number;
  ageMs: number;
  angry: boolean;
}

export interface Fx {
  /** Real time since the Rush opened, for idle bobs and blinking. */
  animMs: number;
  facing: 1 | -1;
  running: boolean;
  /** Counts down after a serve completes: the kid does a little hop. */
  hopMs: number;
  /** Time since the Rush ended, for the falling sign. */
  overMs: number;
  popups: Popup[];
  leavers: Leaver[];
}

export const LEAVE_MS = 700;
export const HOP_MS = 180;

/** World x (0..900, the rules' units) to art pixels. */
export const toArtX = (worldX: number) => Math.round(worldX / RUSH_VIEW.pixelScale);

/**
 * Which coin animation frame to draw for a pop-up that is `ageMs` old, with a per-coin `offsetMs`
 * (negative for coins that lag behind). Always a valid index into a list of `frameCount` frames:
 * a negative age used to produce index -1, which crashed the renderer right after a serve.
 */
export function coinFrameIndex(ageMs: number, offsetMs: number, frameCount: number): number {
  if (frameCount <= 0) return 0;
  return Math.floor(Math.max(0, ageMs + offsetMs) / 90) % frameCount;
}

export function createFx(): Fx {
  return { animMs: 0, facing: -1, running: false, hopMs: 0, overMs: 0, popups: [], leavers: [] };
}

/** Advance the view by one frame. prev/next are the states before and after this frame's step(). */
export function updateFx(fx: Fx, prev: RushState, next: RushState, dtMs: number): Fx {
  const dx = next.kidX - prev.kidX;
  const fresh = prev === next ? [] : next.events;
  const leavers = fx.leavers
    .map((l) => ({ ...l, ageMs: l.ageMs + dtMs }))
    .filter((l) => l.ageMs < LEAVE_MS)
    .concat(fresh.flatMap((e) => leaverFor(e, prev)));
  const popups = fx.popups
    .map((p) => ({ ...p, ageMs: p.ageMs + dtMs }))
    .filter((p) => p.ageMs < RUSH_VIEW.popupMs)
    .concat(fresh.flatMap(popupFor));
  const served = fresh.some((e) => e.kind === 'served');
  return {
    animMs: fx.animMs + dtMs,
    facing: dx > 0 ? 1 : dx < 0 ? -1 : fx.facing,
    running: dx !== 0,
    hopMs: served ? HOP_MS : Math.max(0, fx.hopMs - dtMs),
    overMs: prev.phase !== 'open' ? fx.overMs + dtMs : 0,
    popups,
    leavers,
  };
}

function leaverFor(e: RushEvent, prev: RushState): Leaver[] {
  if (e.kind !== 'served' && e.kind !== 'walkout') return [];
  const c = prev.spots[e.spot];
  if (!c) return [];
  return [{ type: c.arrival.type, x: toArtX(RUSH.spotX[e.spot]), ageMs: 0, angry: e.kind === 'walkout' }];
}

function popupFor(e: RushEvent): Popup[] {
  switch (e.kind) {
    case 'served':
      return [{ text: e.text, color: COLORS.lemon, x: toArtX(RUSH.spotX[e.spot]), y: 40, ageMs: 0, coins: true }];
    case 'walkout':
      return [{ text: 'GRR!', color: COLORS.melon, x: toArtX(RUSH.spotX[e.spot]), y: 44, ageMs: 0, coins: false }];
    case 'noRoom':
      return [{ text: 'NO ROOM!', color: COLORS.melon, x: 17, y: 68, ageMs: 0, coins: false }];
    case 'jugMade':
      return [{ text: jugPopText(e.stars), color: e.stars === 1 ? COLORS.melon : COLORS.lemon, x: GRADE_X, y: 40, ageMs: 0, coins: false, size: 16 }];
    case 'jugDumped':
      return [{ text: 'JUG DUMPED!', color: COLORS.melon, x: GRADE_X, y: 40, ageMs: 0, coins: false, size: 12 }];
    case 'beat':
      return [{ text: e.grade.toUpperCase(), color: e.grade === 'poor' ? COLORS.melon : COLORS.paper, x: GRADE_X, y: 60, ageMs: 0, coins: false }];
    case 'poured':
      return [{ text: pourPopText(e.grade), color: e.grade === 'short' ? COLORS.orange : COLORS.lemon, x: GRADE_X, y: 40, ageMs: 0, coins: false, size: 16 }];
    case 'spilled':
      return [{ text: pourPopText('spill'), color: COLORS.melon, x: GRADE_X, y: 40, ageMs: 0, coins: false, size: 16 }];
    default:
      return [];
  }
}
