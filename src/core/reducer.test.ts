import { describe, expect, it } from 'vitest';
import { autoServe, planDay } from './day';
import { gameReducer } from './reducer';
import { gameWith } from './testing';

describe('gameReducer', () => {
  it('newGame starts fresh', () => {
    const state = gameReducer(gameWith({ day: 9, cash: 99 }), { type: 'newGame', seed: 3 });
    expect(state).toMatchObject({ seed: 3, day: 1, cash: 20 });
  });

  it('buy applies a successful purchase and ignores a failed one', () => {
    const state = gameWith({ todayNews: 'quiet', cash: 5 });
    const bought = gameReducer(state, { type: 'buy', item: 'sugar', packIdx: 0 });
    expect(bought.cash).toBe(3.5);
    expect(bought.inventory.sugar).toBe(10);
    expect(gameReducer(state, { type: 'buy', item: 'lemons', packIdx: 2 })).toBe(state);
  });

  it('setPrice clamps', () => {
    expect(gameReducer(gameWith(), { type: 'setPrice', price: 12 }).price).toBe(5);
  });

  it('finishDay ends the day once; a duplicate dispatch of the same plan is ignored', () => {
    let state = gameWith({ todayNews: 'quiet', cash: 20 });
    for (const item of ['lemons', 'sugar', 'ice', 'cups'] as const) {
      state = gameReducer(state, { type: 'buy', item, packIdx: 0 });
    }
    const plan = planDay(state);
    const action = { type: 'finishDay', plan, outcome: autoServe(plan) } as const;
    const after = gameReducer(state, action);
    expect(after.day).toBe(2);
    expect(after.history).toHaveLength(1);
    expect(gameReducer(after, action)).toBe(after);
  });

  it('ignores everything but newGame after the game ends', () => {
    const over = gameWith({ status: 'bankrupt' });
    expect(gameReducer(over, { type: 'setPrice', price: 1 })).toBe(over);
    expect(gameReducer(over, { type: 'buy', item: 'ice', packIdx: 0 })).toBe(over);
    expect(gameReducer(over, { type: 'newGame', seed: 1 }).status).toBe('playing');
  });
});
