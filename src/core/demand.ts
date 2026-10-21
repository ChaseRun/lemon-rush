// Who walks by and who stops (GAME_DESIGN §5).
//
// footTraffic = baseTraffic × tempFactor × skyFactor × newsFactor × (1 + popularity/100)
// Each passerby gets a type (by share) and a limit; they stop only if price ≤ limit.
// Only stoppers become Arrivals; everyone else is tallied in tooExpensive.

import type { Arrival, CustomerTypeId, NewsEvent, Weather } from '../contract';
import { CUSTOMER_TYPES, DEMAND, SKY_TABLE } from './config';
import { roundCents, toCents } from './money';
import type { Rng } from './rng';
import { rngFor } from './rng';

export const CUSTOMER_TYPE_IDS: readonly CustomerTypeId[] = ['kid', 'jogger', 'grandma', 'worker'];

export function zeroByType(): Record<CustomerTypeId, number> {
  return { kid: 0, jogger: 0, grandma: 0, worker: 0 };
}

/** ×0.5 at 60°F, ×1.0 at 80°F, ×1.5 at 100°F. */
export function temperatureFactor(tempF: number): number {
  return DEMAND.tempFactorAt60 + (tempF - 60) * DEMAND.tempFactorPerDegree;
}

/** Heat makes people pay more: ×0.8 at 60°F up to ×1.2 at 100°F. */
export function heatBonus(tempF: number): number {
  return DEMAND.heatBonusAt60 + (tempF - 60) * DEMAND.heatBonusPerDegree;
}

/** +1% foot traffic per popularity point. */
export function popularityFactor(popularity: number): number {
  return 1 + popularity * DEMAND.popularityTrafficPerPoint;
}

/** Expected passersby before rounding (street crew extras not included). */
export function expectedFootTraffic(weather: Weather, news: NewsEvent, popularity: number): number {
  return (
    DEMAND.baseTraffic *
    temperatureFactor(weather.tempF) *
    SKY_TABLE[weather.sky].traffic *
    news.trafficMultiplier *
    popularityFactor(popularity)
  );
}

/** Most this person will pay: base × heat bonus × uniform(0.8, 1.2) × news (4th of July ×1.2), in cents. */
export function rollMaxPay(rng: Rng, type: CustomerTypeId, weather: Weather, news: NewsEvent): number {
  const jitter = rng.float(1 - DEMAND.maxPayJitter, 1 + DEMAND.maxPayJitter);
  return roundCents(CUSTOMER_TYPES[type].basePay * heatBonus(weather.tempF) * jitter * news.maxPayMultiplier);
}

export function willStop(price: number, maxPay: number): boolean {
  return toCents(price) <= toCents(maxPay);
}

export interface DemandInput {
  seed: number;
  day: number;
  weather: Weather;
  news: NewsEvent;
  popularity: number;
  price: number;
  dayLengthMs: number;
}

export interface Demand {
  passersby: number;
  /** Sorted by atMs, ids 0..n-1 in arrival order. */
  arrivals: Arrival[];
  tooExpensive: Record<CustomerTypeId, number>;
}

type Stopper = Omit<Arrival, 'id' | 'atMs'>;

function makeStopper(type: CustomerTypeId, maxPay: number): Stopper {
  const { patienceMs, tipRate } = CUSTOMER_TYPES[type];
  return { type, maxPay, patienceMs, tipRate };
}

/** Rolls the day's passersby and turns the ones who accept the price into timed Arrivals. */
export function generateDemand(input: DemandInput): Demand {
  const { seed, day, weather, news, popularity, price, dayLengthMs } = input;
  const tooExpensive = zeroByType();

  // Regular foot traffic, spread evenly over the day.
  const rng = rngFor(seed, day, 'demand');
  const regularCount = Math.max(0, Math.round(expectedFootTraffic(weather, news, popularity)));
  const regulars: Stopper[] = [];
  for (let i = 0; i < regularCount; i++) {
    const type = rng.pickWeighted(CUSTOMER_TYPE_IDS, (t) => CUSTOMER_TYPES[t].share);
    const maxPay = rollMaxPay(rng, type, weather, news);
    if (willStop(price, maxPay)) regulars.push(makeStopper(type, maxPay));
    else tooExpensive[type]++;
  }
  const timed: Omit<Arrival, 'id'>[] = regulars.map((s, i) => ({
    ...s,
    atMs: Math.round(((i + 0.5) / regulars.length) * dayLengthMs),
  }));

  // News extras (street crew lunch rush) arrive together, on their own random stream.
  const extra = news.extraArrivals;
  let extraCount = 0;
  if (extra) {
    const extraRng = rngFor(seed, day, 'extraArrivals');
    const atMs = Math.round(extra.atFractionOfDay * dayLengthMs);
    for (let i = 0; i < extra.count; i++) {
      extraCount++;
      const maxPay = rollMaxPay(extraRng, extra.type, weather, news);
      if (willStop(price, maxPay)) timed.push({ ...makeStopper(extra.type, maxPay), atMs });
      else tooExpensive[extra.type]++;
    }
  }

  // Array.prototype.sort is stable, so regulars stay ahead of extras at the same instant.
  const arrivals = timed.sort((a, b) => a.atMs - b.atMs).map((a, id) => ({ id, ...a }));
  return { passersby: regularCount + extraCount, arrivals, tooExpensive };
}
