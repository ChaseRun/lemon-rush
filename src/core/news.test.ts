import { describe, expect, it } from 'vitest';
import type { NewsId } from '../contract';
import { JULY_4TH_DAY, NEWS_TABLE, SEASON_DAYS } from './config';
import { newsPriceMultiplier, rollNews } from './news';
import { newsById } from './testing';

describe('news', () => {
  it('day 4 is always the 4th of July: traffic ×1.5, limits ×1.2', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const news = rollNews(seed, JULY_4TH_DAY);
      expect(news.id).toBe('july4th');
      expect(news.trafficMultiplier).toBe(1.5);
      expect(news.maxPayMultiplier).toBe(1.2);
    }
  });

  it('other days follow the headline weights', () => {
    const counts: Partial<Record<NewsId, number>> = {};
    let n = 0;
    for (let seed = 1; seed <= 500; seed++) {
      for (let day = 1; day <= SEASON_DAYS; day++) {
        if (day === JULY_4TH_DAY) continue;
        const id = rollNews(seed, day).id;
        counts[id] = (counts[id] ?? 0) + 1;
        n++;
      }
    }
    expect(counts.july4th).toBeUndefined();
    for (const row of NEWS_TABLE) {
      expect((counts[row.event.id] ?? 0) / n).toBeCloseTo(row.weight / 100, 1);
    }
  });

  it('price multipliers: lemon sale 0.7 on lemons, ice shortage ×2 on ice, 1 otherwise', () => {
    expect(newsPriceMultiplier(newsById('lemonSale'), 'lemons')).toBe(0.7);
    expect(newsPriceMultiplier(newsById('lemonSale'), 'ice')).toBe(1);
    expect(newsPriceMultiplier(newsById('iceShortage'), 'ice')).toBe(2);
    expect(newsPriceMultiplier(undefined, 'ice')).toBe(1);
  });

  it('street crew halves traffic and sends 8 workers at noon', () => {
    const crew = newsById('streetCrew');
    expect(crew.trafficMultiplier).toBe(0.5);
    expect(crew.extraArrivals).toEqual({ type: 'worker', count: 8, atFractionOfDay: 3 / 11 });
  });
});
