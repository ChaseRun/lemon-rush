// Pixel-art renderer for the Rush. Everything is drawn in "art pixels" (ART_W × ART_H) with the canvas
// already scaled by an integer factor and image smoothing off, so every rect and sprite lands on crisp
// square pixels. Text is drawn through the same transform, so it's rasterized at full resolution.
//
// Frame order: back layer (cached) → customers → front layer (cached counter, floor, props) → jug →
// kid → bubbles and meters → pop-ups → HUD text → end-of-day sign.

import type { Item, Sky } from '../../contract';
import { RUSH, RUSH_VIEW } from '../rushConfig';
import {
  type RushState,
  atPrepStation,
  barFor,
  earned,
  isOver,
  patienceFraction,
  spotInReach,
  stationTask,
  stockLeft,
  taskProgress,
} from '../rushRules';
import { type Fx, LEAVE_MS, toArtX, coinFrameIndex } from './fx';
import {
  ANGER,
  ARROW,
  BUBBLE,
  CLOUD,
  COIN_FRAMES,
  COLORS as C,
  CUP_STACK,
  CUSTOMER_SPRITES,
  GLASS,
  HEART,
  ICE_COOLER,
  ICON_CLOCK,
  ICON_CUP,
  ICON_ICE,
  ICON_JUG,
  ICON_LEMON,
  ICON_SUGAR,
  KID_IDLE,
  KID_RUN_A,
  KID_RUN_B,
  LEMON_CRATE,
  PALETTE,
  type PixelSprite,
  SUGAR_SACK,
  SUN,
} from './sprites';

export const ART_W = RUSH_VIEW.width / RUSH_VIEW.pixelScale; // 300
export const ART_H = RUSH_VIEW.height / RUSH_VIEW.pixelScale; // 140

// ---------- Layout (art pixels) ----------

const HUD_H = 16;
const COUNTER_TOP = 84; // top surface of the counter
const COUNTER_FACE = 88; // front of the counter, facing the kid
const FLOOR_Y = 108;
const STRIP_Y = 128; // bottom status strip
const CUSTOMER_Y = 63; // top of a customer sprite; the counter hides the bottom rows
const BUBBLE_Y = 46;
const METER_Y = 41;
const KID_FEET = 124;
const BOOTH_X = 196; // where the stand's awning + painted panel start
const JUG_LEFT = toArtX(RUSH_VIEW.jugX) - 6;
const JUG_TOP = 66;
const PREP_PROPS = { crate: 220, sack: 238, cooler: 250, cups: 266, pourGlass: 273 };

const DIM = 'rgba(27, 43, 72, 0.55)';
const METER_BG = '#3b4a66';

// ---------- Canvas helpers ----------

type Ctx = CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function rect(g: Ctx, x: number, y: number, w: number, h: number, color: string) {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** A filled pixel circle (row spans, no anti-aliasing). */
function disc(g: Ctx, cx: number, cy: number, r: number, color: string) {
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.round(Math.sqrt(r * r - dy * dy));
    rect(g, cx - half, cy + dy, half * 2 + 1, 1, color);
  }
}

/** Checkerboard dither between two bands, one pixel row tall. */
function ditherRow(g: Ctx, y: number, w: number, color: string, offset = 0) {
  for (let x = offset; x < w; x += 2) rect(g, x, y, 1, 1, color);
}

const spriteCache = new WeakMap<PixelSprite, { normal?: HTMLCanvasElement; flipped?: HTMLCanvasElement }>();

function spriteCanvas(sp: PixelSprite, flip: boolean): HTMLCanvasElement {
  let entry = spriteCache.get(sp);
  if (!entry) spriteCache.set(sp, (entry = {}));
  const key = flip ? 'flipped' : 'normal';
  const cached = entry[key];
  if (cached) return cached;
  const c = makeCanvas(sp.w, sp.h);
  const g = c.getContext('2d')!;
  const img = g.createImageData(sp.w, sp.h);
  sp.rows.forEach((row, y) => {
    for (let x = 0; x < sp.w; x++) {
      const hex = PALETTE[row[x]];
      if (!hex) continue;
      const i = (y * sp.w + (flip ? sp.w - 1 - x : x)) * 4;
      img.data[i] = parseInt(hex.slice(1, 3), 16);
      img.data[i + 1] = parseInt(hex.slice(3, 5), 16);
      img.data[i + 2] = parseInt(hex.slice(5, 7), 16);
      img.data[i + 3] = 255;
    }
  });
  g.putImageData(img, 0, 0);
  entry[key] = c;
  return c;
}

