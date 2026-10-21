import { describe, expect, it } from 'vitest';
import { flipX, isPaletteKey, mapToRects, PALETTE, TRANSPARENT } from './pixels';
import { SCENE, SCENE_H, SCENE_W } from './scene';
import { ALL_SPRITES, GLYPHS, KID_WAVE_A, KID_WAVE_B, wordWidth } from './sprites';

describe('pixel maps', () => {
  for (const [name, map] of Object.entries(ALL_SPRITES)) {
    it(`${name} is a non-empty rectangle`, () => {
      expect(map.length).toBeGreaterThan(0);
      const width = map[0].length;
      expect(width).toBeGreaterThan(0);
      map.forEach((row, y) => expect(row.length, `${name} row ${y}: "${row}"`).toBe(width));
    });

    it(`${name} only uses palette keys`, () => {
      const unknown = new Set([...map.join('')].filter((ch) => ch !== TRANSPARENT && !isPaletteKey(ch)));
      expect([...unknown], `${name} uses unknown keys`).toEqual([]);
    });
  }

  it('all glyphs are 5 rows tall', () => {
    for (const [ch, glyph] of Object.entries(GLYPHS)) expect(glyph.length, ch).toBe(5);
  });

  it('the two waving frames are the same size and actually differ', () => {
    expect(KID_WAVE_B.length).toBe(KID_WAVE_A.length);
    expect(KID_WAVE_B[0].length).toBe(KID_WAVE_A[0].length);
    expect(KID_WAVE_B).not.toEqual(KID_WAVE_A);
  });

  it('palette colours are 6-digit hex and keys are single characters', () => {
    for (const [key, hex] of Object.entries(PALETTE)) {
      expect(key).toHaveLength(1);
      expect(key).not.toBe(TRANSPARENT);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('mapToRects', () => {
  it('merges horizontal runs, skips transparency and applies the offset', () => {
    expect(mapToRects(['kk.y', '.yyy'], 10, 20)).toEqual([
      { x: 10, y: 20, w: 2, h: 1, fill: PALETTE.k },
      { x: 13, y: 20, w: 1, h: 1, fill: PALETTE.y },
      { x: 11, y: 21, w: 3, h: 1, fill: PALETTE.y },
    ]);
  });

  it('covers exactly the opaque pixels of every sprite', () => {
    for (const [name, map] of Object.entries(ALL_SPRITES)) {
      const opaque = [...map.join('')].filter((ch) => ch !== TRANSPARENT).length;
      const covered = mapToRects(map).reduce((sum, r) => sum + r.w * r.h, 0);
      expect(covered, name).toBe(opaque);
    }
  });

  it('flipX mirrors each row', () => {
    expect(flipX(['ky.', '.yk'])).toEqual(['.yk', 'ky.']);
  });

  it('wordWidth adds 1px between letters', () => {
    expect(wordWidth('LE')).toBe(3 + 1 + 3);
  });
});

describe('scene', () => {
  const rects = SCENE.flatMap((layer) => layer.rects);

  it('every rect sits on the integer grid inside the scene', () => {
    for (const r of rects) {
      for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isInteger(v)).toBe(true);
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(SCENE_W);
      expect(r.y + r.h).toBeLessThanOrEqual(SCENE_H);
    }
  });

  it('only uses palette colours', () => {
    const colours = new Set<string>(Object.values(PALETTE));
    for (const r of rects) expect(colours.has(r.fill), r.fill).toBe(true);
  });

  it('has both waving frames, and nothing else is animated', () => {
    const animated = SCENE.filter((layer) => layer.className);
    expect(animated.map((l) => l.className)).toEqual(['st-kid st-kid-a', 'st-kid st-kid-b']);
  });

  it('stays small enough to render as SVG', () => {
    expect(rects.length).toBeLessThan(2000);
  });
});
