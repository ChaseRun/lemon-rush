import { describe, expect, it } from 'vitest';
import {
  ALL_SPRITES,
  BUBBLE,
  CUSTOMER_SPRITES,
  GLASS,
  KID_IDLE,
  KID_RUN_A,
  KID_RUN_B,
  PALETTE,
  TRANSPARENT,
} from './sprites';

describe('pixel sprites', () => {
  const entries = Object.entries(ALL_SPRITES);

  it('has sprites to check', () => {
    expect(entries.length).toBeGreaterThan(20);
  });

  it.each(entries)('%s: every row has the same width, matching w and h', (_name, s) => {
    expect(s.h).toBe(s.rows.length);
    expect(s.h).toBeGreaterThan(0);
    expect(s.w).toBeGreaterThan(0);
    for (const row of s.rows) expect(row.length).toBe(s.w);
  });

  it.each(entries)('%s: uses only palette keys or transparency', (_name, s) => {
    for (const row of s.rows) {
      for (const ch of row) {
        if (ch !== TRANSPARENT) expect(Object.keys(PALETTE), `unknown pixel '${ch}'`).toContain(ch);
      }
    }
  });

  it.each(entries)('%s: is not blank', (_name, s) => {
    expect(s.rows.some((row) => [...row].some((ch) => ch !== TRANSPARENT))).toBe(true);
  });

  it('palette colors are #rrggbb and never the transparent key', () => {
    expect(Object.keys(PALETTE)).not.toContain(TRANSPARENT);
    for (const [key, color] of Object.entries(PALETTE)) {
      expect(key).toHaveLength(1);
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('kid frames share one size so the run animation does not jitter', () => {
    for (const f of [KID_RUN_A, KID_RUN_B]) {
      expect([f.w, f.h]).toEqual([KID_IDLE.w, KID_IDLE.h]);
    }
  });

  it('has one same-sized sprite per customer type', () => {
    expect(Object.keys(CUSTOMER_SPRITES).sort()).toEqual(['grandma', 'jogger', 'kid', 'worker']);
    for (const s of Object.values(CUSTOMER_SPRITES)) expect([s.w, s.h]).toEqual([16, 20]);
  });

  it('the order bubble fits the glass icon', () => {
    expect(GLASS.w + 5).toBeLessThan(BUBBLE.w);
    expect(GLASS.h + 2).toBeLessThan(BUBBLE.h - 3);
  });
});
