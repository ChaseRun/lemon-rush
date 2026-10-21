// Tiny pixel-art toolkit for the title screen.
// A sprite is an array of equal-width strings; each character is a palette key ('.' = transparent).
// Sprites become SVG <rect>s (one per horizontal run of a colour), drawn on an integer grid with crisp edges.

export type PixelMap = readonly string[];

export const TRANSPARENT = '.';

/** Every colour used on the title screen. Keys are single characters so maps stay readable. */
export const PALETTE = {
  k: '#1b2b48', // ink (outlines)
  w: '#ffffff', // paper
  y: '#ffd43b', // lemon
  Y: '#f2b705', // lemon-deep
  o: '#ff9f1c', // sun rays
  g: '#2f9e44', // leaf
  G: '#23803a', // leaf shade
  l: '#69c97a', // leaf light
  j: '#17552b', // leaf outline (background greenery)
  m: '#e8445f', // melon
  M: '#b8304a', // melon shade
  s: '#8fd3ff', // sky
  S: '#3f9fe0', // deep sky
  c: '#dcefff', // cloud shade
  b: '#d08c4f', // wood light
  B: '#a5652f', // wood
  d: '#6e3f1f', // wood dark
  f: '#f7c59f', // skin
  p: '#ff8fab', // cheeks
  h: '#6b3b22', // brown hair
  H: '#cfd3dc', // grey hair
  v: '#b197fc', // grandma purple
  V: '#8a6ee0', // purple shade
  n: '#9fb3c8', // fence outline (background, so softer than ink)
  q: '#f3eee2', // concrete light
  Q: '#e0d8c6', // concrete
  u: '#c2b8a2', // concrete joint
  r: '#a8a08d', // curb
  x: '#4b5263', // asphalt
} as const;

export type PaletteKey = keyof typeof PALETTE;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

export function isPaletteKey(ch: string): ch is PaletteKey {
  return Object.prototype.hasOwnProperty.call(PALETTE, ch);
}

/** Width of a map (all rows must match; see the tests). */
export function mapWidth(map: PixelMap): number {
  return map.length === 0 ? 0 : map[0].length;
}

/**
 * Turns a pixel map into rects, merging horizontal runs of the same colour.
 * Unknown characters are treated as transparent (the tests make sure there are none).
 */
export function mapToRects(map: PixelMap, ox = 0, oy = 0): Rect[] {
  const rects: Rect[] = [];
  map.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      if (isPaletteKey(ch)) rects.push({ x: ox + x, y: oy + y, w: end - x, h: 1, fill: PALETTE[ch] });
      x = end;
    }
  });
  return rects;
}

/** Mirrors a map left-to-right (for sprites that face the other way). */
export function flipX(map: PixelMap): string[] {
  return map.map((row) => [...row].reverse().join(''));
}

/** A solid block in palette colour `key`. */
export function block(x: number, y: number, w: number, h: number, key: PaletteKey): Rect {
  return { x, y, w, h, fill: PALETTE[key] };
}

/** A block with a 1px ink outline. */
export function outlinedBlock(x: number, y: number, w: number, h: number, key: PaletteKey): Rect[] {
  return [block(x, y, w, h, 'k'), block(x + 1, y + 1, w - 2, h - 2, key)];
}
