// Whole-season tests: a scripted player runs 30 days through the public engine API.

import { describe, expect, it } from 'vitest';
import type { GameState } from '../contract';
import { ITEMS } from '../contract';
import { SEASON_DAYS } from './config';
import { engine } from './index';

type Strategy = (state: GameState) => GameState;

/** Price by the forecast, then top up the scarcest item one small pack at a time until `target` glasses. */
const steady =
  (target: number): Strategy =>
  (state) => {
    const today = state.forecast[0];
    let s = engine.setPrice(state, today.tempF >= 85 ? 2.25 : today.tempF >= 75 ? 1.75 : 1.25);
    while (engine.glassesMakeable(s.inventory) < target) {
      const scarcest = ITEMS.reduce((a, b) => (s.inventory[b] < s.inventory[a] ? b : a));
      const result = engine.buy(s, scarcest, 0);
      if (!result.ok) break;
      s = result.state;
    }
    return s;
  };

function playSeason(seed: number, strategy: Strategy, onDay?: (s: GameState) => void): GameState {
  let state = engine.newGame(seed);
  while (state.status === 'playing') {
    state = strategy(state);
    const plan = engine.planDay(state);
    state = engine.gameReducer(state, { type: 'finishDay', plan, outcome: engine.autoServe(plan) });
    onDay?.(state);
  }
  return state;
}

function expectSaneState(s: GameState) {
  expect(s.cash).toBeGreaterThanOrEqual(0);
  expect(Math.round(s.cash * 100)).toBeCloseTo(s.cash * 100, 6); // whole cents
  for (const item of ITEMS) expect(s.inventory[item]).toBeGreaterThanOrEqual(0);
  expect(s.inventory.ice).toBe(0); // every morning starts with melted ice
  expect(s.popularity).toBeGreaterThanOrEqual(0);
  expect(s.popularity).toBeLessThanOrEqual(100);
  expect(s.history).toHaveLength(s.day - 1);
}

describe('a 30-day season', () => {
  it('gives the same result every time for a fixed seed and strategy', () => {
    const a = playSeason(2026, steady(30));
    const b = playSeason(2026, steady(30));
    expect(a).toEqual(b);
    expect(a.status).toBe('finished');
    expect(a.day).toBe(SEASON_DAYS + 1);
    expect(a.history).toHaveLength(SEASON_DAYS);
  });

  it('never produces negative stock or cash, across many seeds and strategies', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const strategy of [steady(10), steady(30), steady(80)]) {
        const end = playSeason(seed, strategy, expectSaneState);
        expect(['finished', 'bankrupt']).toContain(end.status);
      }
    }
  });

  it('cash in the history adds up day by day', () => {
    const end = playSeason(7, steady(30));
    let cash = 20;
    for (const r of end.history) {
      expect(r.profit).toBeCloseTo(r.revenue + r.tips - r.spent, 2);
      expect(r.cashAfter).toBeCloseTo(cash + r.profit, 2);
      cash = r.cashAfter;
    }
    expect(end.cash).toBe(cash);
  });

  it('a sensible strategy usually turns a profit', () => {
    const finals = Array.from({ length: 30 }, (_, i) => playSeason(i + 1, steady(30)));
    const profitable = finals.filter((s) => s.status === 'finished' && s.cash > 20).length;
    expect(profitable).toBeGreaterThanOrEqual(27);
  });

  it('spending everything on lemons goes bankrupt on day 1 and ends the game', () => {
    const lemonsOnly: Strategy = (state) => {
      let s = state;
      for (;;) {
        const r = engine.buy(s, 'lemons', 2);
        if (!r.ok) return s;
        s = r.state;
      }
    };
    const end = playSeason(1, lemonsOnly);
    expect(end.status).toBe('bankrupt');
    expect(end.history).toHaveLength(1);
    expect(end.history[0].day).toBe(1);
  });

  it('doing nothing keeps the starting $20 and finishes the season', () => {
    const end = playSeason(1, (s) => s);
    expect(end.status).toBe('finished');
    expect(end.cash).toBe(20);
  });
});
