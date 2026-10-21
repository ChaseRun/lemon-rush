import { describe, expect, it } from 'vitest';
import type { Bar, ServedRecord } from '../contract';
import { serviceRating, updatePopularity } from './popularity';

const servedOn = (...bars: Bar[]): ServedRecord[] =>
  bars.map((bar, i) => ({ arrivalId: i, type: 'jogger', paid: 2, tip: 0, bar, atMs: i }));

const rated = (o: Partial<Parameters<typeof serviceRating>[0]>) =>
  serviceRating({ served: [], walkouts: 0, noRoom: 0, soldOutMisses: 0, ...o });

describe('serviceRating', () => {
  it('is 0.5 when nobody stopped', () => {
    expect(rated({})).toBe(0.5);
  });

  it('weights each outcome: green 1, yellow 0.7, red 0.4, no room 0.3, sold out 0.2, walkout 0', () => {
    expect(rated({ served: servedOn('green') })).toBe(1);
    expect(rated({ served: servedOn('yellow') })).toBe(0.7);
    expect(rated({ served: servedOn('red') })).toBe(0.4);
    expect(rated({ noRoom: 1 })).toBe(0.3);
    expect(rated({ soldOutMisses: 1 })).toBe(0.2);
    expect(rated({ walkouts: 1 })).toBe(0);
  });

  it('averages over everyone who stopped', () => {
    expect(rated({ served: servedOn('green', 'green', 'red'), walkouts: 1 })).toBeCloseTo((1 + 1 + 0.4 + 0) / 4);
  });
});

describe('updatePopularity', () => {
  it('a perfect day raises it, a terrible day lowers it, an average day barely moves it', () => {
    expect(updatePopularity(20, 1)).toBeCloseTo(27.28, 1); // 20 + 7.5 = 27.5, then 3% drift back toward 20
    expect(updatePopularity(20, 0)).toBeCloseTo(12.73, 1); // 20 - 7.5 = 12.5, then 3% drift back toward 20
    expect(updatePopularity(20, 0.5)).toBe(20);
  });

  it('matches the design-doc example: a good first day (rating 0.9) takes 20 to ~26', () => {
    expect(updatePopularity(20, 0.9)).toBeCloseTo(25.82, 2); // 20 + 0.4 × 15 = 26, then 3% of the way back to 20
  });

  it('drifts back toward 20 on an average day', () => {
    expect(updatePopularity(60, 0.5)).toBe(58.8);
    expect(updatePopularity(0, 0.5)).toBe(0.6);
  });

  it('stays between 0 and 100', () => {
    expect(updatePopularity(0, 0)).toBe(0);
    expect(updatePopularity(100, 1)).toBe(100);
    let p = 20;
    for (let i = 0; i < 200; i++) {
      p = updatePopularity(p, i % 7 === 0 ? 0 : 1);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });
});
