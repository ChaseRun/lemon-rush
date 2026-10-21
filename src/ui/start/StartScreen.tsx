// Pixel-art title screen. All art is drawn in code: sprites are pixel maps (sprites.ts) turned into
// SVG <rect>s (pixels.ts), and the street scene is laid out in scene.ts. No image files.
import { useEffect, useRef, type CSSProperties, type JSX } from 'react';
import { mapToRects, mapWidth, PALETTE, type PixelMap, type Rect } from './pixels';
import { GROUND, SCENE, SCENE_H, SCENE_W } from './scene';
import { CLOUD_BIG, CLOUD_SMALL, SUN } from './sprites';
import './start.css';

export interface StartScreenProps {
  onStart: () => void;
  onRules: () => void;
}

/** Size variables the CSS multiplies by the current pixel scale (--st-px). */
const sizeVars = (w: number, h: number) => ({ '--st-w': w, '--st-h': h }) as CSSProperties;

/** Plain colour bands behind the scene, so the ground keeps going on screens wider than the art. */
const groundFallback: CSSProperties = {
  background: `linear-gradient(to bottom, transparent 0 calc(var(--st-px) * ${GROUND.lawn}), ${PALETTE.g} 0 calc(var(--st-px) * ${GROUND.sidewalk}), ${PALETTE.Q} 0 calc(var(--st-px) * ${GROUND.curb}), ${PALETTE.r} 0 calc(var(--st-px) * ${GROUND.street}), ${PALETTE.x} 0)`,
};

function Rects({ rects }: { rects: readonly Rect[] }) {
  return (
    <>
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />
      ))}
    </>
  );
}

/** A decorative sky sprite (sun, clouds), drawn at twice the scene's pixel size. */
function SkySprite({ map, className }: { map: PixelMap; className: string }) {
  const w = mapWidth(map);
  const h = map.length;
  return (
    <svg
      className={`st-sprite ${className}`}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      style={sizeVars(w, h)}
      aria-hidden="true"
      focusable="false"
    >
      <Rects rects={mapToRects(map)} />
    </svg>
  );
}

/** Enter starts the summer, unless focus is on something that handles Enter itself (a button, a field, a dialog). */
function useEnterToStart(onStart: () => void) {
  const startRef = useRef(onStart);
  useEffect(() => {
    startRef.current = onStart;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || e.defaultPrevented || e.isComposing) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target;
      if (t instanceof Element && t.closest('button, a[href], input, textarea, select, [contenteditable], dialog, [role="dialog"]')) return;
      e.preventDefault();
      startRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function StartScreen({ onStart, onRules }: StartScreenProps): JSX.Element {
  useEnterToStart(onStart);

  return (
    <section className="st" aria-labelledby="st-title">
      <SkySprite map={SUN} className="st-sun" />
      <SkySprite map={CLOUD_BIG} className="st-cloud st-cloud-1" />
      <SkySprite map={CLOUD_SMALL} className="st-cloud st-cloud-2" />
      <SkySprite map={CLOUD_SMALL} className="st-cloud st-cloud-3" />

      <header className="st-hero">
        <h1 id="st-title" className="st-title">
          <span className="st-title-line st-title-lemon">Lemon</span>{' '}
          <span className="st-title-line st-title-rush">Rush</span>
        </h1>
        <p className="st-sub">30 days of summer. $20. One lemonade stand.</p>
        <div className="st-actions">
          <button type="button" className="st-btn st-btn-primary" onClick={onStart}>
            Start summer
          </button>
          <button type="button" className="st-btn st-btn-secondary" onClick={onRules}>
            How to play
          </button>
        </div>
        <p className="st-hint">
          or press <kbd>Enter</kbd>
        </p>
      </header>

      <div className="st-street" style={groundFallback}>
        <svg
          className="st-scene"
          viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}
          shapeRendering="crispEdges"
          style={sizeVars(SCENE_W, SCENE_H)}
          role="img"
          aria-label="A kid waves from behind a little wooden lemonade stand on a sunny sidewalk while a grandma walks up for a glass."
          focusable="false"
        >
          {SCENE.map((layer, i) => (
            <g key={i} className={layer.className}>
              <Rects rects={layer.rects} />
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}
