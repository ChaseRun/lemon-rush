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
  /** Serve lock: no other action while a serve completes. */
  serveMs: 800,

  // ---- Patience bar and tips ----
  /** Patience fraction: green above greenAbove, red below redBelow, yellow in between (both ends inclusive). */
  barThresholds: { greenAbove: 0.6, redBelow: 0.3 },
  /** tip = price × arrival.tipRate × tipMultiplier[bar at serve time]. */
  tipMultiplier: { green: 1, yellow: 0.5, red: 0 } as Readonly<Record<Bar, number>>,

  /** Legacy: only read by the Rules screen's text. The jug is now the squeeze/sweeten/stir mini-game (RUSH.jug). */
  fillJugMs: 2000,
  /** Legacy: only read by the Rules screen's text. Pouring is now the pour-to-the-line mini-game (RUSH.pour). */
  pourMs: 300,

  // ---- Mini-game: pour a glass to the line (hold Space at the station) ----
  pour: {
    /** The jug tilts this long before lemonade flows. Letting go (or walking) before then cancels for free. */
    tiltMs: 150,
    /** Flow (glass fraction per ms) ramps linearly from startRate to fullRate over rampMs: slow start, then gush. */
    startRatePerMs: 0.00025,
    fullRatePerMs: 0.0016,
    rampMs: 500,
    /** After Space is released the flow keeps going this long at the release rate, then stops. */
    dripMs: 80,
    /** Target-band centers (fraction of the glass), cycled per pour so every glass is a little different. */
    bandCenters: [0.72, 0.66, 0.76, 0.69, 0.63] as readonly number[],
    /** Half the band's height: inside [center − half, center + half] = GOOD; above it = SPILL; below = SHORT. */
    bandHalf: 0.09,
    /** Within this of the center = PERFECT. */
    perfectTol: 0.035,
    /** The glass's brim. Reaching it while still pouring spills on the spot. */
    brim: 1,
  },
  /** Tip multiplier carried by a poured glass. (A spill is never served.) */
  pourTip: { perfect: 1.2, good: 1, short: 0.5 } as Readonly<Record<'perfect' | 'good' | 'short', number>>,

  // ---- Mini-game: make a jug (squeeze → sweeten → stir; hold Space at the station with the jug empty) ----
  jug: {
    /** Beat 1: alternate ← → presses. GREAT = all taps by greatMs; GOOD = at least goodTaps by windowMs. */
    squeeze: { taps: 8, greatMs: 1200, goodTaps: 5, windowMs: 1500 },
    /** Beat 2: a scoop sweeps 0→1→0 (one pass takes sweepMs); tap Space near the sweet spot. Distance grades it. */
    sweeten: {
      windowMs: 1200,
      sweepMs: 500,
      /** Sweet-spot positions, cycled per jug. */
      spots: [0.5, 0.36, 0.64, 0.44, 0.58] as readonly number[],
      greatTol: 0.07,
      goodTol: 0.17,
    },
    /** Beat 3: press ↑ → ↓ ← in a circle, `steps` presses (2 laps). Wrong keys are ignored. */
    stir: { steps: 8, greatMs: 1500, goodSteps: 4, windowMs: 2000 },
    /** Holding ← or → (alone) this long mid-jug walks away and dumps the jug. */
    walkAwayMs: 600,
    /** Beat grades → points; the sum (0–6) gives the jug's stars. */
    points: { great: 2, good: 1, poor: 0 } as Readonly<Record<'great' | 'good' | 'poor', number>>,
    threeStarsFrom: 5,
    twoStarsFrom: 3,
  },
  /** Tip multiplier for every glass poured from a jug with this many stars. */
  jugTip: { 1: 0.8, 2: 1, 3: 1.25 } as Readonly<Record<1 | 2 | 3, number>>,

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
