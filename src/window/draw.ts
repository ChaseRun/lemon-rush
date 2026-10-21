// Canvas renderer for the window Rush. Reads the rules' state + view fx and paints one frame on a 960×540
// canvas. Never changes state.

import type { Bar } from '../contract';
import type { Fx } from './fx';
import { CUSTOMER_HEIGHT, CUSTOMER_LABEL, CUSTOMER_SPRITES, COLORS, PALETTE, type PixelSprite } from './sprites';
import { WINDOW_VIEW } from './windowConfig';
import { type WindowRushState, barFor, freeForGlass, lemonsLeft, patienceLeft, sugarLeft } from './windowRules';
import { type HintTarget, LAYOUT, type Rect, clockLabel, money, nextHint } from './windowView';

const FONT = "'Baloo 2', 'Trebuchet MS', system-ui, sans-serif";
const BAR_COLOR: Record<Bar, string> = { green: '#2f9e44', yellow: '#f2b705', red: '#e8445f' };

export interface DrawOpts {
  reducedMotion: boolean;
  hover: HintTarget;
}

type Ctx = CanvasRenderingContext2D;

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function text(ctx: Ctx, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', weight = 700) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

function outlined(ctx: Ctx, s: string, x: number, y: number, size: number, fill: string, stroke: string = COLORS.ink, lw = 6) {
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lw;
  ctx.strokeStyle = stroke;
  ctx.strokeText(s, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(s, x, y);
}

function roundRect(ctx: Ctx, r: Rect, radius: number, fill: string, stroke?: string, lw = 3) {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

export function drawSprite(ctx: Ctx, sp: PixelSprite, x: number, y: number, px: number, tint?: string) {
  for (let r = 0; r < sp.h; r++) {
    const row = sp.rows[r];
    for (let c = 0; c < sp.w; c++) {
      const ch = row[c];
      if (ch === '.') continue;
      ctx.fillStyle = tint ?? PALETTE[ch] ?? '#f0f';
      ctx.fillRect(Math.floor(x + c * px), Math.floor(y + r * px), Math.ceil(px), Math.ceil(px));
    }
  }
}

/** A chunky pixel lemon centered at (cx, cy), `s` px per art pixel. */
function lemon(ctx: Ctx, cx: number, cy: number, s: number, squish = 1) {
  const rows = ['..yyyy..', '.yyyyyyY', 'yyyyyyyY', 'yyyyyyYY', '.yyyyyY.', '..YYYY..'];
  const w = 8 * s;
  const h = 6 * s * squish;
  const sy = s * squish;
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] === '.') continue;
      ctx.fillStyle = row[c] === 'y' ? COLORS.lemon : COLORS.lemonDeep;
      ctx.fillRect(cx - w / 2 + c * s, cy - h / 2 + r * sy, s, Math.ceil(sy));
    }
  });
  rect(ctx, cx + w / 2 - s * 0.5, cy - h / 2 - s * 0.4, s, s, COLORS.leaf);
}

function patienceBar(ctx: Ctx, x: number, y: number, w: number, h: number, frac: number, bar: Bar) {
  rect(ctx, x - 2, y - 2, w + 4, h + 4, COLORS.ink);
  rect(ctx, x, y, w, h, '#33415e');
  rect(ctx, x, y, w * frac, h, BAR_COLOR[bar]);
}

// ---------- scene ----------

const HORIZON = LAYOUT.window.y + 96;
const NEAR_FEET = 392;
const CX = LAYOUT.window.x + LAYOUT.window.w / 2 - 4;

function depthToScreen(d: number, lane: number) {
  const feet = HORIZON + 8 + (NEAR_FEET - HORIZON - 8) * Math.pow(d, 1.45);
  const scale = 0.16 + 0.84 * Math.pow(d, 1.15);
  const x = CX + lane * (30 + 190 * d);
  return { feet, px: 9 * scale, x };
}

function drawWall(ctx: Ctx) {
  rect(ctx, 0, 40, 960, LAYOUT.counterTop - 40, COLORS.woodLight);
  for (let x = 0; x < 960; x += 48) {
    rect(ctx, x, 40, 3, LAYOUT.counterTop - 40, COLORS.wood);
    rect(ctx, x + 22, 52, 3, 3, COLORS.woodDark);
    rect(ctx, x + 22, LAYOUT.counterTop - 18, 3, 3, COLORS.woodDark);
  }
}

