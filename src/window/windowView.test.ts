import { describe, expect, it } from 'vitest';
import { fixturePlan } from '../fixtures';
import { CUSTOMER_SPRITES, PALETTE } from './sprites';
import { createWindowRush, step } from './windowRules';
import { LAYOUT, actionAt, clockLabel, isHoldZone, nextHint } from './windowView';

describe('clock', () => {
  it('runs 9:00am → 5:00pm over the day', () => {
    expect(clockLabel(0, 120_000)).toBe('9:00am');
    expect(clockLabel(45_000, 120_000)).toBe('12:00pm');
    expect(clockLabel(120_000, 120_000)).toBe('5:00pm');
  });
});

describe('hit-testing', () => {
  const center = (r: { x: number; y: number; w: number; h: number }) => [r.x + r.w / 2, r.y + r.h / 2] as const;
  it('counter items map to actions; jug and glass are hold zones', () => {
    expect(actionAt(...center(LAYOUT.crate))).toEqual({ type: 'lemons' });
    expect(actionAt(...center(LAYOUT.sugar))).toEqual({ type: 'sugar' });
    expect(actionAt(...center(LAYOUT.cooler))).toEqual({ type: 'ice' });
    expect(actionAt(...center(LAYOUT.cups))).toEqual({ type: 'cup' });
    expect(actionAt(...center(LAYOUT.atWindow))).toEqual({ type: 'handOver', window: 0 });
    expect(actionAt(...center(LAYOUT.jug))).toBeNull();
    expect(isHoldZone(...center(LAYOUT.jug))).toBe(true);
    expect(isHoldZone(...center(LAYOUT.glass))).toBe(true);
  });
});

describe('next-step hint', () => {
  it('walks the player through a jug and a glass', () => {
    let s = createWindowRush(fixturePlan);
    expect(nextHint(s).target).toBe('crate');
    s = step(s, 0, { space: false, actions: [{ type: 'lemons' }] });
    expect(nextHint(s)).toMatchObject({ target: 'jug', urgent: true });
    s = step(s, 0, { space: false, actions: [{ type: 'cup' }] });
    expect(nextHint(s).target).toBe('jug'); // the jug mini-game comes first
  });
});

describe('sprites', () => {
  it('every row is the same width and every pixel has a color', () => {
    for (const sp of Object.values(CUSTOMER_SPRITES)) {
      for (const row of sp.rows) {
        expect(row).toHaveLength(sp.w);
        for (const ch of row) if (ch !== '.') expect(PALETTE[ch]).toBeDefined();
      }
    }
  });
});
