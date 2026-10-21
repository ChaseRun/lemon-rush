// Display helpers shared by the screens: labels, emoji, formatting, and "who will pay what" math.

import type { CustomerTypeId, Item, NewsEvent, Sky } from '../../contract';
import { config, maxPayRange, stopChance } from '../../core';

export const { CUSTOMER_TYPES, DEMAND } = config;
export const TYPES = Object.keys(CUSTOMER_TYPES) as CustomerTypeId[];

export const SKY_EMOJI: Record<Sky, string> = { sunny: '☀️', partlyCloudy: '🌤️', cloudy: '☁️', rain: '🌧️', storm: '⛈️' };
export const SKY_NAME: Record<Sky, string> = {
  sunny: 'Sunny',
  partlyCloudy: 'Partly cloudy',
  cloudy: 'Cloudy',
  rain: 'Rain',
  storm: 'Storm',
};
export const ITEM_EMOJI: Record<Item, string> = { lemons: '🍋', sugar: '🍬', ice: '🧊', cups: '🥤' };
export const ITEM_NAME: Record<Item, string> = { lemons: 'Lemons', sugar: 'Sugar', ice: 'Ice', cups: 'Cups' };
export const TYPE_COLOR: Record<CustomerTypeId, string> = {
  kid: 'var(--kid)',
  jogger: 'var(--jogger)',
  grandma: 'var(--grandma)',
  worker: 'var(--worker)',
};
export const NEWS_EMOJI: Record<string, string> = {
  quiet: '🏡',
  heatwave: '🔥',
  poolClosed: '🏊',
  iceShortage: '🧊',
  lemonSale: '🍋',
  streetCrew: '🚧',
  july4th: '🎆',
};

export const money = (n: number) => (n < 0 ? `-$${(-n).toFixed(2)}` : `$${n.toFixed(2)}`);
export const pct = (n: number) => `${Math.round(n * 100)}%`;
export const times = (n: number) => `×${Number(n.toFixed(2))}`;

/** 0ms = 9:00am, dayLengthMs = 8:00pm (matches the Rush clock). */
export function clock(ms: number, dayLengthMs: number): string {
  const minutes = 9 * 60 + Math.round((ms / dayLengthMs) * 11 * 60);
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h24 > 12 ? h24 - 12 : h24}:${String(m).padStart(2, '0')}${h24 >= 12 ? 'pm' : 'am'}`;
}

/**
 * A customer type's range of "most I'll pay" (temperature, news and the stand's popularity included) and the
 * share who stop at `price`. Straight from the engine's demand model, so the price ruler matches the game.
 */
export function willingness(type: CustomerTypeId, tempF: number, news: NewsEvent, popularity: number, price: number) {
  const { lo, hi } = maxPayRange(type, tempF, news, popularity);
  return { lo, hi, stop: stopChance(type, tempF, news, popularity, price) };
}

export function describeNews(e: NewsEvent): string[] {
  const parts: string[] = [];
  if (e.tempBonusF) parts.push(`+${e.tempBonusF}°F`);
  if (e.trafficMultiplier !== 1) parts.push(`Foot traffic ${times(e.trafficMultiplier)}`);
  if (e.maxPayMultiplier !== 1) parts.push(`People pay ${times(e.maxPayMultiplier)}`);
  for (const [item, m] of Object.entries(e.priceMultipliers))
    parts.push(`${ITEM_NAME[item as Item]} ${m! > 1 ? 'cost' : 'on sale'} ${times(m!)}`);
  if (e.extraArrivals) parts.push(`${e.extraArrivals.count} ${CUSTOMER_TYPES[e.extraArrivals.type].label}s arrive at noon`);
  return parts;
}