function drawScene(ctx: Ctx, s: WindowRushState, fx: Fx) {
  const W = LAYOUT.window;
  ctx.save();
  ctx.beginPath();
  ctx.rect(W.x, W.y, W.w, W.h);
  ctx.clip();

  // Sky gets warmer as the day goes on.
  const frac = s.plan.dayLengthMs > 0 ? s.timeMs / s.plan.dayLengthMs : 0;
  const sky = ctx.createLinearGradient(0, W.y, 0, HORIZON);
  sky.addColorStop(0, frac > 0.8 ? '#7cc0f0' : COLORS.sky);
  sky.addColorStop(1, frac > 0.8 ? '#ffe2b8' : COLORS.skyLight);
  ctx.fillStyle = sky;
  ctx.fillRect(W.x, W.y, W.w, HORIZON - W.y);

  // Sun arcs across the window over the day.
  const sunX = W.x + 40 + frac * (W.w - 80);
  const sunY = W.y + 70 - Math.sin(frac * Math.PI) * 30;
  rect(ctx, sunX - 14, sunY - 10, 28, 20, COLORS.lemon);
  rect(ctx, sunX - 10, sunY - 14, 20, 28, COLORS.lemon);
  rect(ctx, sunX - 6, sunY - 6, 12, 12, '#fff3a0');

  // Drifting clouds.
  for (let i = 0; i < 3; i++) {
    const cx = W.x + ((i * 190 + fx.animMs * 0.008) % (W.w + 120)) - 60;
    const cy = W.y + 44 + i * 14;
    rect(ctx, cx, cy, 54, 10, '#ffffff');
    rect(ctx, cx + 10, cy - 8, 28, 10, '#ffffff');
  }

  // Far houses and trees on the horizon.
  const houses = [
    [W.x + 12, 34, COLORS.melon],
    [W.x + 70, 28, COLORS.deepSky],
    [W.x + 340, 30, COLORS.worker],
    [W.x + 430, 36, COLORS.grandma],
  ] as const;
  for (const [hx, hw, roof] of houses) {
    rect(ctx, hx, HORIZON - 22, hw, 22, COLORS.paperWarm);
    rect(ctx, hx - 3, HORIZON - 30, hw + 6, 9, roof);
    rect(ctx, hx + hw / 2 - 3, HORIZON - 12, 7, 12, COLORS.woodDark);
  }
  for (const tx of [W.x + 120, W.x + 160, W.x + 300, W.x + 480]) {
    rect(ctx, tx - 12, HORIZON - 34, 24, 26, COLORS.leaf);
    rect(ctx, tx - 7, HORIZON - 42, 14, 10, COLORS.leafLight);
    rect(ctx, tx - 2, HORIZON - 8, 4, 8, COLORS.woodDark);
  }

  // Grass and the sidewalk running up to the window.
  rect(ctx, W.x, HORIZON, W.w, W.y + W.h - HORIZON, COLORS.grass);
  for (let i = 0; i < 18; i++) rect(ctx, W.x + ((i * 53) % W.w), HORIZON + 10 + ((i * 37) % 140), 4, 4, COLORS.grassDark);
  ctx.beginPath();
  ctx.moveTo(CX - 16, HORIZON);
  ctx.lineTo(CX + 16, HORIZON);
  ctx.lineTo(CX + 250, W.y + W.h);
  ctx.lineTo(CX - 250, W.y + W.h);
  ctx.closePath();
  ctx.fillStyle = COLORS.sidewalk;
  ctx.fill();
  for (let k = 1; k < 9; k++) {
    const t = Math.pow(k / 9, 1.6);
    const y = HORIZON + t * (W.y + W.h - HORIZON);
    const half = 16 + t * 234;
    rect(ctx, CX - half, y, half * 2, 2, COLORS.sidewalkSeam);
  }

  // People: far first.
  type Body = { d: number; lane: number; type: keyof typeof CUSTOMER_SPRITES; moving: boolean; mood?: string; frac?: number; atWindow?: boolean; age?: number };
  const bodies: Body[] = [];
  s.line.forEach((c, i) => {
    const w = fx.walkers.get(c.arrival.id);
    if (!w) return;
    bodies.push({ d: w.d, lane: w.lane, type: c.arrival.type, moving: w.moving, frac: patienceLeft(c, s.timeMs), atWindow: i < s.config.windows && !w.moving });
  });
  for (const l of fx.leavers) bodies.push({ d: l.d, lane: l.lane, type: l.type, moving: true, mood: l.mood, age: l.ageMs });
  bodies.sort((a, b) => a.d - b.d);
  for (const b of bodies) {
    const { feet, px, x } = depthToScreen(b.d, b.lane);
    const sp = CUSTOMER_SPRITES[b.type];
    const hpx = px * CUSTOMER_HEIGHT[b.type];
    const bob = b.moving ? Math.round(Math.abs(Math.sin(fx.animMs / 110 + b.d * 20)) * px * 0.6) : 0;
    const top = feet - sp.h * hpx - bob;
    const left = x - (sp.w * px) / 2;
    // Shadow.
    ctx.fillStyle = 'rgba(27,43,72,0.18)';
    ctx.fillRect(left + px, feet - px * 0.4, (sp.w - 2) * px, px * 0.8);
    drawSprite(ctx, sp, left, top, px);
    // Mouth mood overlay.
    if (b.mood === 'happy' || (b.frac !== undefined && b.frac > 0.6)) {
      rect(ctx, left + 4 * px, top + 6 * hpx, 4 * px, Math.max(1, hpx * 0.6), COLORS.ink);
      rect(ctx, left + 4 * px, top + 6 * hpx - hpx * 0.5, px, hpx * 0.5, COLORS.ink);
      rect(ctx, left + 7 * px, top + 6 * hpx - hpx * 0.5, px, hpx * 0.5, COLORS.ink);
    }
    if (b.mood === 'angry') {
      const puff = (b.age ?? 0) / 200;
      rect(ctx, x + px * 3, top - px * 3 - (puff % 3) * px, px * 2, px * 2, '#ffffff');
      rect(ctx, x - px * 5, top - px * 2 - ((puff + 1.5) % 3) * px, px * 2, px * 2, '#ffffff');
      text(ctx, '💢', x + px * 5, top + px, Math.max(10, px * 4), COLORS.melon, 'center');
    } else if (b.mood === 'happy') {
      text(ctx, '♥', x, top - px * 2 - (b.age ?? 0) * 0.02, Math.max(10, px * 4), COLORS.melon, 'center');
    }
    if (b.frac !== undefined) {
      const bar = barFor(b.frac, s.config);
      const bw = Math.max(18, sp.w * px * 0.8);
      patienceBar(ctx, x - bw / 2, top - Math.max(8, px * 2.2), bw, Math.max(3, px * 0.8), b.frac, bar);
      if (b.atWindow && bar === 'red' && Math.floor(fx.animMs / 250) % 2 === 0) text(ctx, '!', x + bw / 2 + 10, top - px * 2, 28, COLORS.melon, 'center', 800);
    }
  }

  // Awning scallops hanging into the top of the window.
  for (let i = 0; i < W.w / 34; i++) {
    const ax = W.x + i * 34;
    const col = i % 2 === 0 ? COLORS.lemon : COLORS.paper;
    rect(ctx, ax, W.y, 34, 18, col);
    ctx.beginPath();
    ctx.arc(ax + 17, W.y + 18, 17, 0, Math.PI);
    ctx.fillStyle = col;
    ctx.fill();
  }
  ctx.restore();

  // Frame.
  ctx.lineWidth = 14;
  ctx.strokeStyle = COLORS.woodDeep;
  ctx.strokeRect(W.x - 7, W.y - 7, W.w + 14, W.h + 14);
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLORS.woodPale;
  ctx.strokeRect(W.x - 13, W.y - 13, W.w + 26, W.h + 26);
}

