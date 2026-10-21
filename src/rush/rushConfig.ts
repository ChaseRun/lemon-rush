// Every tunable number in the Rush mini-game (GAME_DESIGN.md §6).
// Rules read RUSH; the canvas reads RUSH_VIEW. Per-customer numbers (patienceMs, tipRate) arrive on
// each Arrival, so nothing here duplicates src/core/config.ts and the Rush never imports the engine.

import type { Bar, CustomerTypeId } from '../contract';

export const RUSH = {
  // ---- Layout (world units = canvas pixels, 0..900) ----
  /** Customer spots on the left. Index 0 is closest to the prep station and is filled first. */
  spotX: [420, 280, 140] as readonly number[],
  /** The prep station on the right. */
  prepX: 780,
  /** The kid starts behind the prep station. */
  kidStartX: 780,
  /** The kid can walk between the far spot and the prep station. */
  kidMinX: 140,
  kidMaxX: 780,
  /** How close (px) the kid must be to a spot or the prep station to act there. */
  reachPx: 40,

  // ---- Timing ----
  /** 0.5 px/ms: about 0.7s from the prep station to the nearest spot, 1.3s to the far one. */
  kidSpeedPxPerMs: 0.5,
  /** Hold Space at the prep station this long to make a glass. */
  prepMs: 1000,
  /** Serve lock: no other action while a serve completes. */
  serveMs: 800,

  // ---- Patience bar and tips ----
  /** Patience fraction: green above greenAbove, red below redBelow, yellow in between (both ends inclusive). */
  barThresholds: { greenAbove: 0.6, redBelow: 0.3 },
  /** tip = price × arrival.tipRate × tipMultiplier[bar at serve time]. */
  tipMultiplier: { green: 1, yellow: 0.5, red: 0 } as Readonly<Record<Bar, number>>,

  // ---- Simulation ----
  /** step() splits a long dt into slices no longer than this, so a lag spike can't skip past events. */
  maxSliceMs: 50,
};

export const RUSH_VIEW = {
  width: 900,
  height: 300,
  /** The clock runs 9am → 5pm over the day's dayLengthMs. */
  openHour: 9,
  closeHour: 17,
  /** Frames longer than this (tab switch, debugger) are clamped, which effectively pauses the Rush. */
  maxFrameMs: 250,
  /** How long a floating "+$X.XX" lives. */
  popupMs: 1000,
  /** How long the SOLD OUT / CLOSED banner shows before onFinish fires. */
  endBannerMs: 1800,
  emoji: { kid: '🧒', jogger: '🏃', grandma: '👵', worker: '👷' } as Readonly<Record<CustomerTypeId, string>>,
  barColor: { green: '#3cb043', yellow: '#f2c200', red: '#e03c31' } as Readonly<Record<Bar, string>>,
};
