// The Corner Store (GAME_DESIGN §3, §7 price news).

import type { BuyResult, GameState, Item, Pack } from '../contract';
import { ITEMS } from '../contract';
import { PACKS } from './config';
import { roundCents, toCents } from './money';
import { newsPriceMultiplier } from './news';

/** Today's headline, or undefined past the end of the season. */
function todaysNews(state: Pick<GameState, 'day' | 'news'>) {
  return state.news[state.day - 1];
}

/** Packs on sale today for one item, with news price modifiers applied and rounded to cents. */
export function packsFor(state: Pick<GameState, 'day' | 'news'>, item: Item): Pack[] {
  const multiplier = newsPriceMultiplier(todaysNews(state), item);
  return PACKS[item].map((pack) => ({ size: pack.size, price: roundCents(pack.price * multiplier) }));
}

export function shopListing(state: Pick<GameState, 'day' | 'news'>): Record<Item, Pack[]> {
  return {
    lemons: packsFor(state, 'lemons'),
    sugar: packsFor(state, 'sugar'),
    ice: packsFor(state, 'ice'),
    cups: packsFor(state, 'cups'),
  };
}

/** Cheapest pack of an item at today's prices. */
export function cheapestPack(state: Pick<GameState, 'day' | 'news'>, item: Item): Pack {
  return packsFor(state, item).reduce((best, pack) => (pack.price < best.price ? pack : best));
}

/**
 * Buys one pack. Never throws: unknown items, bad pack indexes, a finished game
 * and insufficient cash all come back as { ok: false, error }.
 */
export function buy(state: GameState, item: Item, packIdx: number): BuyResult {
  if (state.status !== 'playing') return { ok: false, error: 'The stand is closed for the season.' };
  if (!(ITEMS as readonly string[]).includes(item)) return { ok: false, error: `Unknown item "${String(item)}".` };
  if (!Number.isInteger(packIdx) || packIdx < 0 || packIdx >= PACKS[item].length) {
    return { ok: false, error: `No pack #${packIdx} for ${item}.` };
  }
  const pack = packsFor(state, item)[packIdx];
  if (toCents(pack.price) > toCents(state.cash)) {
    return { ok: false, error: `Not enough cash: ${pack.size} ${item} cost $${pack.price.toFixed(2)}.` };
  }
  return {
    ok: true,
    state: {
      ...state,
      cash: roundCents(state.cash - pack.price),
      spentToday: roundCents(state.spentToday + pack.price),
      inventory: { ...state.inventory, [item]: state.inventory[item] + pack.size },
    },
  };
}