function drawSign(ctx: Ctx, s: WindowRushState) {
  const r = LAYOUT.sign;
  rect(ctx, r.x + r.w / 2 - 1, r.y - 22, 2, 22, COLORS.woodDeep);
  rect(ctx, r.x + r.w / 2 - 4, r.y - 26, 8, 8, COLORS.inkSoft);
  roundRect(ctx, r, 8, '#24543a', COLORS.woodDeep, 6);
  text(ctx, 'LEMONADE', r.x + r.w / 2, r.y + 24, 20, COLORS.lemon, 'center', 800);
  text(ctx, money(s.plan.price), r.x + r.w / 2, r.y + 58, 34, '#ffffff', 'center', 800);
  text(ctx, `Day ${s.plan.day}`, r.x + r.w / 2, r.y + 92, 15, '#cfe8d6', 'center');
}

function drawTicket(ctx: Ctx, s: WindowRushState) {
  const r = LAYOUT.ticket;
  ctx.save();
  ctx.translate(r.x + r.w / 2, r.y);
  ctx.rotate(0.025);
  ctx.translate(-(r.x + r.w / 2), -r.y);
  rect(ctx, r.x + 4, r.y + 4, r.w, r.h, 'rgba(27,43,72,0.25)');
  rect(ctx, r.x, r.y, r.w, r.h, COLORS.paper);
  for (let x = r.x; x < r.x + r.w; x += 10) rect(ctx, x, r.y + r.h, 5, 4, COLORS.paper);
  rect(ctx, r.x + r.w / 2 - 6, r.y - 6, 12, 12, COLORS.melon);
  const cx = r.x + 14;
  text(ctx, 'ORDER', cx, r.y + 24, 20, COLORS.ink, 'left', 800);
  const c = s.line[0];
  if (c) {
    text(ctx, `#${c.arrival.id + 1}`, r.x + r.w - 14, r.y + 24, 16, COLORS.inkSoft, 'right');
    text(ctx, CUSTOMER_LABEL[c.arrival.type], cx, r.y + 50, 16, COLORS.ink);
    text(ctx, '1 × lemonade 🍋', cx, r.y + 72, 15, COLORS.inkSoft);
    const frac = patienceLeft(c, s.timeMs);
    patienceBar(ctx, cx, r.y + 90, r.w - 28, 12, frac, barFor(frac, s.config));
    const tipPct = Math.round(c.arrival.tipRate * 100);
    text(ctx, tipPct > 0 ? `tips ${tipPct}% when happy` : 'never tips', cx, r.y + 118, 13, COLORS.inkSoft);
  } else {
    text(ctx, 'Nobody at the window', cx, r.y + 60, 15, COLORS.inkSoft);
  }
  // Line dots.
  const max = s.config.maxLine;
  text(ctx, 'LINE', cx, r.y + 146, 14, COLORS.ink, 'left', 800);
  for (let i = 0; i < max; i++) {
    const p = s.line[i];
    const col = p ? BAR_COLOR[barFor(patienceLeft(p, s.timeMs), s.config)] : COLORS.grayLight;
    rect(ctx, cx + 48 + i * 22, r.y + 139, 15, 15, col);
  }
  // Glass checklist.
  const g = s.glass;
  const steps: [string, boolean][] = [
    ['Cup', !!g],
    ['Ice', !!g?.ice],
    ['Pour', g?.phase === 'poured'],
  ];
  text(ctx, 'GLASS', cx, r.y + 176, 14, COLORS.ink, 'left', 800);
  steps.forEach(([label, done], i) => {
    const x = cx + i * 62;
    rect(ctx, x, r.y + 190, 14, 14, done ? COLORS.leaf : COLORS.grayLight);
    if (done) text(ctx, '✓', x + 7, r.y + 197, 13, '#fff', 'center', 800);
    text(ctx, label, x + 19, r.y + 197, 14, COLORS.ink);
  });
  if (g?.pour === 'under') text(ctx, 'underfilled · tip ×½', cx, r.y + 226, 13, COLORS.lemonDeep);
  else if (g?.phase === 'poured') text(ctx, 'Ready to hand over!', cx, r.y + 226, 14, COLORS.leaf, 'left', 800);
  ctx.restore();
}

