// Canvas front end for the Rush. All rules live in rushRules.ts; this file only turns keys into
// RushInput, calls step() once per animation frame, and hands the state to the pixel-art renderer
// (pixel/draw.ts). View-only animation (facing, pop-ups, customers walking off) lives in pixel/fx.ts.

import { useEffect, useRef } from 'react';
import type { DayOutcome, DayPlan } from '../contract';
import { RUSH_VIEW } from './rushConfig';
import { type RushInput, createRush, isOver, step, toOutcome } from './rushRules';
import { ART_H, ART_W, buildLayers, drawFrame } from './pixel/draw';
import { createFx, updateFx } from './pixel/fx';
import './rush.css';

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

    // Integer device pixels per art pixel keeps every art pixel the same size.
    const dpr = window.devicePixelRatio || 1;
    const k = Math.max(1, Math.round(RUSH_VIEW.pixelScale * dpr));
    canvas.width = ART_W * k;
    canvas.height = ART_H * k;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // Ask for the pixel font now; canvas text uses a monospace fallback until it arrives.
    document.fonts?.load(`16px ${RUSH_VIEW.font}`).catch(() => {});

    const layers = buildLayers(plan.weather?.sky ?? 'sunny');
    let state = createRush(plan);
    let fx = createFx();
    const keys: RushInput = { left: false, right: false, space: false };
    let lastNow: number | null = null;
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

      const prev = state;
      if (!isOver(state)) state = step(state, dt, { ...keys });
      fx = updateFx(fx, prev, state, dt);
      ctx.imageSmoothingEnabled = false;
      drawFrame(ctx, state, fx, layers);

      if (isOver(state) && fx.overMs >= RUSH_VIEW.endBannerMs) {
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
    <div className="rush">
      <div className="rush-frame">
        <canvas
          ref={canvasRef}
          className="rush-canvas"
          width={ART_W}
          height={ART_H}
          role="img"
          aria-label="The Rush: serve lemonade to the customers at the stand"
        />
      </div>
      <p className="rush-help">
        ←/→ or A/D move · hold <b>Space</b> at the stand to fill the jug, then again to pour a glass · tap{' '}
        <b>Space</b> at a customer to serve
      </p>
    </div>
  );
}
