import type { Inventory } from '../contract';
import { ITEMS } from '../contract';

export function emptyInventory(): Inventory {
  return { lemons: 0, sugar: 0, ice: 0, cups: 0 };
}

/** One glass = 1 of each item, so the scarcest item decides. */
export function glassesMakeable(inventory: Inventory): number {
  return Math.max(0, Math.min(...ITEMS.map((item) => inventory[item])));
}

/** inventory - used, never below zero per item. */
export function subtractInventory(inventory: Inventory, used: Inventory): Inventory {
  const out = emptyInventory();
  for (const item of ITEMS) out[item] = Math.max(0, inventory[item] - used[item]);
  return out;
}

/** n of every item (what n glasses consume). */
export function glassesWorth(n: number): Inventory {
  return { lemons: n, sugar: n, ice: n, cups: n };
}