function blit(g: Ctx, sp: PixelSprite, x: number, y: number, flip = false) {
  g.drawImage(spriteCanvas(sp, flip), Math.round(x), Math.round(y));
}

/** Text with an optional ink outline. size is in CSS px (16 = Press Start 2P's crisp size at 1×). */
function label(
  g: Ctx,
  str: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = 'left',
  outline: string | null = C.ink,
): number {
  g.font = `${size / RUSH_VIEW.pixelScale}px ${RUSH_VIEW.font}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  if (outline) {
    g.lineJoin = 'round';
    g.lineWidth = (size / RUSH_VIEW.pixelScale) * 0.35;
    g.strokeStyle = outline;
    g.strokeText(str, x, y);
  }
  g.fillStyle = color;
  g.fillText(str, x, y);
  return g.measureText(str).width;
}

const blink = (t: number, periodMs: number) => Math.floor(t / periodMs) % 2 === 0;

// ---------- Static layers (drawn once per Rush) ----------

export interface Layers {
  back: HTMLCanvasElement;
  front: HTMLCanvasElement;
}

interface SkyTheme {
  top: string;
  mid: string;
  low: string;
  sun: boolean;
  clouds: number;
}

const SKIES: Record<Sky, SkyTheme> = {
  sunny: { top: C.deepSky, mid: C.skyMid, low: C.sky, sun: true, clouds: 2 },
  partlyCloudy: { top: C.deepSky, mid: C.skyMid, low: C.sky, sun: true, clouds: 4 },
  cloudy: { top: '#7f9bb5', mid: '#98b2c8', low: '#b7c9d8', sun: false, clouds: 6 },
  rain: { top: '#62768c', mid: '#7a8ea4', low: '#97a9bb', sun: false, clouds: 6 },
  storm: { top: '#3f4a5e', mid: '#536078', low: '#6e7d96', sun: false, clouds: 6 },
};

const CLOUD_SPOTS: readonly [number, number][] = [
  [56, 20],
  [118, 30],
  [150, 18],
  [84, 38],
  [8, 34],
  [176, 34],
];

export function buildLayers(sky: Sky): Layers {
  const back = makeCanvas(ART_W, ART_H);
  const front = makeCanvas(ART_W, ART_H);
  paintBack(back.getContext('2d')!, SKIES[sky] ?? SKIES.sunny);
  paintFront(front.getContext('2d')!);
  return { back, front };
}

function house(g: Ctx, x: number, w: number, h: number, wall: string, roof: string) {
  const base = 74;
  const top = base - h;
  rect(g, x, top, w, h, C.ink);
  rect(g, x + 1, top + 1, w - 2, h - 1, wall);
  const roofRows = Math.ceil((w + 4) / 4);
  for (let r = 0; r < roofRows; r++) {
    const rowW = Math.max(2, Math.round(((w + 4) * (r + 1)) / roofRows));
    const rx = x + w / 2 - rowW / 2;
    rect(g, rx - 1, top - roofRows + r, rowW + 2, 1, C.ink);
    rect(g, rx, top - roofRows + r, rowW, 1, roof);
  }
  rect(g, x - 2, top, w + 4, 1, C.ink);
  for (const wx of [x + 3, x + w - 15]) {
    rect(g, wx, top + 4, 6, 6, C.ink);
    rect(g, wx + 1, top + 5, 4, 4, C.ice);
    rect(g, wx + 1, top + 5, 1, 1, C.paper);
  }
  rect(g, x + w - 8, base - 10, 6, 10, C.ink);
  rect(g, x + w - 7, base - 9, 4, 9, C.wood);
}

function paintBack(g: Ctx, sky: SkyTheme) {
  // Sky bands with dithered seams
  rect(g, 0, HUD_H, ART_W, 10, sky.top);
  rect(g, 0, HUD_H + 10, ART_W, 10, sky.mid);
  rect(g, 0, HUD_H + 20, ART_W, FLOOR_Y - HUD_H - 20, sky.low);
  ditherRow(g, HUD_H + 10, ART_W, sky.top);
  ditherRow(g, HUD_H + 11, ART_W, sky.top, 1);
  ditherRow(g, HUD_H + 20, ART_W, sky.mid);
  ditherRow(g, HUD_H + 21, ART_W, sky.mid, 1);

  if (sky.sun) blit(g, SUN, 12, 19);
  for (const [x, y] of CLOUD_SPOTS.slice(0, sky.clouds)) blit(g, CLOUD, x, y);

  // Rolling hills, the neighborhood, a tree and a picket fence
  disc(g, 30, 80, 24, C.hill);
  disc(g, 100, 84, 32, C.hill);
  disc(g, 168, 80, 22, C.hill);
  house(g, 24, 32, 20, '#fff4e0', C.melon);
  house(g, 92, 26, 16, '#d8ecff', C.navy);
  house(g, 134, 28, 22, '#ffe7ef', C.leaf);
  rect(g, 181, 50, 4, 24, C.woodDark);
  rect(g, 182, 50, 1, 24, C.wood);
  disc(g, 183, 44, 11, C.leafDark);
  disc(g, 177, 41, 8, C.leaf);
  disc(g, 190, 40, 8, C.leaf);
  disc(g, 183, 34, 8, C.leaf);
  disc(g, 180, 35, 3, C.leafLight);
  disc(g, 188, 38, 2, C.leafLight);
  rect(g, 0, 65, BOOTH_X, 2, C.grayLight);
  rect(g, 0, 70, BOOTH_X, 2, C.grayLight);
  for (let x = 1; x < BOOTH_X; x += 5) {
    rect(g, x, 62, 3, 12, C.paper);
    rect(g, x + 1, 61, 1, 1, C.paper);
    rect(g, x + 2, 63, 1, 11, C.grayLight);
  }

  // Grass verge and the sidewalk the customers stand on
  rect(g, 0, 74, ART_W, 2, C.grassDark);
  rect(g, 0, 76, ART_W, 8, C.sidewalk);
  rect(g, 0, 76, ART_W, 1, C.sidewalkSeam);
  for (let x = 6; x < ART_W; x += 22) rect(g, x, 77, 1, 7, C.sidewalkSeam);
  rect(g, 0, COUNTER_TOP, ART_W, FLOOR_Y - COUNTER_TOP + 20, C.grass);

  // The stand: back panel, posts, striped awning, hanging sign (its text is drawn per frame)
  rect(g, BOOTH_X + 6, 32, ART_W - BOOTH_X - 6, COUNTER_TOP - 32, C.lemonPale);
  for (let x = BOOTH_X + 12; x < ART_W; x += 8) rect(g, x, 32, 1, COUNTER_TOP - 32, '#f3e2a0');
  for (const px of [BOOTH_X + 2, ART_W - 4]) {
    rect(g, px, 26, 4, COUNTER_TOP - 26, C.ink);
    rect(g, px + 1, 26, 2, COUNTER_TOP - 26, C.wood);
  }
  rect(g, BOOTH_X - 3, 17, ART_W - BOOTH_X + 3, 1, C.ink);
  rect(g, BOOTH_X - 3, 17, 1, 14, C.ink);
  for (let i = 0, x = BOOTH_X - 2; x < ART_W; i++, x += 8) {
    const color = i % 2 ? C.paper : C.lemon;
    const shade = i % 2 ? C.grayLight : C.lemonDeep;
    rect(g, x, 18, 8, 11, color);
    rect(g, x, 18, 8, 2, shade);
    rect(g, x, 29, 8, 1, color);
    rect(g, x + 1, 30, 6, 1, color);
    rect(g, x + 2, 31, 4, 1, color);
    rect(g, x, 30, 1, 1, C.ink);
    rect(g, x + 7, 30, 1, 1, C.ink);
    rect(g, x + 1, 31, 1, 1, C.ink);
    rect(g, x + 6, 31, 1, 1, C.ink);
    rect(g, x + 2, 32, 4, 1, C.ink);
  }
  rect(g, 222, 32, 1, 8, C.ink);
  rect(g, 274, 32, 1, 8, C.ink);
  rect(g, 213, 40, 70, 18, C.ink);
  rect(g, 214, 41, 68, 16, C.wood);
  rect(g, 214, 41, 68, 1, C.woodLight);
  rect(g, 214, 56, 68, 1, C.woodDark);
}

function paintFront(g: Ctx) {
  // HUD bar and bottom status strip
  rect(g, 0, 0, ART_W, HUD_H, C.ink);
  rect(g, 0, HUD_H - 1, ART_W, 1, C.lemonDeep);
  rect(g, 0, STRIP_Y, ART_W, ART_H - STRIP_Y, C.ink);
  rect(g, 0, STRIP_Y, ART_W, 1, C.lemonDeep);

  // Lawn on the kid's side, with tufts and a few flowers
  rect(g, 0, FLOOR_Y, ART_W, STRIP_Y - FLOOR_Y, C.grass);
  rect(g, 0, FLOOR_Y, ART_W, 2, C.grassDark);
  for (let x = 3; x < ART_W; x += 13) {
    const y = FLOOR_Y + 5 + ((x * 7) % 13);
    rect(g, x, y, 1, 2, C.grassDark);
    rect(g, x + 2, y - 1, 1, 3, C.grassDark);
    if (x % 3 === 0) rect(g, x + 6, y + 2, 1, 1, x % 2 ? C.paper : C.lemon);
  }

  // The counter: wood top, plank front, then the stand's painted lemon panel on the right
  rect(g, 12, COUNTER_TOP - 1, ART_W - 12, 1, C.ink);
  rect(g, 12, COUNTER_TOP - 1, 1, COUNTER_FACE - COUNTER_TOP + 1, C.ink);
  rect(g, 13, COUNTER_TOP, ART_W - 13, 2, C.woodLight);
  rect(g, 13, COUNTER_TOP + 2, ART_W - 13, 1, C.wood);
  rect(g, 12, COUNTER_FACE - 1, ART_W - 12, 1, C.ink);
  rect(g, 13, COUNTER_FACE, 1, FLOOR_Y - COUNTER_FACE, C.ink);
  rect(g, 14, COUNTER_FACE, ART_W - 14, FLOOR_Y - COUNTER_FACE, C.wood);
  rect(g, 14, COUNTER_FACE, ART_W - 14, 1, C.woodDark);
  rect(g, 14, FLOOR_Y - 2, ART_W - 14, 2, C.woodDark);
  for (let x = 25; x < BOOTH_X; x += 12) {
    rect(g, x, COUNTER_FACE, 1, FLOOR_Y - COUNTER_FACE, C.woodDark);
    rect(g, x - 6, COUNTER_FACE + 5 + (x % 7), 2, 1, C.woodDark);
    rect(g, x - 3, COUNTER_FACE + 12 - (x % 5), 1, 1, C.woodLight);
  }
  rect(g, BOOTH_X, COUNTER_FACE, ART_W - BOOTH_X, FLOOR_Y - COUNTER_FACE - 2, C.lemon);
  rect(g, BOOTH_X, COUNTER_FACE, 1, FLOOR_Y - COUNTER_FACE, C.ink);
  for (let x = BOOTH_X + 4; x < ART_W; x += 10) rect(g, x, COUNTER_FACE + 1, 1, FLOOR_Y - COUNTER_FACE - 4, C.lemonDeep);
  const [ex, ey] = [248, 97];
  disc(g, ex, ey, 8, C.ink);
  disc(g, ex, ey, 7, C.lemonDeep);
  disc(g, ex, ey, 6, C.lemonPale);
  disc(g, ex, ey, 5, C.lemon);
  rect(g, ex, ey - 5, 1, 11, C.lemonPale);
  rect(g, ex - 5, ey, 11, 1, C.lemonPale);
  for (let d = 1; d <= 3; d++) {
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) rect(g, ex + sx * d, ey + sy * d, 1, 1, C.lemonPale);
  }

  // A bush capping the left end of the counter
  disc(g, 4, 98, 10, C.leafDark);
  disc(g, 6, 93, 7, C.leaf);
  disc(g, 3, 91, 2, C.leafLight);

  // Prep station props on the counter top
  blit(g, LEMON_CRATE, PREP_PROPS.crate, COUNTER_TOP - LEMON_CRATE.h);
  blit(g, SUGAR_SACK, PREP_PROPS.sack, COUNTER_TOP - SUGAR_SACK.h);
  blit(g, ICE_COOLER, PREP_PROPS.cooler, COUNTER_TOP - ICE_COOLER.h);
  blit(g, CUP_STACK, PREP_PROPS.cups, COUNTER_TOP - CUP_STACK.h);
}

// ---------- Per-frame drawing ----------

export function drawFrame(g: Ctx, s: RushState, fx: Fx, layers: Layers) {
  const t = fx.animMs;
  const over = isOver(s);
  g.globalAlpha = 1;
  g.drawImage(layers.back, 0, 0);

  // Late afternoon: the light warms up toward closing
  const dayFrac = s.plan.dayLengthMs > 0 ? s.clockMs / s.plan.dayLengthMs : 0;
  if (dayFrac > 0.55) rect(g, 0, HUD_H, ART_W, FLOOR_Y - HUD_H, `rgba(255, 140, 60, ${((dayFrac - 0.55) / 0.45) * 0.2})`);

  drawSign(g, s);
  drawLeavers(g, fx);
  drawCustomers(g, s, t);
  g.drawImage(layers.front, 0, 0);
  drawCounterTop(g, s, t);
  drawJug(g, s, t);
  drawKid(g, s, fx);
  drawBubbles(g, s, t);
  drawWeather(g, s, t);
  drawPopups(g, fx);
  drawHud(g, s);
  drawStatus(g, s, t);
  if (over) drawEndSign(g, s, fx);
}

function drawSign(g: Ctx, s: RushState) {
  label(g, 'LEMONADE', 248, 46.5, 16, C.lemon);
  label(g, `$${s.plan.price.toFixed(2)} A CUP`, 248, 53, 8, C.paper, 'center', null);
}

function drawCustomers(g: Ctx, s: RushState, t: number) {
  const servingSpot = s.task.kind === 'serving' ? s.task.spot : -1;
  RUSH.spotX.forEach((wx, i) => {
    const c = s.spots[i];
    if (!c) return;
    const x = toArtX(wx);
    const since = s.clockMs - c.arrival.atMs;
    const hop = since >= 0 && since < 300 ? -Math.round(4 * Math.sin((Math.PI * since) / 300)) : 0;
    const bob = i === servingSpot ? 0 : Math.floor((t + i * 170) / 420) % 2;
    const red = barFor(patienceFraction(c)) === 'red' && i !== servingSpot;
    const shake = red ? (blink(t, 70) ? 1 : -1) : 0;
    blit(g, CUSTOMER_SPRITES[c.arrival.type], x - 8 + shake, CUSTOMER_Y + bob + hop);
  });
}

function drawLeavers(g: Ctx, fx: Fx) {
  for (const l of fx.leavers) {
    const p = l.ageMs / LEAVE_MS;
    const dx = -Math.round(l.ageMs * (l.angry ? 0.09 : 0.035));
    const x = l.x + dx;
    const hop = Math.floor(l.ageMs / 90) % 2;
    g.globalAlpha = p < 0.5 ? 1 : 1 - (p - 0.5) / 0.5;
    if (l.angry) {
      for (let j = 0; j < 3; j++) disc(g, x + 9 + j * 5, CUSTOMER_Y + 12 - j * 2, 2 + j, j % 2 ? 'rgba(154,163,173,0.8)' : 'rgba(232,68,95,0.7)');
    }
    blit(g, CUSTOMER_SPRITES[l.type], x - 8, CUSTOMER_Y + hop);
    if (l.angry) blit(g, ANGER, x + 4, CUSTOMER_Y - 4 - Math.round(p * 6));
    else blit(g, HEART, x - 3, CUSTOMER_Y - 8 - Math.round(p * 10));
  }
  g.globalAlpha = 1;
}

/** Coasters at each spot, the "you can act here" glow, and the glass being handed over. */
function drawCounterTop(g: Ctx, s: RushState, t: number) {
  for (const wx of RUSH.spotX) rect(g, toArtX(wx) - 5, COUNTER_TOP + 1, 10, 1, C.paper);
  if (isOver(s)) return;
  const glow = (x0: number, x1: number) => {
    g.globalAlpha = blink(t, 300) ? 0.95 : 0.55;
    rect(g, x0, COUNTER_TOP - 2, x1 - x0, 1, C.lemon);
    rect(g, x0, COUNTER_TOP + 3, x1 - x0, 1, C.lemon);
    rect(g, x0 - 1, COUNTER_TOP - 1, 1, 4, C.lemon);
    rect(g, x1, COUNTER_TOP - 1, 1, 4, C.lemon);
    g.globalAlpha = 1;
  };
  const reach = spotInReach(s);
  if (reach !== null && s.spots[reach]) glow(toArtX(RUSH.spotX[reach]) - 9, toArtX(RUSH.spotX[reach]) + 9);
  if (atPrepStation(s)) glow(PREP_PROPS.crate - 2, ART_W - 5);
  if (s.task.kind === 'serving') {
    const x = toArtX(RUSH.spotX[s.task.spot]);
    const lift = Math.round(3 * (taskProgress(s) ?? 0));
    blit(g, GLASS, x - 3, COUNTER_TOP - GLASS.h + 1 - lift);
  }
}

function drawJug(g: Ctx, s: RushState, t: number) {
  const [jl, jt] = [JUG_LEFT, JUG_TOP];
  const filling = s.task.kind === 'filling';
  const pouring = s.task.kind === 'pouring';
  const warn = s.jug === 0 && !filling && !isOver(s) && blink(t, 400);
  const line = warn ? C.melon : C.ink;
  // handle, body, rim and spout
  rect(g, jl + 10, jt + 5, 3, 1, line);
  rect(g, jl + 12, jt + 5, 1, 8, line);
  rect(g, jl + 10, jt + 12, 3, 1, line);
  rect(g, jl, jt + 2, 10, 16, line);
  rect(g, jl + 1, jt + 3, 8, 14, '#e3f6ff');
  rect(g, jl - 1, jt + 1, 12, 1, line);
  rect(g, jl - 2, jt, 2, 1, line);
  // lemonade: one art pixel per glass
  const level = Math.min(s.jug, RUSH.jugCapacity);
  if (level > 0) {
    rect(g, jl + 1, jt + 17 - level, 8, level, C.lemon);
    rect(g, jl + 1, jt + 17 - level, 8, 1, '#fff1a8');
    rect(g, jl + 7, jt + 17 - level, 2, level, C.lemonDeep);
  }
  if (filling) {
    const left = stockLeft(s);
    const target = Math.min(RUSH.jugCapacity, Math.max(0, Math.min(left.lemons, left.sugar)));
    const n = Math.round((taskProgress(s) ?? 0) * target);
    g.globalAlpha = 0.6;
    rect(g, jl + 1, jt + 17 - n, 8, n, C.lemon);
    g.globalAlpha = 1;
    const drop = Math.floor(t / 40) % 8;
    rect(g, jl + 4, jt - 6 + drop, 2, 2, C.lemon);
    rect(g, jl + 2, jt - 10 + ((drop + 4) % 8), 1, 2, C.lemonDeep);
  }
  rect(g, jl + 2, jt + 4, 1, 11, 'rgba(255,255,255,0.75)');
  if (pouring) {
    const gx = PREP_PROPS.pourGlass;
    blit(g, GLASS, gx, COUNTER_TOP - GLASS.h);
    rect(g, jl - 2, jt + 1, 1, 3, C.lemon);
    rect(g, gx + 4, jt + 4, 1, COUNTER_TOP - GLASS.h - jt - 3, C.lemon);
    rect(g, gx + 4, jt + 3, jl - gx - 5, 1, C.lemon);
  }
  label(g, `${s.jug}/${RUSH.jugCapacity}`, jl + 5, jt - 5, 8, s.jug === 0 ? C.melon : C.ink, 'center', C.paper);
}

function drawKid(g: Ctx, s: RushState, fx: Fx) {
  const t = fx.animMs;
  const kx = toArtX(s.kidX);
  const working = s.task.kind === 'filling' || s.task.kind === 'pouring';
  const frame = fx.running && s.task.kind === 'idle' ? (blink(t, 110) ? KID_RUN_A : KID_RUN_B) : KID_IDLE;
  const flip = working ? false : fx.facing < 0;
  const y = KID_FEET - (KID_IDLE.h - 1) - (fx.hopMs > 0 ? 2 : 0) + (working && blink(t, 120) ? 1 : 0);

  g.globalAlpha = 0.25;
  rect(g, kx - 5, KID_FEET, 10, 1, C.ink);
  rect(g, kx - 4, KID_FEET + 1, 8, 1, C.ink);
  g.globalAlpha = 1;
  blit(g, frame, kx - 6, y, flip);
  if (s.holdingGlass && s.task.kind !== 'serving') blit(g, GLASS, flip ? kx - 9 : kx + 3, y + 8);

  // Above the kid's head: a progress bar while busy, or a bobbing arrow when Space would do something
  const progress = taskProgress(s);
  if (progress !== null) {
    const color = s.task.kind === 'serving' ? C.leaf : C.lemonDeep;
    rect(g, kx - 10, 96, 20, 5, C.ink);
    rect(g, kx - 9, 97, 18, 3, METER_BG);
    rect(g, kx - 9, 97, Math.round(18 * progress), 3, color);
    rect(g, kx - 9, 97, Math.round(18 * progress), 1, 'rgba(255,255,255,0.45)');
  } else if (!isOver(s) && canAct(s)) {
    blit(g, ARROW, kx - 3, 95 + (blink(t, 250) ? 0 : 1));
  }
}

function canAct(s: RushState): boolean {
  const reach = spotInReach(s);
  if (s.holdingGlass && reach !== null && s.spots[reach]) return true;
  return atPrepStation(s) && stationTask(s) !== null;
}

function drawBubbles(g: Ctx, s: RushState, t: number) {
  const servingSpot = s.task.kind === 'serving' ? s.task.spot : -1;
  const reach = spotInReach(s);
  RUSH.spotX.forEach((wx, i) => {
    const c = s.spots[i];
    if (!c) return;
    const x = toArtX(wx);
    const f = patienceFraction(c);
    const bar = barFor(f);
    const eager = s.holdingGlass && reach === i && servingSpot < 0 && blink(t, 150);
    const bx = x - 8;
    const by = BUBBLE_Y - (eager ? 1 : 0);
    blit(g, BUBBLE, bx, by);
    if (i === servingSpot) blit(g, HEART, bx + 4, by + 3);
    else blit(g, GLASS, bx + 5, by + 2);

    rect(g, bx, METER_Y, 16, 4, C.ink);
    rect(g, bx + 1, METER_Y + 1, 14, 2, METER_BG);
    if (bar !== 'red' || i === servingSpot || blink(t, 200)) {
      rect(g, bx + 1, METER_Y + 1, Math.max(1, Math.round(14 * f)), 2, RUSH_VIEW.barColor[bar]);
      rect(g, bx + 1, METER_Y + 1, Math.max(1, Math.round(14 * f)), 1, 'rgba(255,255,255,0.35)');
    }
    if (bar === 'red' && i !== servingSpot) blit(g, ANGER, x + 4, CUSTOMER_Y - 2);
  });
}

function drawWeather(g: Ctx, s: RushState, t: number) {
  const sky = s.plan.weather?.sky;
  if (sky !== 'rain' && sky !== 'storm') return;
  g.globalAlpha = 0.55;
  const drops = sky === 'storm' ? 60 : 36;
  for (let i = 0; i < drops; i++) {
    const x = (i * 53 + Math.floor(t * 0.05)) % ART_W;
    const y = HUD_H + ((i * 37 + Math.floor(t * 0.2)) % (STRIP_Y - HUD_H - 4));
    rect(g, x, y, 1, 3, '#dceeff');
  }
  g.globalAlpha = 1;
}

function drawPopups(g: Ctx, fx: Fx) {
  for (const p of fx.popups) {
    const k = Math.min(1, p.ageMs / RUSH_VIEW.popupMs);
    const rise = Math.round(16 * (1 - (1 - k) * (1 - k)));
    const y = p.y - rise;
    g.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
    if (p.coins) {
      for (let j = -1; j <= 1; j++) {
        const arc = Math.min(1, k * 1.6);
        const cx = p.x + Math.round(j * 14 * arc) - 3;
        const cy = p.y + 4 - Math.round(22 * Math.sin(Math.PI * arc * 0.75)) - (j === 0 ? 4 : 0);
        blit(g, COIN_FRAMES[coinFrameIndex(p.ageMs, j * 60, COIN_FRAMES.length)], cx, cy);
      }
    }
    label(g, p.text, p.x, y, p.coins ? 16 : 8, p.color);
  }
  g.globalAlpha = 1;
}

/** "9:00 AM" … "8:00 PM" */
export function clockLabel(ms: number, dayLengthMs: number): string {
  const { openHour, closeHour } = RUSH_VIEW;
  const hours = openHour + ((closeHour - openHour) * ms) / Math.max(1, dayLengthMs);
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const STOCK_ICONS: readonly [Item, PixelSprite][] = [
  ['lemons', ICON_LEMON],
  ['sugar', ICON_SUGAR],
  ['ice', ICON_ICE],
  ['cups', ICON_CUP],
];

function drawHud(g: Ctx, s: RushState) {
  const mid = HUD_H / 2;
  let x = 4;
  blit(g, ICON_CLOCK, x, mid - 4);
  x += ICON_CLOCK.w + 3;
  x += label(g, clockLabel(s.clockMs, s.plan.dayLengthMs), x, mid, 16, C.paper, 'left', null) + 8;
  blit(g, COIN_FRAMES[0], x, mid - 3);
  x += 9;
  x += label(g, `$${earned(s).toFixed(2)}`, x, mid, 16, C.lemon, 'left', null) + 9;
  const stock = stockLeft(s);
  for (const [item, icon] of STOCK_ICONS) {
    blit(g, icon, x, mid - Math.ceil(icon.h / 2));
    x += icon.w + 2;
    x += label(g, String(stock[item]), x, mid + 0.5, 12, stock[item] > 0 ? C.paper : C.melon, 'left', null) + 6;
  }
  blit(g, ICON_JUG, x, mid - 4);
  x += ICON_JUG.w + 2;
  label(g, `${s.jug}/${RUSH.jugCapacity}`, x, mid + 0.5, 12, s.jug > 0 ? C.lemon : C.melon, 'left', null);
  label(g, `DAY ${s.plan.day}`, ART_W - 4, mid + 0.5, 8, C.grayLight, 'right', null);
}

/** What the kid is doing, or what to do next. Shown in the bottom strip. */
export function actionText(s: RushState): string {
  if (s.task.kind === 'serving') return 'Serving...';
  if (s.task.kind === 'filling') return 'Filling jug...';
  if (s.task.kind === 'pouring') return 'Pouring...';
  const station = stationTask(s);
  if (s.holdingGlass) return 'Got a glass: serve a customer!';
  if (s.jug === 0) return station === 'filling' ? 'Jug empty: hold Space at the station' : 'Out of lemons or sugar';
  return station === 'pouring' ? 'Hold Space at the station to pour' : 'Out of cups or ice';
}

function drawStatus(g: Ctx, s: RushState, t: number) {
  const mid = STRIP_Y + (ART_H - STRIP_Y) / 2 + 0.5;
  const busy = s.task.kind !== 'idle';
  const urgent = !busy && s.jug === 0 && !s.holdingGlass;
  const color = busy ? C.lemon : urgent && blink(t, 500) ? C.melon : C.paper;
  const w = isOver(s) ? 0 : label(g, actionText(s), 6, mid, 12, color, 'left', null);
  const progress = taskProgress(s);
  if (progress !== null) {
    const x = 6 + w + 6;
    rect(g, x, mid - 3, 34, 6, C.paper);
    rect(g, x + 1, mid - 2, 32, 4, METER_BG);
    rect(g, x + 1, mid - 2, Math.round(32 * progress), 4, s.task.kind === 'serving' ? C.leaf : C.lemonDeep);
  }
  label(g, 'A/D or ARROWS move  SPACE act', ART_W - 5, mid, 8, C.gray, 'right', null);
}

function drawEndSign(g: Ctx, s: RushState, fx: Fx) {
  rect(g, 0, 0, ART_W, ART_H, DIM);
  // The sign drops in from above and settles with a small bounce
  const k = Math.min(1, fx.overMs / 380);
  const drop = k < 1 ? -Math.round(70 * (1 - k) * (1 - k)) : 0;
  const settle = fx.overMs > 380 && fx.overMs < 520 ? -2 : 0;
  const [bw, bh] = [176, 66];
  const bx = (ART_W - bw) / 2;
  const by = 34 + drop + settle;
  rect(g, bx + 30, by - 18, 1, 18, C.ink);
  rect(g, bx + bw - 31, by - 18, 1, 18, C.ink);
  rect(g, bx - 1, by - 1, bw + 2, bh + 2, C.ink);
  rect(g, bx, by, bw, bh, C.wood);
  rect(g, bx, by, bw, 2, C.woodLight);
  rect(g, bx, by + 22, bw, 1, C.woodDark);
  rect(g, bx, by + 44, bw, 1, C.woodDark);
  rect(g, bx, by + bh - 2, bw, 2, C.woodDark);
  for (const [nx, ny] of [[3, 3], [bw - 5, 3], [3, bh - 5], [bw - 5, bh - 5]]) rect(g, bx + nx, by + ny, 2, 2, C.gray);
  const soldOut = s.phase === 'soldOut';
  label(g, soldOut ? 'SOLD OUT' : 'CLOSED', ART_W / 2, by + 18, 32, soldOut ? C.melon : C.lemon);
  label(g, `SERVED ${s.served.length}   EARNED $${earned(s).toFixed(2)}`, ART_W / 2, by + 41, 8, C.paper, 'center', C.ink);
  label(
    g,
    `WALKED OUT ${s.walkouts}  NO ROOM ${s.noRoom}  MISSED ${s.soldOutMisses}`,
    ART_W / 2,
    by + 53,
    8,
    C.lemonPale,
    'center',
    C.ink,
  );
}
