// Hand-drawn sprites for the title screen. Keys come from PALETTE in pixels.ts ('.' = transparent).
import type { PixelMap } from './pixels';

/** The kid behind the stand, frame A: waving hand upright. 19×18; rows 16–17 hide behind the counter. */
export const KID_WAVE_A: PixelMap = [
  '....kkkkkk.........',
  '...kyyyyyyk........',
  '..kyywwyyyyk..kkk..',
  '..kYYYYYYYYk.kfffk.',
  '..khffffffhk.kfffk.',
  '..kfkffffkfk.kfffk.',
  '..kpffffffpk..kfk..',
  '..kffkffkffk..kfk..',
  '..kfffkkfffk..kfk..',
  '...kffffffk..kmmk..',
  '..kmmkffkmmmmmmk...',
  '.kmmmmmmmmmmmmk....',
  'kmkmmmmmmmmk.......',
  'kfkmmmyymmmk.......',
  'kfkmmmyymmmk.......',
  'kkkmmmmmmmmk.......',
  '..kmmmmmmmmk.......',
  '..kmmmmmmmmk.......',
];

/** Frame B: the hand tips outward. Only rows 2–5 differ from frame A. */
export const KID_WAVE_B: PixelMap = [
  ...KID_WAVE_A.slice(0, 2),
  '..kyywwyyyyk...kkk.',
  '..kYYYYYYYYk..kfffk',
  '..khffffffhk..kfffk',
  '..kfkffffkfk..kffk.',
  ...KID_WAVE_A.slice(6),
];

/** A grandma walking up to buy a glass, facing left. 13×23. */
export const GRANDMA: PixelMap = [
  '.........kk..',
  '....kkkkkHHk.',
  '...kHHHHHHHk.',
  '..kHHHHHHHk..',
  '..kffffHHHk..',
  '..kwkfffHHk..',
  '.kffffffHHk..',
  '..kpffffHk...',
  '..kkfffffk...',
  '...kkfffk....',
  '...kvvvvvk...',
  '..kvvvvvvvk..',
  '..kvvvVvvvk..',
  '..kvvvVvvvk..',
  '..kvvvVvvvk..',
  '..kvvvfvvvk..',
  '.kvvvvvvvvVk.',
  '.kvvvvvvvvVk.',
  'kvvvvvvvvVVVk',
  'kkkkkkkkkkkkk',
  '...kfk.kfk...',
  '..kfk...kfk..',
  '.kkkk...kkkk.',
];

/** A glass jug of lemonade with ice. 11×10. */
export const PITCHER: PixelMap = [
  'kkkkkkkkk..',
  '.kwccccck..',
  '.kyyyyyykkk',
  '.kwyywyyk.k',
  '.kwyyyyYk.k',
  '.kyyywyYk.k',
  '.kyyyyyYkkk',
  '.kyyyyyYk..',
  '.kYyyyYYk..',
  '.kkkkkkkk..',
];

/** A poured glass with a striped straw. 5×7. */
export const GLASS: PixelMap = [
  '....m',
  '...m.',
  'kkmkk',
  'kwyyk',
  'kyyyk',
  'kyyYk',
  'kkkkk',
];

/** Small lemon for the sign. 8×5. */
export const LEMON_SMALL: PixelMap = [
  '..kkkk..',
  '.kywyyk.',
  'kyyyyyYk',
  '.kyyyYk.',
  '..kkkk..',
];

/** Big painted lemon for the front of the stand. 15×9. */
export const LEMON_BIG: PixelMap = [
  '.....kkkkk.....',
  '...kkyyyyykk...',
  '..kyywwyyyyyk..',
  '.kyywyyyyyyyYk.',
  'kkyyyyyyyyyyYkk',
  '.kyyyyyyyyyYYk.',
  '..kyyyyyyyYYk..',
  '...kkYYYYYkk...',
  '.....kkkkk.....',
];

/** The sun, wearing sunglasses. 22×22. */
export const SUN: PixelMap = [
  '..........oo..........',
  '..........oo..........',
  '...oo............oo...',
  '....oo..........oo....',
  '.......kkkkkkkk.......',
  '.....kkyyyyyyyykk.....',
  '....kyyyyyyyyyyyyk....',
  '....kyywwyyyyyyyyk....',
  '...kyywyyyyyyyyyyyk...',
  '...kykkkkkkkkkkkkyk...',
  'oo.kykSkkkyykSkkkyk.oo',
  'oo.kyykkkyyyykkkyyk.oo',
  '...kyyyyyyyyyyyyyyk...',
  '...kyyyykyyyykyyyYk...',
  '....kyyyykkkkyyyYk....',
  '....kYyyyyyyyyyYYk....',
  '.....kkYYYYYYYYkk.....',
  '.......kkkkkkkk.......',
  '....oo..........oo....',
  '...oo............oo...',
  '..........oo..........',
  '..........oo..........',
];

