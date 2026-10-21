// Minimal canvas front end for the Rush. All rules live in rushRules.ts; this file only turns keys
// into RushInput, calls step() once per animation frame, and draws the state.

import { useEffect, useRef } from 'react';
import type { DayOutcome, DayPlan } from '../contract';
import { RUSH, RUSH_VIEW } from './rushConfig';
import {
  type RushEvent,
  type RushInput,
  type RushState,
  atPrepStation,
  barFor,
  createRush,
  earned,
  isOver,
  patienceFraction,
  spotInReach,
  step,
  stockLeft,
  taskProgress,
  toOutcome,
} from './rushRules';

export interface RushGameProps {
  plan: DayPlan;
  /** Called exactly once per plan, after the SOLD OUT / CLOSED banner has shown. */
  onFinish: (outcome: DayOutcome) => void;
}

const KEYS: Record<string, keyof RushInput> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Space: 'space',
};

interface Popup {
  text: string;
  color: string;
  x: number;
  ageMs: number;
}

export function RushGame({ plan, onFinish }: RushGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onFinishRef = useRef(onFinish);
  /** The plan we've already reported. Guards against double calls (e.g. StrictMode re-running effects). */
  const finishedPlanRef = useRef<DayPlan | null>(null);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || finishedPlanRef.current === plan) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = RUSH_VIEW.width * dpr;
    canvas.height = RUSH_VIEW.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let state = createRush(plan);
    const keys: RushInput = { left: false, right: false, space: false };
    let popups: Popup[] = [];
    let lastNow: number | null = null;
    let overForMs = 0;
    let rafId = 0;

    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const key = KEYS[e.code];
      if (!key) return;
      e.preventDefault(); // Space and arrows would otherwise scroll the page
      keys[key] = down;
    };
    const onKeyDown = onKey(true);
    const onKeyUp = onKey(false);
    const onBlur = () => {
      keys.left = keys.right = keys.space = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    const frame = (now: number) => {
      const dt = lastNow === null ? 0 : Math.min(now - lastNow, RUSH_VIEW.maxFrameMs);
      lastNow = now;

      if (!isOver(state)) {
        state = step(state, dt, { ...keys });
        popups = popups.concat(state.events.flatMap(popupFor));
      } else {
        overForMs += dt;
      }
      popups = popups.map((p) => ({ ...p, ageMs: p.ageMs + dt })).filter((p) => p.ageMs < RUSH_VIEW.popupMs);
      draw(ctx, state, popups);

      if (isOver(state) && overForMs >= RUSH_VIEW.endBannerMs) {
        if (finishedPlanRef.current !== plan) {
          finishedPlanRef.current = plan;
          onFinishRef.current(toOutcome(state));
        }
        return; // stop the loop
      }
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [plan]);

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{ width: RUSH_VIEW.width, height: RUSH_VIEW.height, display: 'block', border: '1px solid #ccc' }}
      />
      <p style={{ fontFamily: 'system-ui, sans-serif', fontSize: 14 }}>
        ← / → or A / D to move · hold <b>Space</b> at 🍋 to make a glass · press <b>Space</b> at a customer to serve
      </p>
    </div>
  );
}

// ---------- Drawing ----------

const ROW_Y = 105; // centre of the spot boxes and the prep station
const BOX = 84;
const KID_Y = 225;
const FONT = 'system-ui, sans-serif';
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

function popupFor(e: RushEvent): Popup[] {
  if (e.kind === 'served') return [{ text: e.text, color: '#1a7f37', x: RUSH.spotX[e.spot], ageMs: 0 }];
  if (e.kind === 'walkout') return [{ text: 'walked out!', color: '#c0392b', x: RUSH.spotX[e.spot], ageMs: 0 }];
  if (e.kind === 'noRoom') return [{ text: 'no room!', color: '#c0392b', x: RUSH.spotX[RUSH.spotX.length - 1] - 70, ageMs: 0 }];
  return [];
}