// ---------- counter ----------

function drawCounter(ctx: Ctx) {
  rect(ctx, 0, LAYOUT.counterTop - 8, 960, 10, COLORS.woodDeep);
  rect(ctx, 0, LAYOUT.counterTop, 960, 506 - LAYOUT.counterTop, COLORS.woodPale);
  for (let y = LAYOUT.counterTop + 34; y < 506; y += 36) rect(ctx, 0, y, 960, 2, COLORS.woodLight);
  rect(ctx, 0, 506, 960, 34, COLORS.wood);
  rect(ctx, 0, 506, 960, 4, COLORS.woodDark);
}

function keyBadge(ctx: Ctx, key: string, x: number, y: number) {
  roundRect(ctx, { x: x - 11, y: y - 11, w: 22, h: 22 }, 5, COLORS.ink);
  text(ctx, key, x, y + 1, 14, '#fff', 'center', 800);
}

function countLabel(ctx: Ctx, r: Rect, n: number, label: string) {
  text(ctx, `${label} ${n}`, r.x + r.w / 2, r.y + r.h + 14, 14, n > 0 ? COLORS.woodDeep : COLORS.melon, 'center', 800);
}

function highlight(ctx: Ctx, r: Rect, color: string) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(r.x - 6, r.y - 6, r.w + 12, r.h + 12);
  ctx.setLineDash([]);
}

function drawCrate(ctx: Ctx, s: WindowRushState) {
  const r = LAYOUT.crate;
  const n = lemonsLeft(s);
  const heap = Math.min(5, n);
  const spots = [
    [0.22, 0.12],
    [0.5, 0.06],
    [0.78, 0.12],
    [0.36, -0.06],
    [0.64, -0.06],
  ];
  for (let i = 0; i < heap; i++) lemon(ctx, r.x + r.w * spots[i][0], r.y + 22 + r.h * spots[i][1], 4);
  rect(ctx, r.x, r.y + 28, r.w, r.h - 28, COLORS.wood);
  for (let y = r.y + 36; y < r.y + r.h; y += 18) rect(ctx, r.x, y, r.w, 3, COLORS.woodDark);
  rect(ctx, r.x, r.y + 28, 6, r.h - 28, COLORS.woodDark);
  rect(ctx, r.x + r.w - 6, r.y + 28, 6, r.h - 28, COLORS.woodDark);
  text(ctx, 'LEMONS', r.x + r.w / 2, r.y + 60, 15, COLORS.lemonPale, 'center', 800);
  keyBadge(ctx, '1', r.x + 6, r.y + 30);
  countLabel(ctx, r, n, '🍋');
}

function drawSugarBag(ctx: Ctx, s: WindowRushState, fx: Fx) {
  const r = LAYOUT.sugar;
  const m = s.jug.making;
  const n = sugarLeft(s);
  if (m?.kind === 'sugar') {
    // The bag is up over the jug; leave an outline where it sat.
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = COLORS.woodLight;
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x + 8, r.y + 20, r.w - 16, r.h - 20);
    ctx.setLineDash([]);
  } else {
    const lift = m?.kind === 'sugarReady' ? Math.abs(Math.sin(fx.animMs / 160)) * 6 : 0;
    drawBag(ctx, r.x + 8, r.y + 14 - lift, r.w - 16, r.h - 14);
  }
  keyBadge(ctx, '2', r.x + 8, r.y + 22);
  countLabel(ctx, r, n, '🍬');
}

function drawBag(ctx: Ctx, x: number, y: number, w: number, h: number) {
  rect(ctx, x, y + 12, w, h - 12, COLORS.paperWarm);
  rect(ctx, x + 6, y, w - 12, 14, '#efe2c4');
  rect(ctx, x, y + 12, w, 4, '#d8c9a4');
  rect(ctx, x + 8, y + h * 0.42, w - 16, 26, COLORS.deepSky);
  text(ctx, 'SUGAR', x + w / 2, y + h * 0.42 + 13, 14, '#fff', 'center', 800);
}

