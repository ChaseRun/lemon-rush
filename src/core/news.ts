// Daily headlines (GAME_DESIGN §7). One weighted pick per day, except the fixed 4th of July.

import type { Item, NewsEvent } from '../contract';
import { JULY_4TH, JULY_4TH_DAY, NEWS_TABLE } from './config';
import { rngFor } from './rng';

/** The headline for one day. Pure: the same (seed, day) always gives the same news. */
export function rollNews(seed: number, day: number): NewsEvent {
  if (day === JULY_4TH_DAY) return JULY_4TH;
  return rngFor(seed, day, 'news').pickWeighted(NEWS_TABLE, (row) => row.weight).event;
}

/** Shop price multiplier this headline applies to an item (1 when unaffected). */
export function newsPriceMultiplier(news: NewsEvent | undefined, item: Item): number {
  return news?.priceMultipliers[item] ?? 1;
}
