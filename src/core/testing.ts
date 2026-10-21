// Small builders shared by the engine tests. Not used by game code.

import type { Arrival, CustomerTypeId, DayPlan, GameState, Inventory, NewsEvent, NewsId } from '../contract';
import { CUSTOMER_TYPES, JULY_4TH, NEWS_TABLE } from './config';
import { newGame } from './state';

export function newsById(id: NewsId): NewsEvent {
  if (id === 'july4th') return JULY_4TH;
  const row = NEWS_TABLE.find((r) => r.event.id === id);
  if (!row) throw new Error(`no news ${id}`);
  return row.event;
}

/** A fresh game with fields overridden. `todayNews` replaces the headline for the current day. */
export function gameWith(overrides: Partial<GameState> & { todayNews?: NewsId } = {}): GameState {
  const { todayNews, ...rest } = overrides;
  const state = { ...newGame(42), ...rest };
  if (todayNews) {
    state.news = state.news.slice();
    state.news[state.day - 1] = newsById(todayNews);
  }
  return state;
}

export function stock(n: number): Inventory {
  return { lemons: n, sugar: n, ice: n, cups: n };
}

export function arrival(id: number, type: CustomerTypeId = 'jogger', atMs = id * 1000): Arrival {
  const { patienceMs, tipRate } = CUSTOMER_TYPES[type];
  return { id, atMs, type, maxPay: 5, patienceMs, tipRate };
}

/** A hand-built plan with `count` joggers arriving one second apart. */
export function planWith(overrides: Partial<DayPlan> & { count?: number } = {}): DayPlan {
  const { count = 10, ...rest } = overrides;
  return {
    day: 1,
    weather: { sky: 'sunny', tempF: 80 },
    news: newsById('quiet'),
    price: 2,
    inventory: stock(20),
    arrivals: Array.from({ length: count }, (_, i) => arrival(i)),
    passersby: count,
    tooExpensive: { kid: 0, jogger: 0, grandma: 0, worker: 0 },
    dayLengthMs: 120_000,
    ...rest,
  };
}
