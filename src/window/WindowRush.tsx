// The window-style Rush: first-person behind a service window, with Cooking Mama-style mini-games.
// All rules live in windowRules.ts. This component only turns keys / mouse into WindowInput, calls step()
// once per animation frame, and hands the state to the canvas renderer (draw.ts) plus view fx (fx.ts).

import { useEffect, useRef, useState } from 'react';
import type { DayOutcome, DayPlan } from '../contract';
import { PauseMenu } from '../shared/PauseMenu';
import { drawFrame } from './draw';
import { createFx, updateFx } from './fx';
import { WINDOW_VIEW } from './windowConfig';
import { type WindowAction, createWindowRush, endDayEarly, isOver, step, toOutcome } from './windowRules';
import { type HintTarget, LAYOUT, actionAt, inRect, isHoldZone } from './windowView';

export interface WindowRushProps {
  plan: DayPlan;
  /** Called exactly once per plan, after the SOLD OUT / CLOSED sign has shown (also after "End the day now"). */
  onFinish: (outcome: DayOutcome) => void;
}

const KEY_ACTIONS: Record<string, WindowAction> = {
  Digit1: { type: 'lemons' },
  Numpad1: { type: 'lemons' },
  Digit2: { type: 'sugar' },
  Numpad2: { type: 'sugar' },
  Digit3: { type: 'ice' },
  Numpad3: { type: 'ice' },
  Digit4: { type: 'cup' },
  Numpad4: { type: 'cup' },
  Enter: { type: 'handOver', window: 0 },
  NumpadEnter: { type: 'handOver', window: 0 },
  ArrowLeft: { type: 'stir', dir: 'left' },
  KeyA: { type: 'stir', dir: 'left' },
  ArrowRight: { type: 'stir', dir: 'right' },
  KeyD: { type: 'stir', dir: 'right' },
};

function hoverTarget(x: number, y: number): HintTarget {
  if (inRect(LAYOUT.crate, x, y)) return 'crate';
  if (inRect(LAYOUT.sugar, x, y)) return 'sugar';
  if (inRect(LAYOUT.cooler, x, y)) return 'cooler';
  if (inRect(LAYOUT.cups, x, y)) return 'cups';
  if (inRect(LAYOUT.jug, x, y)) return 'jug';
  if (inRect(LAYOUT.glass, x, y)) return 'glass';
  if (inRect(LAYOUT.atWindow, x, y)) return 'window';
  return null;
}