function drawCooler(ctx: Ctx, s: WindowRushState, fx: Fx) {
  const r = LAYOUT.cooler;
  const free = freeForGlass(s).ice;
  rect(ctx, r.x, r.y + 18, r.w, r.h - 18, COLORS.deepSky);
  rect(ctx, r.x, r.y + 8, r.w, 14, COLORS.paper);
  rect(ctx, r.x + r.w / 2 - 16, r.y + 2, 32, 8, COLORS.grayLight);
  rect(ctx, r.x + 8, r.y + r.h - 12, r.w - 16, 4, '#2a7cc0');
  for (let i = 0; i < Math.min(4, free); i++) {
    const ix = r.x + 22 + i * 22;
    const jig = fx.plinkMs > 0 && i === 0 ? -6 : 0;
    rect(ctx, ix, r.y - 6 + (i % 2) * 4 + jig, 16, 14, COLORS.ice);
    rect(ctx, ix + 2, r.y - 4 + (i % 2) * 4 + jig, 5, 4, '#ffffff');
  }
  text(ctx, 'ICE', r.x + r.w / 2, r.y + 52, 18, '#fff', 'center', 800);
  keyBadge(ctx, '3', r.x + 6, r.y + 20);
  countLabel(ctx, r, free, '🧊');
}

function drawCups(ctx: Ctx, s: WindowRushState) {
  const r = LAYOUT.cups;
  const free = freeForGlass(s).cups;
  const stack = Math.min(6, free);
  for (let i = 0; i < stack; i++) {
    const y = r.y + r.h - 46 - i * 9;
    cupShape(ctx, r.x + r.w / 2, y, 30, 44, i === stack - 1);
  }
  keyBadge(ctx, '4', r.x + 4, r.y + 24);
  countLabel(ctx, r, free, '🥤');
}

function cupShape(ctx: Ctx, cx: number, top: number, w: number, h: number, rim: boolean) {
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, top);
  ctx.lineTo(cx + w / 2, top);
  ctx.lineTo(cx + w / 2 - 5, top + h);
  ctx.lineTo(cx - w / 2 + 5, top + h);
  ctx.closePath();
  ctx.fillStyle = 'rgba(230,246,255,0.9)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#7fb4d8';
  ctx.stroke();
  if (rim) rect(ctx, cx - w / 2 - 1, top - 2, w + 2, 4, COLORS.melon);
}

function drawJug(ctx: Ctx, s: WindowRushState, fx: Fx) {
  const r = LAYOUT.jug;
  const m = s.jug.making;
  const g = s.glass;
  const cap = s.config.jugCapacity;
  ctx.save();
  // Tilt toward the glass while pouring.
  if (g?.phase === 'pouring') {
    ctx.translate(r.x + r.w, r.y + r.h);
    ctx.rotate(0.55);
    ctx.translate(-(r.x + r.w), -(r.y + r.h));
  }
  const bx = r.x + 8;
  const by = r.y + 18;
  const bw = r.w - 30;
  const bh = r.h - 18;
  // Liquid level: during the squeeze the juice rises with taps.
  let level = s.jug.glasses / cap;
  let liquid: string = COLORS.lemon;
  if (m?.kind === 'squeeze') level = (s.jug.glasses / cap) * (m.taps / s.config.squeeze.taps);
  if (m && m.kind !== 'squeeze') liquid = '#ffe680';
  rect(ctx, bx, by, bw, bh, 'rgba(230,246,255,0.75)');
  if (level > 0) rect(ctx, bx + 4, by + bh - 4 - (bh - 12) * level, bw - 8, (bh - 12) * level, liquid);
  // Sugar step: show the sugar in the jug as a white layer.
  if (m?.kind === 'sugar') {
    const sh = (bh - 12) * m.level * 0.45;
    rect(ctx, bx + 4, by + bh - 4 - sh, bw - 8, sh, 'rgba(255,255,255,0.85)');
  }
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#7fb4d8';
  ctx.strokeRect(bx, by, bw, bh);
  // Spout + handle.
  rect(ctx, bx + bw, by - 2, 14, 8, '#7fb4d8');
  ctx.beginPath();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#7fb4d8';
  ctx.arc(bx, by + bh / 2, 22, Math.PI * 0.5, Math.PI * 1.5);
  ctx.stroke();
  // Stir: spoon swings with the strokes.
  if (m?.kind === 'stir') {
    const ang = fx.spoon * 0.45;
    const px = bx + bw / 2;
    const py = by + bh - 20;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    rect(ctx, -3, -bh - 10, 6, bh, COLORS.gray);
    rect(ctx, -8, -16, 16, 18, COLORS.grayLight);
    ctx.restore();
    // swirl
    ctx.strokeStyle = 'rgba(242,183,5,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(px, by + bh - 30, 22, 7, 0, fx.animMs / 120, fx.animMs / 120 + 4);
    ctx.stroke();
  }
  ctx.restore();

  // Squeeze: a big lemon getting squished above the jug, drops falling.
  if (m?.kind === 'squeeze') {
    const squish = fx.squishMs > 0 ? 0.62 : 1;
    lemon(ctx, bx + bw / 2, r.y - 8 + (1 - squish) * 14, 9, squish);
    rect(ctx, bx + bw / 2 - 22, r.y - 44 + (1 - squish) * 18, 44, 12, COLORS.grayLight);
    if (fx.squishMs > 0) {
      rect(ctx, bx + bw / 2 - 6, r.y + 22, 5, 8, COLORS.lemonDeep);
      rect(ctx, bx + bw / 2 + 6, r.y + 34, 5, 8, COLORS.lemonDeep);
    }
  }
  // Sugar: bag tipped over the jug, grains falling while held.
  if (m?.kind === 'sugar') {
    ctx.save();
    ctx.translate(bx - 20, r.y - 40);
    ctx.rotate(0.9);
    drawBag(ctx, 0, -40, 58, 70);
    ctx.restore();
    if (m.pouring) {
      for (let i = 0; i < 6; i++) {
        const gy = ((fx.animMs * 0.3 + i * 17) % 60) + r.y - 4;
        rect(ctx, bx + bw / 2 - 6 + ((i * 7) % 12), gy, 3, 3, '#ffffff');
      }
    }
  }

  // Label + quality.
  const label = m ? 'making…' : `${s.jug.glasses}/${cap}`;
  text(ctx, `JUG ${label}`, r.x + r.w / 2 - 8, r.y + r.h + 14, 15, COLORS.woodDeep, 'center', 800);
  if (s.jug.quality && !m) {
    const q = s.jug.quality;
    const stars = q === 'perfect' ? '★★★' : q === 'good' ? '★★' : '★';
    text(ctx, stars, r.x + r.w / 2 - 8, r.y + 8, 18, q === 'perfect' ? COLORS.lemonDeep : COLORS.inkSoft, 'center', 800);
  }
}

