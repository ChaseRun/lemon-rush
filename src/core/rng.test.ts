import { describe, expect, it } from 'vitest';
import { createRng, hashString, rngFor } from './rng';

const draw = (rng: { next(): number }, n: number) => Array.from({ length: n }, () => rng.next());

describe('rng', () => {
  it('is deterministic for the same seed', () => {
    expect(draw(createRng(123), 20)).toEqual(draw(createRng(123), 20));
  });

  it('differs across seeds', () => {
    expect(draw(createRng(1), 5)).not.toEqual(draw(createRng(2), 5));
  });

  it('gives an independent stream per (seed, day, purpose)', () => {
    const a = draw(rngFor(7, 3, 'demand'), 10);
    expect(draw(rngFor(7, 3, 'demand'), 10)).toEqual(a);
    expect(draw(rngFor(7, 3, 'sky'), 10)).not.toEqual(a);
    expect(draw(rngFor(7, 4, 'demand'), 10)).not.toEqual(a);
    expect(draw(rngFor(8, 3, 'demand'), 10)).not.toEqual(a);
  });

  it('drawing from one stream does not shift another', () => {
    const before = rngFor(9, 1, 'temp').next();
    draw(rngFor(9, 1, 'sky'), 1000);
    expect(rngFor(9, 1, 'temp').next()).toBe(before);
  });

  it('keeps float and int within range', () => {
    const rng = createRng(5);
    for (let i = 0; i < 5000; i++) {
      const f = rng.float(0.8, 1.2);
      expect(f).toBeGreaterThanOrEqual(0.8);
      expect(f).toBeLessThan(1.2);
      const n = rng.int(-2, 2);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(-2);
      expect(n).toBeLessThanOrEqual(2);
    }
  });

  it('int covers both ends of the range', () => {
    const rng = createRng(11);
    const seen = new Set(Array.from({ length: 500 }, () => rng.int(-2, 2)));
    expect([...seen].sort()).toEqual([-1, -2, 0, 1, 2].sort());
  });

  it('pickWeighted follows the weights and never picks zero-weight items', () => {
    const rng = createRng(99);
    const counts = { a: 0, b: 0, never: 0 };
    const items = ['a', 'b', 'never'] as const;
    const weights = { a: 3, b: 1, never: 0 };
    const n = 20_000;
    for (let i = 0; i < n; i++) counts[rng.pickWeighted(items, (k) => weights[k])]++;
    expect(counts.never).toBe(0);
    expect(counts.a / n).toBeCloseTo(0.75, 1);
  });

  it('hashString spreads similar keys apart', () => {
    expect(hashString('1|1|demand')).not.toBe(hashString('1|2|demand'));
    expect(hashString('x')).toBe(hashString('x'));
  });
});
