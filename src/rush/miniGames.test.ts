import { describe, expect, it } from 'vitest';
import { RUSH } from './rushConfig';
import {
  glassTipMultiplier,
  gradePour,
  gradeRace,
  gradeSweeten,
  jugStars,
  pourFill,
  pourFillAt,
  pourRateAt,
  scoopAt,
  sweetSpotFor,
} from './miniGames';

const P = RUSH.pour;

describe('gradePour boundaries (band center c, half-width h)', () => {
  const c = 0.7;
  it.each([
    { fill: c, grade: 'perfect' },
    { fill: c + P.perfectTol, grade: 'perfect' },
    { fill: c - P.perfectTol, grade: 'perfect' },
    { fill: c - P.perfectTol - 0.001, grade: 'good' },
    { fill: c + P.perfectTol + 0.001, grade: 'good' },
    { fill: c - P.bandHalf, grade: 'good' }, // on the bottom line counts as inside
    { fill: c + P.bandHalf, grade: 'good' }, // on the top line counts as inside
    { fill: c - P.bandHalf - 0.001, grade: 'short' },
    { fill: 0, grade: 'short' },
    { fill: c + P.bandHalf + 0.001, grade: 'spill' },
    { fill: 1, grade: 'spill' },
  ])('fill $fill → $grade', ({ fill, grade }) => {
    expect(gradePour(fill, c)).toBe(grade);
  });
});

describe('pour flow', () => {
  it('ramps from a slow start to a gush, and the fill is the exact integral (frame-size independent)', () => {
    expect(pourRateAt(0)).toBe(P.startRatePerMs);
    expect(pourRateAt(P.rampMs)).toBe(P.fullRatePerMs);
    expect(pourRateAt(10 * P.rampMs)).toBe(P.fullRatePerMs);
    let sum = 0;
    for (let t = 0; t < 900; t += 0.5) sum += pourRateAt(t + 0.25) * 0.5; // midpoint rule
    expect(pourFillAt(900)).toBeCloseTo(sum, 6);
  });

  it('nothing flows during the tilt; the drip adds at most dripMs at the release rate; capped at the brim', () => {
    expect(pourFill(P.tiltMs, 1_000)).toBe(0);
    const hold = P.tiltMs + 600;
    expect(pourFill(hold, 1_000)).toBeCloseTo(pourFillAt(600) + pourRateAt(600) * P.dripMs, 12);
    expect(pourFill(10_000, 0)).toBe(P.brim);
  });
});

describe('jug beats', () => {
  it('race beats (squeeze, stir): GREAT if finished by greatMs, GOOD with at least goodCount, else POOR', () => {
    expect(gradeRace(8, 8, 1200, 1200, 5)).toBe('great');
    expect(gradeRace(8, 8, 1201, 1200, 5)).toBe('good');
    expect(gradeRace(5, 8, null, 1200, 5)).toBe('good');
    expect(gradeRace(4, 8, null, 1200, 5)).toBe('poor');
    expect(gradeRace(0, 8, null, 1200, 5)).toBe('poor');
  });

  it('the scoop sweeps 0 → 1 → 0 and the sweeten grade is by distance to the sweet spot', () => {
    const w = RUSH.jug.sweeten;
    expect(scoopAt(0)).toBe(0);
    expect(scoopAt(w.sweepMs)).toBe(1);
    expect(scoopAt(2 * w.sweepMs)).toBe(0);
    expect(scoopAt(w.sweepMs / 2)).toBeCloseTo(0.5);
    expect(scoopAt(-50)).toBe(0);
    expect(gradeSweeten(0.5 + w.greatTol, 0.5)).toBe('great');
    expect(gradeSweeten(0.5 - w.goodTol, 0.5)).toBe('good');
    expect(gradeSweeten(0.5 + w.goodTol + 0.01, 0.5)).toBe('poor');
    expect(gradeSweeten(null, 0.5)).toBe('poor'); // never tapped
    expect(sweetSpotFor(w.spots.length)).toBe(sweetSpotFor(0));
  });

  it.each([
    { grades: ['great', 'great', 'great'], stars: 3 },
    { grades: ['great', 'great', 'good'], stars: 3 },
    { grades: ['great', 'good', 'good'], stars: 2 },
    { grades: ['great', 'poor', 'great'], stars: 2 },
    { grades: ['good', 'good', 'good'], stars: 2 },
    { grades: ['good', 'good', 'poor'], stars: 1 },
    { grades: ['poor', 'poor', 'poor'], stars: 1 },
  ] as const)('$grades → $stars stars', ({ grades, stars }) => {
    expect(jugStars(grades)).toBe(stars);
  });

  it('stars and pour grade multiply into the glass tip multiplier', () => {
    expect(glassTipMultiplier('perfect', 3)).toBeCloseTo(1.2 * 1.25);
    expect(glassTipMultiplier('good', 2)).toBe(1);
    expect(glassTipMultiplier('short', 1)).toBeCloseTo(0.5 * 0.8);
  });
});