/** Gauge beside the jug: squeeze meter, sugar band, or stir progress, plus a timer bar. */
function drawGauge(ctx: Ctx, s: WindowRushState, fx: Fx) {
  const m = s.jug.making;
  if (!m || m.kind === 'sugarReady') return;
  const r = LAYOUT.gauge;
  const cfg = s.config;
  rect(ctx, r.x - 3, r.y - 3, r.w + 6, r.h + 6, COLORS.ink);
  rect(ctx, r.x, r.y, r.w, r.h, '#33415e');
  const fill = (f: number, col: string) => rect(ctx, r.x, r.y + r.h * (1 - f), r.w, r.h * f, col);
  let timer: { frac: number; perfect: number } | null = null;
  if (m.kind === 'squeeze') {
    fill(m.taps / cfg.squeeze.taps, COLORS.lemon);
    if (m.started) timer = { frac: 1 - m.elapsedMs / cfg.squeeze.windowMs, perfect: 1 - cfg.squeeze.perfectMs / cfg.squeeze.windowMs };
    text(ctx, `${m.taps}/${cfg.squeeze.taps}`, r.x + r.w / 2, r.y - 14, 13, COLORS.ink, 'center', 800);
  } else if (m.kind === 'sugar') {
    const lo = m.center - cfg.sugar.bandHalf;
    const hi = m.center + cfg.sugar.bandHalf;
    rect(ctx, r.x, r.y + r.h * (1 - hi), r.w, r.h * (hi - lo), '#2f9e44');
    rect(ctx, r.x, r.y + r.h * (1 - m.center - cfg.sugar.perfectTol), r.w, r.h * cfg.sugar.perfectTol * 2, '#69e07a');
    fill(m.level, 'rgba(255,255,255,0.85)');
    rect(ctx, r.x - 6, r.y + r.h * (1 - m.level) - 2, r.w + 12, 4, COLORS.lemon);
  } else if (m.kind === 'stir') {
    fill(m.strokes / cfg.stir.strokes, COLORS.leafLight);
    if (m.started) timer = { frac: 1 - m.elapsedMs / cfg.stir.limitMs, perfect: 1 - cfg.stir.perfectMs / cfg.stir.limitMs };
    text(ctx, `${m.strokes}/${cfg.stir.strokes}`, r.x + r.w / 2, r.y - 14, 13, COLORS.ink, 'center', 800);
    // Arrow hint flips with the expected direction.
    const want = m.lastDir === 'left' ? '→' : m.lastDir === 'right' ? '←' : '← →';
    outlined(ctx, want, LAYOUT.jug.x + LAYOUT.jug.w / 2 - 8, LAYOUT.jug.y - 26 + Math.sin(fx.animMs / 90) * 3, 34, COLORS.lemon, COLORS.ink, 5);
  }
  if (timer) {
    const tx = LAYOUT.jug.x - 4;
    const ty = LAYOUT.jug.y + LAYOUT.jug.h + 30;
    const tw = LAYOUT.jug.w + 30;
    rect(ctx, tx - 2, ty - 2, tw + 4, 10, COLORS.ink);
    rect(ctx, tx, ty, tw * Math.max(0, timer.frac), 6, timer.frac > timer.perfect ? COLORS.lemon : COLORS.melon);
    rect(ctx, tx + tw * timer.perfect, ty - 4, 2, 14, '#fff');
  }
}

