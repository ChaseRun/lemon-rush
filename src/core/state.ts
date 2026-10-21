// Creating a game and the small state helpers (GAME_DESIGN §1, §3).

import type { GameState, NewsEvent, Weather } from '../contract';
import { ITEMS } from '../contract';
import { PRICE_MAX, PRICE_MIN, SEASON_DAYS, START_CASH, START_POPULARITY, START_PRICE } from './config';
import { emptyInventory, glassesMakeable } from './inventory';
import { clamp, roundCents, sumCents, toCents } from './money';
import { rollNews } from './news';
import { cheapestPack } from './shop';
import { forecast, rollWeather } from './weather';

/** Pre-rolls every day's news, then the weather (which needs the news for Heatwave). */
export function rollSeason(seed: number, seasonDays: number = SEASON_DAYS): { news: NewsEvent[]; weather: Weather[] } {
  const days = Array.from({ length: seasonDays }, (_, i) => i + 1);
  const news = days.map((day) => rollNews(seed, day));
  const weather = days.map((day, i) => rollWeather(seed, day, news[i], seasonDays));
  return { news, weather };
}

/** $20, empty stock, popularity 20, morning of day 1. The whole season's weather and news are fixed by the seed. */
export function newGame(seed: number, seasonDays: number = SEASON_DAYS): GameState {
  const days = Number.isInteger(seasonDays) && seasonDays >= 1 ? seasonDays : SEASON_DAYS;
  const { news, weather } = rollSeason(seed, days);
  const state: GameState = {
    seed,
    day: 1,
    seasonDays: days,
    cash: START_CASH,
    inventory: emptyInventory(),
    popularity: START_POPULARITY,
    price: START_PRICE,
    weather,
    news,
    forecast: [],
    spentToday: 0,
    history: [],
    status: 'playing',
  };
  return { ...state, forecast: forecast(state) };
}

/** Clamps to $0.50–$5.00 and rounds to cents. Non-numbers leave the price unchanged. */
export function setPrice(state: GameState, price: number): GameState {
  if (!Number.isFinite(price)) return state;
  return { ...state, price: roundCents(clamp(price, PRICE_MIN, PRICE_MAX)) };
}

/** Cost of the cheapest pack of every item you have none of, at today's prices. */
export function restockCost(state: Pick<GameState, 'day' | 'news' | 'inventory'>): number {
  return sumCents(ITEMS.filter((item) => state.inventory[item] <= 0).map((item) => cheapestPack(state, item).price));
}

/** Bankrupt = can't make a glass AND can't afford the cheapest pack of each missing item. */
export function isBankrupt(state: Pick<GameState, 'day' | 'news' | 'inventory' | 'cash'>): boolean {
  if (glassesMakeable(state.inventory) > 0) return false;
  return toCents(state.cash) < toCents(restockCost(state));
}
