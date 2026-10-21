// Lays out the sidewalk scene as ordered layers of rects on a 512×84 pixel grid.
// The scene is wider than most screens on purpose: it's centred and cropped, so the stand is always
// in the middle and wide screens just see more street. Pure data, no React, so it's easy to test.
import { block, flipX, mapToRects, mapWidth, outlinedBlock, PALETTE, type PaletteKey, type PixelMap, type Rect } from './pixels';
import {
  BUSH,
  CANOPY,
  GLASS,
  GLYPHS,
  GRANDMA,
  HYDRANT,
  KID_WAVE_A,
  KID_WAVE_B,
  LEMON_BIG,
  LEMON_SMALL,
  PITCHER,
  wordWidth,
} from './sprites';

export const SCENE_W = 512;
export const SCENE_H = 84;
/** Centre column; the stand is built around it. */
const CX = SCENE_W / 2;

/** Ground bands (top row of each). Shared with the CSS fallback that extends the ground on very wide screens. */
export const GROUND = { lawn: 52, sidewalk: 62, curb: 75, street: 77 } as const;

export interface SceneLayer {
  /** Optional class for the layer's <g>, used by the animation (kid frames). */
  className?: string;
  rects: Rect[];
}

const sprite = (map: PixelMap, x: number, y: number) => mapToRects(map, x, y);

function ground(): Rect[] {
  const r: Rect[] = [];
  // Lawn behind the fence, with a lighter horizon and a shadow line where it meets the sidewalk.
  r.push(block(0, GROUND.lawn, SCENE_W, GROUND.sidewalk - GROUND.lawn, 'g'));
  r.push(block(0, GROUND.lawn, SCENE_W, 1, 'l'));
  r.push(block(0, GROUND.sidewalk - 1, SCENE_W, 1, 'G'));
  // Sidewalk slabs.
  r.push(block(0, GROUND.sidewalk, SCENE_W, GROUND.curb - GROUND.sidewalk, 'Q'));
  r.push(block(0, GROUND.sidewalk, SCENE_W, 1, 'q'));
  r.push(block(0, GROUND.curb - 1, SCENE_W, 1, 'u'));
  for (let x = 12; x < SCENE_W; x += 28) r.push(block(x, GROUND.sidewalk + 1, 1, GROUND.curb - GROUND.sidewalk - 2, 'u'));
  // Curb and street with a dashed lemon line.
  r.push(block(0, GROUND.curb, SCENE_W, GROUND.street - GROUND.curb, 'r'));
  r.push(block(0, GROUND.street, SCENE_W, SCENE_H - GROUND.street, 'x'));
  for (let x = 6; x < SCENE_W; x += 24) r.push(block(x, SCENE_H - 3, 10, 1, 'y'));
  return r;
}

function tree(x: number): Rect[] {
  const trunkX = x + Math.floor(mapWidth(CANOPY) / 2) - 4;
  return [
    ...outlinedBlock(trunkX, 22, 8, 36, 'B'),
    block(trunkX + 2, 23, 1, 34, 'b'),
    block(trunkX + 5, 23, 2, 34, 'd'),
    ...sprite(CANOPY, x, 1),
  ];
}

/** White picket fence across the whole lawn, outlined softly so it sits behind the stand. */
function fence(): Rect[] {
  const top = 38;
  const bottom = 58;
  const r: Rect[] = [];
  for (const railY of [43, 52]) {
    r.push(block(0, railY, SCENE_W, 3, 'n'), block(0, railY + 1, SCENE_W, 1, 'w'));
  }
  for (let x = 1; x < SCENE_W; x += 6) {
    r.push(block(x + 1, top, 2, 1, 'n'));
    r.push(block(x, top + 1, 4, bottom - top - 1, 'n'));
    r.push(block(x + 1, top + 1, 1, bottom - top - 2, 'w'));
    r.push(block(x + 2, top + 1, 1, bottom - top - 2, 'c'));
  }
  return r;
}

/** Little flowers poking up along the bottom of the fence. */
function flowers(): Rect[] {
  const colours: PaletteKey[] = ['m', 'y', 'w', 'v'];
  const r: Rect[] = [];
  for (let i = 0, x = 5; x < SCENE_W; i++, x += 9 + ((i * 5) % 7)) {
    // Keep the lawn under the stand and the bushes tidy.
    if (Math.abs(x - CX) < 34) continue;
    r.push(block(x, 59, 1, 2, 'G'), block(x, 58, 1, 1, colours[i % colours.length]));
  }
  return r;
}

