import { describe, expect, it } from 'vitest';
import type { NewsId, Sky, Weather } from '../contract';
import { CUSTOMER_TYPES, DAY_LENGTH_MS } from './config';
import type { DemandInput } from './demand';
import { expectedFootTraffic, generateDemand, heatBonus, temperatureFactor } from './demand';
import { newsById } from './testing';

function demand(overrides: Partial<Omit<DemandInput, 'news'>> & { news?: NewsId } = {}) {
  const { news = 'quiet', ...rest } = overrides;
  return generateDemand({
    seed: 1,
    day: 2,
    weather: { sky: 'sunny', tempF: 80 },
    popularity: 20,
    price: 2,
    dayLengthMs: DAY_LENGTH_MS,
    ...rest,
    news: newsById(news),
  });
}

const total = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe('demand formulas', () => {
  it('temperature factor: ×0.5 at 60°F, ×1.0 at 80°F, ×1.5 at 100°F', () => {
    expect(temperatureFactor(60)).toBeCloseTo(0.5);
    expect(temperatureFactor(80)).toBeCloseTo(1);
    expect(temperatureFactor(100)).toBeCloseTo(1.5);
  });

  it('heat bonus on limits: ×0.8 at 60°F, ×1.2 at 100°F', () => {
    expect(heatBonus(60)).toBeCloseTo(0.8);
    expect(heatBonus(100)).toBeCloseTo(1.2);
  });

  it('foot traffic = 40 × temp × sky × news × (1 + popularity/100)', () => {
    const quiet = newsById('quiet');
    expect(expectedFootTraffic({ sky: 'sunny', tempF: 80 }, quiet, 0)).toBeCloseTo(40);
    // Design doc day-1 example: 85°F sunny, popularity 20 → about 54.
    expect(expectedFootTraffic({ sky: 'sunny', tempF: 85 }, quiet, 20)).toBeCloseTo(54);
    expect(expectedFootTraffic({ sky: 'rain', tempF: 80 }, quiet, 0)).toBeCloseTo(14);
    expect(expectedFootTraffic({ sky: 'sunny', tempF: 80 }, newsById('poolClosed'), 0)).toBeCloseTo(52);
    expect(expectedFootTraffic({ sky: 'sunny', tempF: 80 }, newsById('july4th'), 0)).toBeCloseTo(80);
  });
});

