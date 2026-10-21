// Every tunable number in the Rush mini-game (GAME_DESIGN.md §6).
// Rules read RUSH; the canvas reads RUSH_VIEW. Per-customer numbers (patienceMs, tipRate) arrive on
// each Arrival, so nothing here duplicates src/core/config.ts and the Rush never imports the engine.

import type { Bar } from '../contract';

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
  /** 0.3 px/ms (tuned by play-testing): about 1.2s from the prep station to the nearest spot, 2.1s to the far one. */
  kidSpeedPxPerMs: 0.3,
  /** Glasses of lemonade a full jug holds. The jug starts the day empty. */
  jugCapacity: 10,
  /** Hold Space at the prep station this long to refill an empty jug. */
  fillJugMs: 2000,
  /** Hold Space at the prep station this long to pour one glass from the jug. */
  pourMs: 300,
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
  /** CSS size of the canvas at 100% (it shrinks to fit narrower screens). World x maps 1:1 to CSS x. */
  width: 900,
  height: 420,
  /** The art is drawn at width/pixelScale × height/pixelScale "art pixels", then scaled up crisply. */
  pixelScale: 3,
  /** The clock runs 9am → 8pm over the day's dayLengthMs. */
  openHour: 9,
  closeHour: 20,
  /** Frames longer than this (tab switch, debugger) are clamped, which effectively pauses the Rush. */
  maxFrameMs: 250,
  /** How long a floating "+$X.XX" lives. */
  popupMs: 1000,
  /** How long the SOLD OUT / CLOSED banner shows before onFinish fires. */
  endBannerMs: 1800,
  /** The jug is drawn just right of the prep station (world x). */
  jugX: 862,
  /** Canvas text. Falls back to a system monospace until the pixel font has loaded. */
  font: '"Press Start 2P", ui-monospace, Menlo, Consolas, monospace',
  barColor: { green: '#2f9e44', yellow: '#f2b705', red: '#e8445f' } as Readonly<Record<Bar, string>>,
};
