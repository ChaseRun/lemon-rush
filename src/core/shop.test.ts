import { describe, expect, it } from 'vitest';
import type { Item } from '../contract';
import { PACKS } from './config';
import { buy, cheapestPack, shopListing } from './shop';
import { gameWith } from './testing';

describe('shopListing', () => {
  it('lists the design-doc packs on a quiet day', () => {
    const listing = shopListing(gameWith({ todayNews: 'quiet' }));
    expect(listing.lemons).toEqual([
      { size: 10, price: 3 },
      { size: 25, price: 6.25 },
      { size: 50, price: 10 },
    ]);
    expect(listing.sugar.map((p) => p.price)).toEqual([1.5, 3, 5]);
    expect(listing.ice.map((p) => p.price)).toEqual([1, 2, 3]);
    expect(listing.cups.map((p) => p.price)).toEqual([1, 2, 3]);
  });

  it('bigger packs are cheaper per unit', () => {
    for (const item of Object.keys(PACKS) as Item[]) {
      const perUnit = PACKS[item].map((p) => p.price / p.size);
      expect(perUnit[0]).toBeGreaterThan(perUnit[1]);
      expect(perUnit[1]).toBeGreaterThan(perUnit[2]);
    }
  });

  it('Lemon sale takes 30% off lemons only, rounded to cents', () => {
    const listing = shopListing(gameWith({ todayNews: 'lemonSale' }));
    expect(listing.lemons.map((p) => p.price)).toEqual([2.1, 4.38, 7]);
    expect(listing.sugar.map((p) => p.price)).toEqual([1.5, 3, 5]);
  });

  it('Ice shortage doubles ice only', () => {
    const listing = shopListing(gameWith({ todayNews: 'iceShortage' }));
    expect(listing.ice.map((p) => p.price)).toEqual([2, 4, 6]);
    expect(listing.lemons.map((p) => p.price)).toEqual([3, 6.25, 10]);
  });

  it('cheapestPack is the small pack', () => {
    expect(cheapestPack(gameWith({ todayNews: 'quiet' }), 'lemons')).toEqual({ size: 10, price: 3 });
  });
});

describe('buy', () => {
  it('subtracts cash, adds stock and records spending', () => {
    const state = gameWith({ todayNews: 'quiet', cash: 20 });
    const result = buy(state, 'lemons', 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.cash).toBe(13.75);
    expect(result.state.inventory.lemons).toBe(25);
    expect(result.state.spentToday).toBe(6.25);
    expect(state.cash).toBe(20); // input untouched
  });

  it('charges the news price', () => {
    const result = buy(gameWith({ todayNews: 'iceShortage', cash: 20 }), 'ice', 2);
    expect(result.ok && result.state.cash).toBe(14);
  });

  it('rejects when cash is short, and allows spending the exact last cent', () => {
    const short = buy(gameWith({ todayNews: 'quiet', cash: 9.99 }), 'lemons', 2);
    expect(short).toEqual({ ok: false, error: expect.stringContaining('Not enough cash') });
    const exact = buy(gameWith({ todayNews: 'quiet', cash: 10 }), 'lemons', 2);
    expect(exact.ok && exact.state.cash).toBe(0);
  });

  it('handles float-y totals in cents (0.1 + 0.2 style)', () => {
    let state = gameWith({ todayNews: 'lemonSale', cash: 4.38 + 2.1 });
    const a = buy(state, 'lemons', 1);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    state = a.state;
    const b = buy(state, 'lemons', 0);
    expect(b.ok && b.state.cash).toBe(0);
    expect(b.ok && b.state.spentToday).toBe(6.48);
  });

  it('never throws on bad input', () => {
    const state = gameWith();
    expect(buy(state, 'lemons', 3).ok).toBe(false);
    expect(buy(state, 'lemons', -1).ok).toBe(false);
    expect(buy(state, 'lemons', 0.5).ok).toBe(false);
    expect(buy(state, 'lemons', Number.NaN).ok).toBe(false);
    expect(buy(state, 'gold' as Item, 0).ok).toBe(false);
  });

  it('refuses once the game is over', () => {
    expect(buy(gameWith({ status: 'finished' }), 'cups', 0).ok).toBe(false);
  });
});