function clockLabel(ms: number, dayLengthMs: number): string {
  const { openHour, closeHour } = RUSH_VIEW;
  const hours = openHour + ((closeHour - openHour) * ms) / Math.max(1, dayLengthMs);
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function kidStatus(s: RushState): string {
  if (s.task.kind === 'serving') return 'Serving…';
  if (s.task.kind === 'prepping') return 'Making a glass…';
  return s.holdingGlass ? 'Holding a glass' : 'Empty-handed';
}

function text(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, size: number, color = '#222', align: CanvasTextAlign = 'center') {
  ctx.font = `${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

function emoji(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, size: number) {
  ctx.font = `${size}px ${EMOJI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, fraction: number, color: string) {
  ctx.fillStyle = '#e5e5e5';
  ctx.fillRect(x, y, w, 8);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * fraction, 8);
}

function draw(ctx: CanvasRenderingContext2D, s: RushState, popups: Popup[]) {
  const { width: W, height: H } = RUSH_VIEW;
  ctx.fillStyle = '#fffbea';
  ctx.fillRect(0, 0, W, H);

  // HUD
  const stock = stockLeft(s);
  text(ctx, clockLabel(s.clockMs, s.plan.dayLengthMs), 14, 22, 18, '#222', 'left');
  text(ctx, `Earned $${earned(s).toFixed(2)}`, 120, 22, 18, '#1a7f37', 'left');
  text(ctx, `Stock  🍋${stock.lemons}  🍬${stock.sugar}  🧊${stock.ice}  🥤${stock.cups}`, 290, 22, 16, '#222', 'left');
  text(ctx, kidStatus(s), W - 14, 22, 16, '#555', 'right');

  // Kid's lane
  ctx.fillStyle = '#f3e3b5';
  ctx.fillRect(0, KID_Y - 30, W, 60);

  // Customer spots
  const reach = spotInReach(s);
  const servingSpot = s.task.kind === 'serving' ? s.task.spot : -1;
  RUSH.spotX.forEach((x, i) => {
    ctx.strokeStyle = reach === i ? '#e0a800' : '#bbb';
    ctx.lineWidth = reach === i ? 3 : 1;
    ctx.strokeRect(x - BOX / 2, ROW_Y - BOX / 2, BOX, BOX);
    const c = s.spots[i];
    if (!c) return;
    emoji(ctx, RUSH_VIEW.emoji[c.arrival.type], x, ROW_Y - 6, 44);
    const f = patienceFraction(c);
    bar(ctx, x - BOX / 2, ROW_Y + BOX / 2 + 6, BOX, f, RUSH_VIEW.barColor[barFor(f)]);
    if (i === servingSpot) text(ctx, 'being served', x, ROW_Y + BOX / 2 - 10, 11, '#555');
  });

  // Prep station
  ctx.strokeStyle = atPrepStation(s) ? '#e0a800' : '#bbb';
  ctx.lineWidth = atPrepStation(s) ? 3 : 1;
  ctx.strokeRect(RUSH.prepX - BOX / 2, ROW_Y - BOX / 2, BOX, BOX);
  emoji(ctx, '🍋', RUSH.prepX, ROW_Y - 6, 40);
  text(ctx, 'PREP', RUSH.prepX, ROW_Y + BOX / 2 - 10, 11, '#555');

  // Kid, held glass, task progress
  emoji(ctx, '🙂', s.kidX, KID_Y, 40);
  if (s.holdingGlass) emoji(ctx, '🥤', s.kidX + 30, KID_Y + 4, 26);
  const progress = taskProgress(s);
  if (progress !== null) bar(ctx, s.kidX - 30, KID_Y - 36, 60, progress, '#3b82f6');

  // Floating "+$X.XX"
  for (const p of popups) {
    const t = p.ageMs / RUSH_VIEW.popupMs;
    ctx.globalAlpha = 1 - t;
    text(ctx, p.text, p.x, ROW_Y - BOX / 2 - 4 - 30 * t, 18, p.color);
  }
  ctx.globalAlpha = 1;

  // End-of-day banner
  if (isOver(s)) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, W, H);
    text(ctx, s.phase === 'soldOut' ? 'SOLD OUT' : 'CLOSED', W / 2, H / 2 - 18, 48, '#fff');
    text(
      ctx,
      `Served ${s.served.length} · Walked out ${s.walkouts} · No room ${s.noRoom} · Sold-out misses ${s.soldOutMisses}`,
      W / 2,
      H / 2 + 26,
      16,
      '#fff',
    );
  }
}
