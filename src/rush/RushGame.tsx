// Canvas front end for the Rush. All rules live in rushRules.ts; this file only turns keys into
// RushInput, calls step() once per animation frame, and hands the state to the pixel-art renderer
// (pixel/draw.ts). View-only animation (facing, pop-ups, customers walking off) lives in pixel/fx.ts.

import { useEffect, useRef, useState } from 'react';
import type { DayOutcome, DayPlan } from '../contract';
import { PauseMenu } from '../shared/PauseMenu';
import { RUSH_VIEW } from './rushConfig';
import { type RushInput, createRush, endDayEarly, isOver, step, toOutcome } from './rushRules';
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
  /** Pause state lives in React (for the menu) and in a ref (for the game loop). */
  const [paused, setPausedState] = useState(false);
  const pausedRef = useRef(false);
  const endDayRequestedRef = useRef(false);
  const setPaused = (p: boolean) => {
    pausedRef.current = p;
    setPausedState(p);
  };

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

    const releaseKeys = () => {
      keys.left = keys.right = keys.space = false;
    };
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      if (down && (e.code === 'Escape' || e.code === 'KeyP') && !isOver(state)) {
        e.preventDefault();
        releaseKeys();
        pausedRef.current = !pausedRef.current;
        setPausedState(pausedRef.current);
        return;
      }
      const key = KEYS[e.code];
      if (!key) return;
      if (pausedRef.current) return; // the menu's buttons handle Space/Enter while paused
      e.preventDefault(); // Space and arrows would otherwise scroll the page
      keys[key] = down;
    };
    const onKeyDown = onKey(true);
    const onKeyUp = onKey(false);
    // Switching away from the window pauses the game instead of letting customers wait unattended.
    const onBlur = () => {
      releaseKeys();
      if (!isOver(state)) {
        pausedRef.current = true;
        setPausedState(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    let drawErrorLogged = false;
    const frame = (now: number) => {
      if (endDayRequestedRef.current) {
        endDayRequestedRef.current = false;
        state = endDayEarly(state);
      }
      if (pausedRef.current && !isOver(state)) {
        lastNow = null; // don't count paused time when we resume
        rafId = requestAnimationFrame(frame);
        return;
      }
      const dt = lastNow === null ? 0 : Math.min(now - lastNow, RUSH_VIEW.maxFrameMs);
      lastNow = now;

      const prev = state;
      if (!isOver(state)) state = step(state, dt, { ...keys });
      fx = updateFx(fx, prev, state, dt);
      ctx.imageSmoothingEnabled = false;
      // A drawing bug must never freeze the game: log it once and keep the rules running.
      try {
        drawFrame(ctx, state, fx, layers);
      } catch (err) {
        if (!drawErrorLogged) {
          drawErrorLogged = true;
          console.error('[rush] draw error (game continues)', err);
        }
      }

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
      <div className="pz-toolbar">
        <button type="button" className="pz-pause-btn" onClick={() => setPaused(true)} disabled={paused}>
          ⏸ Pause <small>(Esc)</small>
        </button>
      </div>
      <div className="rush-frame" style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          className="rush-canvas"
          width={ART_W}
          height={ART_H}
          role="img"
          aria-label="The Rush: serve lemonade to the customers at the stand"
        />
        {paused && (
          <PauseMenu
            onResume={() => setPaused(false)}
            onEndDay={() => {
              endDayRequestedRef.current = true;
              setPaused(false);
            }}
          />
        )}
      </div>
      <p className="rush-help">
        ←/→ or A/D move · hold <b>Space</b> at the stand to fill the jug, then again to pour a glass · tap{' '}
        <b>Space</b> at a customer to serve
      </p>
    </div>
  );
}