function drawGlass(ctx: Ctx, s: WindowRushState, fx: Fx) {
  const r = LAYOUT.glass;
  // Coaster.
  rect(ctx, r.x + 4, r.y + r.h - 6, r.w - 8, 8, COLORS.woodDark);
  if (fx.spillMs > 0) {
    ctx.fillStyle = `rgba(255,212,59,${fx.spillMs / 900})`;
    ctx.beginPath();
    ctx.ellipse(r.x + r.w / 2, r.y + r.h, 56, 10, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const g = s.glass;
  if (!g) {
    text(ctx, 'glass', r.x + r.w / 2, r.y + r.h - 24, 13, COLORS.woodLight, 'center', 700);
    return;
  }
  const top = r.y + 4;
  const h = r.h - 10;
  const w = r.w - 8;
  const cx = r.x + r.w / 2;
  // Liquid: fill 1.0 = brim.
  const lh = h * Math.min(1, g.fill);
  if (lh > 0) rect(ctx, cx - w / 2 + 6, top + h - lh, w - 12, lh, COLORS.lemon);
  if (g.ice) {
    const iy = Math.max(top + 8, top + h - lh - 10) - (fx.plinkMs > 0 ? fx.plinkMs / 10 : 0);
    rect(ctx, cx - 12, iy, 18, 16, COLORS.ice);
    rect(ctx, cx - 9, iy + 3, 5, 4, '#ffffff');
  }
  cupShape(ctx, cx, top, w, h, false);
  // Pouring stream.
  if (g.phase === 'pouring') {
    rect(ctx, cx - 4, top - 34, 8, 34 + h - lh, COLORS.lemon);
  }
  // Fill lines (shown until the glass is poured).
  if (g.phase !== 'poured') {
    const lo = top + h * (1 - s.config.pour.lowerLine);
    const hi = top + h * (1 - s.config.pour.upperLine);
    ctx.fillStyle = 'rgba(47,158,68,0.18)';
    ctx.fillRect(cx - w / 2 - 6, hi, w + 12, lo - hi);
    rect(ctx, cx - w / 2 - 8, lo - 1, w + 16, 3, COLORS.leaf);
    rect(ctx, cx - w / 2 - 8, hi - 1, w + 16, 3, COLORS.melon);
  } else {
    // Straw + lemon wedge for a finished glass.
    rect(ctx, cx + 8, top - 18, 4, 34, COLORS.melon);
    lemon(ctx, cx - w / 2 + 4, top + 2, 2.5);
  }
}

function drawArrow(ctx: Ctx, target: HintTarget, fx: Fx, reduced: boolean) {
  const map: Partial<Record<NonNullable<HintTarget>, Rect>> = {
    crate: LAYOUT.crate,
    sugar: LAYOUT.sugar,
    cooler: LAYOUT.cooler,
    cups: LAYOUT.cups,
    glass: LAYOUT.glass,
    window: { x: LAYOUT.atWindow.x, y: 150, w: LAYOUT.atWindow.w, h: 10 },
  };
  if (!target || !map[target]) return;
  const r = map[target]!;
  const bob = reduced ? 0 : Math.abs(Math.sin(fx.animMs / 180)) * 8;
  const x = r.x + r.w / 2;
  const y = r.y - 28 - bob;
  ctx.beginPath();
  ctx.moveTo(x - 14, y - 10);
  ctx.lineTo(x + 14, y - 10);
  ctx.lineTo(x, y + 8);
  ctx.closePath();
  ctx.fillStyle = COLORS.lemon;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
}

function drawPrompt(ctx: Ctx, s: WindowRushState, fx: Fx) {
  const h = nextHint(s);
  if (!h.text || s.over) return;
  ctx.font = `800 17px ${FONT}`;
  const w = ctx.measureText(h.text).width + 32;
  const pulse = h.urgent ? 1 + Math.sin(fx.animMs / 90) * 0.03 : 1;
  ctx.save();
  ctx.translate(480, 349);
  ctx.scale(pulse, pulse);
  roundRect(ctx, { x: -w / 2, y: -15, w, h: 30 }, 15, h.urgent ? COLORS.lemon : COLORS.ink, COLORS.ink, 3);
  text(ctx, h.text, 0, 1, 17, h.urgent ? COLORS.ink : '#fff', 'center', 800);
  ctx.restore();
}

function drawHud(ctx: Ctx, s: WindowRushState) {
  rect(ctx, 0, 0, 960, 40, COLORS.ink);
  const frac = s.plan.dayLengthMs > 0 ? Math.min(1, s.timeMs / s.plan.dayLengthMs) : 1;
  rect(ctx, 0, 37, 960, 3, '#33415e');
  rect(ctx, 0, 37, 960 * frac, 3, COLORS.lemon);
  text(ctx, `☀ ${clockLabel(s.timeMs, s.plan.dayLengthMs)}`, 16, 19, 20, COLORS.lemon, 'left', 800);
  text(ctx, `Earned ${money(s.earned)}`, 170, 19, 18, '#fff', 'left', 800);
  text(ctx, `Served ${s.served.length}`, 340, 19, 15, '#cfe3f2');
  const free = freeForGlass(s);
  const stock = `🍋 ${lemonsLeft(s)}   🍬 ${sugarLeft(s)}   🧊 ${free.ice}   🥤 ${free.cups}`;
  text(ctx, stock, 944, 19, 16, '#fff', 'right', 700);
}

function drawPops(ctx: Ctx, fx: Fx) {
  for (const p of fx.pops) {
    const life = p.kind === 'grade' ? WINDOW_VIEW.popMs + 200 : WINDOW_VIEW.popMs;
    const t = p.ageMs / life;
    const alpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    if (p.kind === 'grade') {
      const k = p.ageMs < 120 ? 0.4 + (p.ageMs / 120) * 0.9 : p.ageMs < 220 ? 1.3 - ((p.ageMs - 120) / 100) * 0.3 : 1;
      ctx.translate(p.x, p.y - t * 16);
      ctx.scale(k, k);
      outlined(ctx, p.text, 0, 0, 58, p.color, COLORS.ink, 10);
      if (p.sub) outlined(ctx, p.sub, 0, 40, 20, '#fff', COLORS.ink, 5);
    } else if (p.kind === 'coin') {
      const y = p.y - t * 60;
      ctx.beginPath();
      ctx.arc(p.x - 70, y, 13, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.lemonDeep;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = COLORS.ink;
      ctx.stroke();
      text(ctx, '$', p.x - 70, y + 1, 16, COLORS.ink, 'center', 800);
      outlined(ctx, p.text, p.x + 6, y, 34, p.color, COLORS.ink, 7);
      if (p.sub) outlined(ctx, p.sub, p.x, y + 28, 15, '#fff', COLORS.ink, 4);
    } else if (p.kind === 'toast') {
      outlined(ctx, p.text, p.x, p.y - t * 10, 20, p.color, '#fff', 5);
    } else {
      outlined(ctx, p.text, p.x, p.y - t * 30, 22, p.color, COLORS.ink, 5);
      if (p.sub) outlined(ctx, p.sub, p.x, p.y - t * 30 + 20, 13, '#fff', COLORS.ink, 4);
    }
    ctx.restore();
  }
}

function drawEnd(ctx: Ctx, s: WindowRushState, fx: Fx, reduced: boolean) {
  if (!s.over) return;
  const t = Math.min(1, fx.overMs / 400);
  ctx.fillStyle = `rgba(27,43,72,${0.45 * t})`;
  ctx.fillRect(0, 0, 960, 540);
  const drop = reduced ? 0 : (1 - t) * -200;
  const w = 420;
  const h = 170;
  ctx.save();
  ctx.translate(480, 250 + drop);
  ctx.rotate(reduced ? 0 : -0.03);
  roundRect(ctx, { x: -w / 2, y: -h / 2, w, h }, 14, s.endReason === 'soldOut' ? COLORS.melon : COLORS.lemon, COLORS.ink, 6);
  const title = s.endReason === 'soldOut' ? 'SOLD OUT!' : 'CLOSED';
  outlined(ctx, title, 0, -36, 54, '#fff', COLORS.ink, 9);
  const early = s.endReason === 'closed' && s.timeMs < s.plan.dayLengthMs;
  const at = clockLabel(s.timeMs, s.plan.dayLengthMs);
  const sub = s.endReason === 'soldOut' ? `at ${at}` : early ? `closed early at ${at}` : '5:00pm · see you tomorrow';
  text(ctx, sub, 0, 10, 18, COLORS.ink, 'center', 800);
  text(ctx, `Served ${s.served.length} · Earned ${money(s.earned)}`, 0, 46, 20, COLORS.ink, 'center', 800);
  ctx.restore();
}

export function drawFrame(ctx: Ctx, s: WindowRushState, fx: Fx, opts: DrawOpts) {
  ctx.save();
  ctx.clearRect(0, 0, WINDOW_VIEW.width, WINDOW_VIEW.height);
  if (fx.shakeMs > 0 && !opts.reducedMotion) {
    const k = (fx.shakeMs / WINDOW_VIEW.shakeMs) * WINDOW_VIEW.shakePx;
    ctx.translate(Math.sin(fx.animMs * 0.9) * k, Math.cos(fx.animMs * 1.3) * k * 0.6);
  }
  drawWall(ctx);
  drawScene(ctx, s, fx);
  drawSign(ctx, s);
  drawTicket(ctx, s);
  drawCounter(ctx);
  drawCrate(ctx, s);
  drawSugarBag(ctx, s, fx);
  drawCooler(ctx, s, fx);
  drawCups(ctx, s);
  drawGlass(ctx, s, fx);
  drawJug(ctx, s, fx);
  drawGauge(ctx, s, fx);
  const hint = nextHint(s);
  if (opts.hover && opts.hover !== hint.target) {
    const r = ({ crate: LAYOUT.crate, sugar: LAYOUT.sugar, cooler: LAYOUT.cooler, cups: LAYOUT.cups, jug: LAYOUT.jug, glass: LAYOUT.glass, window: LAYOUT.atWindow } as const)[opts.hover];
    if (r) highlight(ctx, r, '#ffffff');
  }
  if (!s.over) drawArrow(ctx, hint.target, fx, opts.reducedMotion);
  drawPrompt(ctx, s, fx);
  drawHud(ctx, s);
  drawPops(ctx, fx);
  drawEnd(ctx, s, fx, opts.reducedMotion);
  ctx.restore();
}
