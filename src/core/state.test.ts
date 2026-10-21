import { describe, expect, it } from 'vitest';
import { SEASON_DAYS } from './config';
import { glassesMakeable } from './inventory';
import { isBankrupt, newGame, restockCost, setPrice } from './state';
import { gameWith, stock } from './testing';

describe('newGame', () => {
  it('starts with $20, no stock, popularity 20 on day 1', () => {
    const state = newGame(1);
    expect(state).toMatchObject({
      seed: 1,
      day: 1,
      cash: 20,
      inventory: { lemons: 0, sugar: 0, ice: 0, cups: 0 },
      popularity: 20,
      spentToday: 0,
      history: [],
      status: 'playing',
    });
  });

  it('pre-rolls weather and news for every day, with a 3-day forecast', () => {
    const state = newGame(1);
    expect(state.weather).toHaveLength(SEASON_DAYS);
    expect(state.news).toHaveLength(SEASON_DAYS);
    expect(state.forecast.map((f) => f.day)).toEqual([1, 2, 3]);
  });

  it('is deterministic per seed', () => {
    expect(newGame(77)).toEqual(newGame(77));
    expect(newGame(77).weather).not.toEqual(newGame(78).weather);
  });
});

describe('setPrice', () => {
  it('clamps to $0.50–$5.00 and rounds to cents', () => {
    const state = gameWith();
    expect(setPrice(state, 0.1).price).toBe(0.5);
    expect(setPrice(state, 9).price).toBe(5);
    expect(setPrice(state, 1.234).price).toBe(1.23);
    expect(setPrice(state, 1.235).price).toBe(1.24);
  });

  it('ignores non-numbers', () => {
    const state = gameWith({ price: 2 });
    expect(setPrice(state, Number.NaN)).toBe(state);
    expect(setPrice(state, Infinity)).toBe(state);
  });
});

describe('glassesMakeable', () => {
  it('is the smallest of the four counts', () => {
    expect(glassesMakeable({ lemons: 10, sugar: 7, ice: 25, cups: 9 })).toBe(7);
    expect(glassesMakeable({ lemons: 10, sugar: 10, ice: 0, cups: 10 })).toBe(0);
    expect(glassesMakeable(stock(4))).toBe(4);
  });
});

describe('bankruptcy', () => {
  it('no stock and $0 → bankrupt', () => {
    expect(isBankrupt(gameWith({ inventory: stock(0), cash: 0 }))).toBe(true);
  });

  it('no stock but can afford one small pack of everything → not bankrupt', () => {
    // 3.00 + 1.50 + 1.00 + 1.00
    expect(restockCost(gameWith({ todayNews: 'quiet', inventory: stock(0) }))).toBe(6.5);
    expect(isBankrupt(gameWith({ todayNews: 'quiet', inventory: stock(0), cash: 6.5 }))).toBe(false);
    expect(isBankrupt(gameWith({ todayNews: 'quiet', inventory: stock(0), cash: 6.49 }))).toBe(true);
  });

  it('has stock and $0 → not bankrupt', () => {
    expect(isBankrupt(gameWith({ inventory: stock(3), cash: 0 }))).toBe(false);
  });

  it('only the missing items need to be affordable', () => {
    // Everything but ice: only a $1 ice pack is needed.
    const inventory = { lemons: 5, sugar: 5, ice: 0, cups: 5 };
    expect(isBankrupt(gameWith({ todayNews: 'quiet', inventory, cash: 1 }))).toBe(false);
    expect(isBankrupt(gameWith({ todayNews: 'quiet', inventory, cash: 0.99 }))).toBe(true);
  });

  it("uses today's news prices (Ice shortage doubles the cheapest ice)", () => {
    const inventory = { lemons: 5, sugar: 5, ice: 0, cups: 5 };
    expect(isBankrupt(gameWith({ todayNews: 'iceShortage', inventory, cash: 1.5 }))).toBe(true);
    expect(isBankrupt(gameWith({ todayNews: 'iceShortage', inventory, cash: 2 }))).toBe(false);
  });
});