/** "LEMONADE" painted by hand: letters bob up and down a pixel, and the M has a paint drip. */
function signText(x0: number, y0: number): Rect[] {
  const wobble = [0, 1, 0, -1, 0, 1, 0, -1];
  const r: Rect[] = [];
  let x = x0;
  [...'LEMONADE'].forEach((ch, i) => {
    const glyph = GLYPHS[ch];
    const y = y0 + wobble[i];
    for (const rect of mapToRects(glyph, x, y)) r.push({ ...rect, fill: PALETTE.m });
    if (ch === 'M') r.push(block(x, y + 5, 1, 2, 'm'));
    x += mapWidth(glyph) + 1;
  });
  return r;
}

function stand(): { back: Rect[]; front: Rect[] } {
  const back = [
    // Shade on the sidewalk under the stand.
    block(CX - 27, 72, 56, 2, 'u'),
    // Posts holding up the sign.
    ...outlinedBlock(CX - 25, 20, 3, 34, 'B'),
    ...outlinedBlock(CX + 22, 20, 3, 34, 'B'),
  ];

  const textW = wordWidth('LEMONADE');
  const front = [
    // Counter top.
    block(CX - 28, 54, 56, 4, 'k'),
    block(CX - 27, 55, 54, 1, 'b'),
    block(CX - 27, 56, 54, 1, 'B'),
    // Front panel: planks with a painted lemon.
    ...outlinedBlock(CX - 24, 58, 48, 12, 'b'),
    block(CX - 23, 61, 46, 1, 'B'),
    block(CX - 23, 65, 46, 1, 'B'),
    block(CX + 22, 59, 1, 10, 'B'),
    ...sprite(LEMON_BIG, CX - 8, 59),
    // Legs.
    ...outlinedBlock(CX - 22, 69, 4, 5, 'B'),
    ...outlinedBlock(CX + 18, 69, 4, 5, 'B'),
    // On the counter: a jug and two poured glasses.
    ...sprite(PITCHER, CX - 21, 44),
    ...sprite(GLASS, CX + 11, 47),
    ...sprite(GLASS, CX + 17, 47),
    // The hand-painted sign.
    ...outlinedBlock(CX - 32, 10, 64, 15, 'w'),
    block(CX - 31, 23, 62, 1, 'c'),
    ...sprite(LEMON_SMALL, CX - 29, 14),
    ...sprite(flipX(LEMON_SMALL), CX + 21, 14),
    ...signText(CX - Math.floor(textW / 2), 14),
  ];
  return { back, front };
}

/** Trims a rect to the scene bounds (repeating details like pickets run off the edge); null if nothing is left. */
function clip(r: Rect): Rect | null {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(SCENE_W, r.x + r.w);
  const y1 = Math.min(SCENE_H, r.y + r.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0, fill: r.fill } : null;
}

/** The whole scene, back to front. */
export function buildScene(): SceneLayer[] {
  const { back, front } = stand();
  const layers: SceneLayer[] = [
    { rects: ground() },
    { rects: [...tree(CX - 236), ...tree(CX - 86), ...tree(CX + 142)] },
    { rects: fence() },
    { rects: [...sprite(BUSH, CX - 150, 49), ...sprite(BUSH, CX + 106, 49), ...flowers()] },
    { rects: back },
    { className: 'st-kid st-kid-a', rects: sprite(KID_WAVE_A, CX - 8, 38) },
    { className: 'st-kid st-kid-b', rects: sprite(KID_WAVE_B, CX - 8, 38) },
    { rects: front },
    {
      rects: [
        block(CX + 47, 73, 11, 1, 'u'),
        ...sprite(GRANDMA, CX + 46, 51),
        block(CX + 92, 73, 7, 1, 'u'),
        ...sprite(HYDRANT, CX + 92, 64),
      ],
    },
  ];
  return layers.map((layer) => ({ ...layer, rects: layer.rects.map(clip).filter((r): r is Rect => r !== null) }));
}

export const SCENE: readonly SceneLayer[] = buildScene();
