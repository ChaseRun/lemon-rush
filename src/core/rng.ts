// Seeded randomness. The engine never calls Math.random().
//
// Every random decision draws from its own stream keyed by (seed, day, purpose),
// e.g. rngFor(seed, 7, 'demand'). Adding a roll to one system therefore never
// shifts the numbers another system sees, which keeps seeds and tests stable.

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** Uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Picks one item with probability proportional to weight(item). */
  pickWeighted<T>(items: readonly T[], weight: (item: T) => number): T;
}

/** mulberry32: a tiny, fast, well-distributed 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the string, then a murmur3 finalizer so nearby keys land far apart. */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  const rng: Rng = {
    next,
    float: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pickWeighted(items, weight) {
      if (items.length === 0) throw new Error('pickWeighted: no items');
      const total = items.reduce((sum, item) => sum + Math.max(0, weight(item)), 0);
      let roll = next() * total;
      for (const item of items) {
        roll -= Math.max(0, weight(item));
        if (roll < 0) return item;
      }
      return items[items.length - 1]; // only reachable through float rounding
    },
  };
  return rng;
}

/** Names of the independent random streams. */
export type RngPurpose =
  | 'news'
  | 'sky'
  | 'temp'
  | 'demand'
  | 'extraArrivals'
  | `forecast${number}`;

/** A fresh, independent stream for one (seed, day, purpose). Same inputs → same numbers. */
export function rngFor(seed: number, day: number, purpose: RngPurpose): Rng {
  return createRng(hashString(`${seed}|${day}|${purpose}`));
}