describe('generateDemand', () => {
  it('hotter means more foot traffic', () => {
    const counts = [60, 70, 80, 90, 100].map((tempF) => demand({ weather: { sky: 'sunny', tempF } }).passersby);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
  });

  it('worse sky means fewer people, and a storm means nobody', () => {
    const skies: Sky[] = ['sunny', 'partlyCloudy', 'cloudy', 'rain', 'storm'];
    const counts = skies.map((sky) => demand({ weather: { sky, tempF: 85 } }).passersby);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThan(counts[i - 1]);
    const storm = demand({ weather: { sky: 'storm', tempF: 95 } });
    expect(storm.passersby).toBe(0);
    expect(storm.arrivals).toEqual([]);
  });

  it('more popularity means more foot traffic', () => {
    expect(demand({ popularity: 80 }).passersby).toBeGreaterThan(demand({ popularity: 10 }).passersby);
  });

  it('a higher price means fewer stop (same passersby, same rolls)', () => {
    const stopped = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5].map((price) => demand({ price }).arrivals.length);
    for (let i = 1; i < stopped.length; i++) expect(stopped[i]).toBeLessThanOrEqual(stopped[i - 1]);
    expect(stopped[0]).toBeGreaterThan(stopped[stopped.length - 1]);
  });

  it('every passerby either stops or is counted too expensive', () => {
    for (const price of [0.5, 1.75, 2.5, 5]) {
      const d = demand({ price });
      expect(d.arrivals.length + total(d.tooExpensive)).toBe(d.passersby);
    }
  });

  it('a passerby stops exactly when price ≤ their limit', () => {
    const d = demand({ price: 2 });
    for (const a of d.arrivals) expect(a.maxPay).toBeGreaterThanOrEqual(2);
    // At $2 on an 80°F day, no Allowance Kid can afford it: 1.25 × 1.0 × 1.2 = $1.50 max.
    expect(d.arrivals.some((a) => a.type === 'kid')).toBe(false);
  });

  it('limits stay inside base × heat bonus × [0.8, 1.2]', () => {
    const weather: Weather = { sky: 'sunny', tempF: 90 };
    const d = demand({ price: 0.5, weather });
    for (const a of d.arrivals) {
      const base = CUSTOMER_TYPES[a.type].basePay * heatBonus(90);
      expect(a.maxPay).toBeGreaterThanOrEqual(Math.floor(base * 0.8 * 100) / 100);
      expect(a.maxPay).toBeLessThanOrEqual(Math.ceil(base * 1.2 * 100) / 100);
    }
  });

  it('the 4th of July raises limits ×1.2 (same rolls)', () => {
    const quiet = demand({ day: 4, price: 0.5, news: 'quiet' }).arrivals;
    const july = demand({ day: 4, price: 0.5, news: 'july4th' }).arrivals;
    // July 4th doubles traffic; the first passersby share the same rolls.
    for (let i = 0; i < 10; i++) {
      expect(july[i].type).toBe(quiet[i].type);
      expect(july[i].maxPay).toBeCloseTo(quiet[i].maxPay * 1.2, 1);
    }
  });

  it('customer types follow their shares', () => {
    const counts = { kid: 0, jogger: 0, grandma: 0, worker: 0 };
    let n = 0;
    for (let seed = 1; seed <= 200; seed++) {
      for (const a of demand({ seed, price: 0.5, weather: { sky: 'sunny', tempF: 100 } }).arrivals) {
        counts[a.type]++;
        n++;
      }
    }
    for (const type of Object.keys(counts) as (keyof typeof counts)[]) {
      expect(counts[type] / n).toBeCloseTo(CUSTOMER_TYPES[type].share, 1);
    }
  });

  it('arrivals are sorted, spread evenly over the day, with ids in order and config patience/tips', () => {
    const { arrivals } = demand({ price: 1 });
    expect(arrivals.length).toBeGreaterThan(5);
    arrivals.forEach((a, i) => {
      expect(a.id).toBe(i);
      expect(a.atMs).toBeGreaterThanOrEqual(0);
      expect(a.atMs).toBeLessThanOrEqual(DAY_LENGTH_MS);
      if (i > 0) expect(a.atMs).toBeGreaterThan(arrivals[i - 1].atMs);
      expect(a.patienceMs).toBe(CUSTOMER_TYPES[a.type].patienceMs);
      expect(a.tipRate).toBe(CUSTOMER_TYPES[a.type].tipRate);
    });
    const gaps = arrivals.slice(1).map((a, i) => a.atMs - arrivals[i].atMs);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1); // rounding only
  });

  it('street crew: half the traffic plus 8 workers arriving together at noon', () => {
    const quiet = demand({ price: 0.5, news: 'quiet' });
    const crew = demand({ price: 0.5, news: 'streetCrew' });
    const noon = DAY_LENGTH_MS * (3 / 8);
    const atNoon = crew.arrivals.filter((a) => a.atMs === noon && a.type === 'worker');
    expect(atNoon.length).toBeGreaterThanOrEqual(8);
    expect(crew.passersby).toBe(Math.round(quiet.passersby / 2) + 8);
  });

  it('street crew workers still have to accept the price', () => {
    const crew = demand({ price: 5, news: 'streetCrew', weather: { sky: 'sunny', tempF: 60 } });
    // Max worker limit at 60°F: 3.00 × 0.8 × 1.2 = $2.88 < $5.
    expect(crew.arrivals).toEqual([]);
    expect(crew.tooExpensive.worker).toBeGreaterThanOrEqual(8);
  });

  it('is deterministic for the same inputs', () => {
    expect(demand({ seed: 9, day: 12 })).toEqual(demand({ seed: 9, day: 12 }));
  });

  it('matches the design-doc day 1 sanity check: ~54 walk by, kids priced out, ~31 stop', () => {
    let stopped = 0;
    const seeds = 200;
    for (let seed = 1; seed <= seeds; seed++) {
      const d = demand({ seed, day: 1, weather: { sky: 'sunny', tempF: 85 }, price: 2 });
      expect(d.passersby).toBe(54);
      expect(d.arrivals.some((a) => a.type === 'kid')).toBe(false);
      stopped += d.arrivals.length;
    }
    expect(stopped / seeds).toBeGreaterThan(28);
    expect(stopped / seeds).toBeLessThan(34);
  });
});