export const CLOUD_BIG: PixelMap = [
  '........wwww........',
  '...www.wwwwww.......',
  '..wwwwwwwwwwwww.ww..',
  '.wwwwwwwwwwwwwwwwww.',
  'wwwwwwwwwwwwwwwwwwww',
  'wwwwwwwwwwwwwwwwwwww',
  '.wwwwwwwwwwwwwwwwww.',
  '..cccccccccccccccc..',
];

export const CLOUD_SMALL: PixelMap = [
  '....wwww....',
  '.www.wwwww..',
  'wwwwwwwwwww.',
  'wwwwwwwwwwww',
  '.cccccccccc.',
];

/** A red fire hydrant. 7×10. */
export const HYDRANT: PixelMap = [
  '..kkk..',
  '.kmwmk.',
  'kkkkkkk',
  '.kmmMk.',
  'kkmmMkk',
  'kmmmmMk',
  'kkmmMkk',
  '.kmmMk.',
  '.kmmMk.',
  'kkkkkkk',
];

/** Hand-painted letters, 5 rows tall, variable width ('k' = paint). */
export const GLYPHS: Record<string, PixelMap> = {
  L: ['k..', 'k..', 'k..', 'k..', 'kkk'],
  E: ['kkk', 'k..', 'kk.', 'k..', 'kkk'],
  M: ['k...k', 'kk.kk', 'k.k.k', 'k...k', 'k...k'],
  O: ['.kk.', 'k..k', 'k..k', 'k..k', '.kk.'],
  N: ['k..k', 'kk.k', 'k.kk', 'k..k', 'k..k'],
  A: ['.kk.', 'k..k', 'kkkk', 'k..k', 'k..k'],
  D: ['kkk.', 'k..k', 'k..k', 'k..k', 'kkk.'],
};

/** Width of a word set in GLYPHS with 1px letter spacing. */
export function wordWidth(word: string): number {
  return [...word].reduce((sum, ch, i) => sum + GLYPHS[ch][0].length + (i > 0 ? 1 : 0), 0);
}

/**
 * Builds a leafy canopy from overlapping circles: dark-green outline, light top-left, shade bottom-right,
 * plus a sprinkle of highlight leaves. Deterministic, so it's still a plain pixel map.
 */
export function makeCanopy(
  width: number,
  height: number,
  circles: ReadonlyArray<[cx: number, cy: number, r: number]>,
): string[] {
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && circles.some(([cx, cy, r]) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r);
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) {
        row += '.';
        continue;
      }
      if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) {
        row += 'j';
        continue;
      }
      // Light comes from the top-left: shade by position inside the circle this pixel sits deepest in.
      let best = -Infinity;
      let lightness = 0;
      for (const [cx, cy, r] of circles) {
        const dx = (x + 0.5 - cx) / r;
        const dy = (y + 0.5 - cy) / r;
        const depth = 1 - Math.hypot(dx, dy);
        if (depth > best) {
          best = depth;
          lightness = -(dx + dy);
        }
      }
      if (lightness > 0.75) row += 'l';
      else if (lightness < -0.55) row += 'G';
      else if ((x * 7 + y * 13) % 17 === 0) row += lightness > -0.1 ? 'l' : 'G';
      else row += 'g';
    }
    rows.push(row);
  }
  return rows;
}

/** The big street tree's canopy. 38×30. */
export const CANOPY: PixelMap = makeCanopy(38, 30, [
  [19, 11, 10],
  [10, 17, 8.5],
  [28, 17, 8.5],
  [19, 21, 8],
  [12, 8, 6],
  [26, 9, 6.5],
]);

/** A round hedge bush. 20×11. */
export const BUSH: PixelMap = makeCanopy(20, 11, [
  [6, 7, 5],
  [13, 6, 6],
  [10, 8, 4.5],
]);

/** Every sprite, for the tests. */
export const ALL_SPRITES: Record<string, PixelMap> = {
  KID_WAVE_A,
  KID_WAVE_B,
  GRANDMA,
  PITCHER,
  GLASS,
  LEMON_SMALL,
  LEMON_BIG,
  SUN,
  CLOUD_BIG,
  CLOUD_SMALL,
  HYDRANT,
  CANOPY,
  BUSH,
  ...Object.fromEntries(Object.entries(GLYPHS).map(([ch, map]) => [`GLYPH_${ch}`, map])),
};
