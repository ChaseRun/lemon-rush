import { describe, expect, it } from 'vitest';
import { SEASON_DAYS } from './config';
import { autoServe, endDay, planDay } from './day';
import { gameReducer } from './reducer';
import { buy } from './shop';
import { newGame } from './state';
import type { GameState } from '../contract';

/** Plays every day with Auto-serve, restocking a medium pack of anything that runs out. */
function playOut(state: GameState): GameState {
  let g = state;
  while (g.status === 'playing') {
    for (const item of ['lemons', 'sugar', 'ice', 'cups'] as const) {
      if (g.inventory[item] < 10) {
        const r = buy(g, item, 1);
        if (r.ok) g = r.state;
      }
    }
    const plan = planDay(g);
    g = endDay(g, plan, autoServe(plan)).state;
  }
  return g;
}

describe('season length', () => {
  it('defaults to the standard summer', () => {
    const g = newGame(7);
    expect(g.seasonDays).toBe(SEASON_DAYS);
    expect(g.weather).toHaveLength(SEASON_DAYS);
    expect(g.news).toHaveLength(SEASON_DAYS);
  });

  it('a 7-day summer pre-rolls 7 days and ends after day 7 (unless bankrupt first)', () => {
    const g = newGame(42, 7);
    expect(g.seasonDays).toBe(7);
    expect(g.weather).toHaveLength(7);
    expect(g.news).toHaveLength(7);
    const end = playOut(g);
    if (end.status === 'finished') {
      expect(end.history).toHaveLength(7);
      expect(end.day).toBe(8);
    } else {
      expect(end.status).toBe('bankrupt');
      expect(end.history.length).toBeLessThanOrEqual(7);
    }
  });

  it('the forecast never looks past the last day of a short summer', () => {
    let g = newGame(3, 7);
    for (let d = 1; d < 7; d++) g = { ...g, day: d };
    const last = { ...newGame(3, 7), day: 7 };
    // forecast is recomputed by the engine each morning; on the final day only today is left
    const plan = planDay(last);
    expect(plan.day).toBe(7);
    const after = endDay(last, plan, autoServe(plan)).state;
    expect(after.status).toBe('finished');
    expect(after.forecast).toHaveLength(0);
  });

  it('rejects nonsense lengths by falling back to the default', () => {
    expect(newGame(1, 0).seasonDays).toBe(SEASON_DAYS);
    expect(newGame(1, 2.5).seasonDays).toBe(SEASON_DAYS);
  });

  it('the reducer passes the chosen length through', () => {
    const g = gameReducer(newGame(1), { type: 'newGame', seed: 9, seasonDays: 7 });
    expect(g.seasonDays).toBe(7);
  });

  it('the same seed gives the same first week regardless of season length… except for the temperature curve', () => {
    // Sky and news use per-day streams, so they match; temperature follows each season's own curve.
    const short = newGame(123, 7);
    const long = newGame(123, 30);
    expect(short.news.map((n) => n.id)).toEqual(long.news.slice(0, 7).map((n) => n.id));
    expect(short.weather.map((w) => w.sky)).toEqual(long.weather.slice(0, 7).map((w) => w.sky));
  });
});
