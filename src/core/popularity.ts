// Service rating and popularity (GAME_DESIGN §8).

import type { DayOutcome } from '../contract';
import { POPULARITY, SERVICE_WEIGHTS } from './config';
import { clamp } from './money';

/**
 * Average experience of everyone who stopped and had an outcome:
 * green 1, yellow 0.7, red 0.4, no room 0.3, sold out 0.2, walkout 0.
 * Customers still waiting at 5pm simply leave and aren't rated.
 * Nobody rated → SERVICE_WEIGHTS.nobodyStopped (0.5), so an empty day doesn't move popularity much.
 */
export function serviceRating(outcome: Pick<DayOutcome, 'served' | 'walkouts' | 'noRoom' | 'soldOutMisses'>): number {
  const servedScore = outcome.served.reduce((sum, s) => sum + SERVICE_WEIGHTS[s.bar], 0);
  const total =
    servedScore +
    outcome.noRoom * SERVICE_WEIGHTS.noRoom +
    outcome.soldOutMisses * SERVICE_WEIGHTS.soldOut +
    outcome.walkouts * SERVICE_WEIGHTS.walkout;
  const count = outcome.served.length + outcome.noRoom + outcome.soldOutMisses + outcome.walkouts;
  return count === 0 ? SERVICE_WEIGHTS.nobodyStopped : total / count;
}

/**
 * Overnight popularity update:
 *   1. p += (rating - 0.5) × 20     good service grows the crowd, bad service shrinks it
 *   2. p += (20 - p) × 0.05         slow drift back toward the neighbourhood baseline
 *   3. clamp to 0–100, round to 2 decimals
 */
export function updatePopularity(popularity: number, rating: number): number {
  let p = popularity + (rating - 0.5) * POPULARITY.changeScale;
  p += (POPULARITY.anchor - p) * POPULARITY.drift;
  return Math.round(clamp(p, POPULARITY.min, POPULARITY.max) * 100) / 100;
}