export function WindowRush({ plan, onFinish }: WindowRushProps) {
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

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = WINDOW_VIEW.width * dpr;
    canvas.height = WINDOW_VIEW.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    document.fonts?.load(`800 16px 'Baloo 2'`).catch(() => {});

    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let state = createWindowRush(plan);
    const fx = createFx();
    let spaceKey = false;
    let mouseHold = false;
    let pressedThisFrame = false;
    let pending: WindowAction[] = [];
    let hover: HintTarget = null;
    let stirAnchorX: number | null = null;
    let lastNow: number | null = null;
    let rafId = 0;
    let drawErrorLogged = false;

    const releaseInput = () => {
      spaceKey = false;
      mouseHold = false;
      pressedThisFrame = false;
      pending = [];
      stirAnchorX = null;
    };
    const togglePause = (p: boolean) => {
      releaseInput();
      pausedRef.current = p;
      setPausedState(p);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.code === 'Escape' || e.code === 'KeyP') && !isOver(state)) {
        e.preventDefault();
        if (!e.repeat) togglePause(!pausedRef.current);
        return;
      }
      if (pausedRef.current) return; // the menu's buttons handle Space/Enter while paused
      if (e.code === 'Space') {
        e.preventDefault();
        if (!spaceKey) pressedThisFrame = true;
        spaceKey = true;
        return;
      }
      const a = KEY_ACTIONS[e.code];
      if (!a) return;
      e.preventDefault();
      if (!e.repeat) pending.push(a);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        if (!pausedRef.current) e.preventDefault();
        spaceKey = false;
      }
    };
    // Switching away from the window pauses the game instead of letting customers wait unattended.
    const onBlur = () => {
      releaseInput();
      if (!isOver(state)) togglePause(true);
    };

    const toCanvas = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) * WINDOW_VIEW.width) / r.width, y: ((e.clientY - r.top) * WINDOW_VIEW.height) / r.height };
    };
    const onPointerDown = (e: PointerEvent) => {
      if (pausedRef.current || isOver(state)) return;
      const { x, y } = toCanvas(e);
      canvas.focus();
      const a = actionAt(x, y);
      if (a) {
        pending.push(a);
        return;
      }
      if (isHoldZone(x, y)) {
        e.preventDefault();
        canvas.setPointerCapture?.(e.pointerId);
        mouseHold = true;
        pressedThisFrame = true;
      }
    };
    const onPointerUp = () => {
      mouseHold = false;
    };
    const onPointerMove = (e: PointerEvent) => {
      const { x, y } = toCanvas(e);
      hover = hoverTarget(x, y);
      // Stir by swinging the mouse left and right.
      if (pausedRef.current || state.jug.making?.kind !== 'stir') {
        stirAnchorX = null;
        return;
      }
      if (stirAnchorX === null) stirAnchorX = x;
      if (x - stirAnchorX >= WINDOW_VIEW.stirMousePx) {
        pending.push({ type: 'stir', dir: 'right' });
        stirAnchorX = x;
      } else if (stirAnchorX - x >= WINDOW_VIEW.stirMousePx) {
        pending.push({ type: 'stir', dir: 'left' });
        stirAnchorX = x;
      }
    };
    const onPointerLeave = () => {
      hover = null;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);

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
      const dt = lastNow === null ? 0 : Math.max(0, Math.min(now - lastNow, WINDOW_VIEW.maxFrameMs));
      lastNow = now;
      const prev = state;
      if (!isOver(state)) {
        // A tap that went down and up between frames still counts as a press.
        const space = spaceKey || mouseHold || pressedThisFrame;
        state = step(state, dt, { space, actions: pending });
        pending = [];
        pressedThisFrame = false;
      }
      const reduced = !!motionQuery?.matches;
      // A drawing bug must never freeze the game: log it once and keep the rules running.
      try {
        updateFx(fx, prev, state, dt, reduced);
        drawFrame(ctx, state, fx, { reducedMotion: reduced, hover });
      } catch (err) {
        if (!drawErrorLogged) {
          drawErrorLogged = true;
          console.error('[window rush] draw error (game continues)', err);
        }
        if (isOver(state)) fx.overMs += dt; // keep the end-of-day clock moving even if fx broke
      }
      if (isOver(state) && fx.overMs >= WINDOW_VIEW.endBannerMs) {
        if (finishedPlanRef.current !== plan) {
          finishedPlanRef.current = plan;
          onFinishRef.current(toOutcome(state));
        }
        return; // stop the loop
      }
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);
    canvas.focus();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [plan]);

  return (
    <div style={{ maxWidth: WINDOW_VIEW.width, margin: '0 auto' }}>
      <div className="pz-toolbar">
        <button type="button" className="pz-pause-btn" onClick={() => setPaused(true)} disabled={paused}>
          ⏸ Pause <small>(Esc)</small>
        </button>
      </div>
      <div style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="img"
          aria-label="Lemonade stand service window. Make jugs and serve customers with the keyboard or mouse."
          style={{
            display: 'block',
            width: '100%',
            aspectRatio: `${WINDOW_VIEW.width} / ${WINDOW_VIEW.height}`,
            borderRadius: 12,
            background: '#d99a5b',
            touchAction: 'none',
            outline: 'none',
            boxShadow: '0 6px 0 #7a4a22',
          }}
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
      <p style={{ margin: '12px 4px 0', fontSize: 14, color: '#52627e', lineHeight: 1.6 }}>
        <b>Make a jug:</b> <Kbd>1</Kbd> lemons → tap <Kbd>Space</Kbd> to squeeze → <Kbd>2</Kbd> sugar → hold{' '}
        <Kbd>Space</Kbd>, let go in the green → stir <Kbd>←</Kbd> <Kbd>→</Kbd>. <b>Each glass:</b> <Kbd>4</Kbd> cup →{' '}
        <Kbd>3</Kbd> ice → hold <Kbd>Space</Kbd> to pour, let go between the lines → <Kbd>Enter</Kbd> hand over. Or click
        the counter; press on the jug or glass to hold, swing the mouse to stir. <Kbd>Esc</Kbd> pauses.
      </p>
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd
      style={{
        display: 'inline-block',
        padding: '0 6px',
        border: '1px solid #cfe3f2',
        borderBottomWidth: 3,
        borderRadius: 5,
        background: '#fff',
        color: '#1b2b48',
        fontSize: 13,
        fontFamily: 'inherit',
      }}
    >
      {children}
    </kbd>
  );
}
