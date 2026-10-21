// Who walks by and who stops (GAME_DESIGN §5).
//
// footTraffic = baseTraffic × tempFactor × skyFactor × newsFactor × (1 + popularity/100)
// Each passerby gets a type (by share) and a limit; they stop only if price ≤ limit.
// Only stoppers become Arrivals; everyone else is tallied in tooExpensive.

import type { Arrival, CustomerTypeId, NewsEvent, Weather } from '../contract';
import { CUSTOMER_TYPES, DEMAND, SKY_TABLE } from './config';
import { clamp, roundCents, toCents } from './money';
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

/** People pay more at a popular stand (and less at one nobody has heard of). */
export function popularityPayFactor(popularity: number): number {
  return DEMAND.popularityPayAt0 + popularity * DEMAND.popularityPayPerPoint;
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

/** The middle of a type's "most I'll pay" range: base × heat bonus × popularity factor × news (4th of July ×1.2). */
export function typicalMaxPay(type: CustomerTypeId, tempF: number, news: NewsEvent, popularity: number): number {
  return CUSTOMER_TYPES[type].basePay * heatBonus(tempF) * popularityPayFactor(popularity) * news.maxPayMultiplier;
}

/** The range a type's limit is drawn from: typical × (1 ± maxPayJitter). */
export function maxPayRange(
  type: CustomerTypeId,
  tempF: number,
  news: NewsEvent,
  popularity: number,
): { lo: number; hi: number } {
  const mid = typicalMaxPay(type, tempF, news, popularity);
  return { lo: mid * (1 - DEMAND.maxPayJitter), hi: mid * (1 + DEMAND.maxPayJitter) };
}

/** Chance that one passerby of this type stops at `price` (limits are uniform over maxPayRange). */
export function stopChance(type: CustomerTypeId, tempF: number, news: NewsEvent, popularity: number, price: number): number {
  const { lo, hi } = maxPayRange(type, tempF, news, popularity);
  return clamp((hi - price) / (hi - lo), 0, 1);
}

/**
 * Expected stoppers for a day: expected foot traffic × the share-weighted stop chance, plus any news extras.
 * This is what the Morning screen can show, and what the balance simulator's players plan with.
 */
export function expectedStoppers(weather: Weather, news: NewsEvent, popularity: number, price: number): number {
  const walkBy = expectedFootTraffic(weather, news, popularity);
  let stoppers = 0;
  for (const t of CUSTOMER_TYPE_IDS) stoppers += walkBy * CUSTOMER_TYPES[t].share * stopChance(t, weather.tempF, news, popularity, price);
  const extra = news.extraArrivals;
  if (extra) stoppers += extra.count * stopChance(extra.type, weather.tempF, news, popularity, price);
  return stoppers;
}

/** Most this person will pay: typicalMaxPay × uniform(1 − jitter, 1 + jitter), in cents. */
export function rollMaxPay(rng: Rng, type: CustomerTypeId, weather: Weather, news: NewsEvent, popularity = 0): number {
  const jitter = rng.float(1 - DEMAND.maxPayJitter, 1 + DEMAND.maxPayJitter);
  return roundCents(typicalMaxPay(type, weather.tempF, news, popularity) * jitter);
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
    const maxPay = rollMaxPay(rng, type, weather, news, popularity);
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
      const maxPay = rollMaxPay(extraRng, extra.type, weather, news, popularity);
      if (willStop(price, maxPay)) timed.push({ ...makeStopper(extra.type, maxPay), atMs });
      else tooExpensive[extra.type]++;
    }
  }

  // Array.prototype.sort is stable, so regulars stay ahead of extras at the same instant.
  const arrivals = timed.sort((a, b) => a.atMs - b.atMs).map((a, id) => ({ id, ...a }));
  return { passersby: regularCount + extraCount, arrivals, tooExpensive };
}
