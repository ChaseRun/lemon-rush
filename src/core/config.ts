// Every tunable number and data table in the game. Logic files never hard-code these.
// See docs/GAME_DESIGN.md for the rules these numbers drive.

import type { CustomerTypeId, ForecastConfidence, Item, NewsEvent, Sky } from '../contract';

// ---------- Season ----------

export const SEASON_DAYS = 30;
export const START_CASH = 20;
export const START_POPULARITY = 20;
export const START_PRICE = 2;

export const PRICE_MIN = 0.5;
export const PRICE_MAX = 5;

/** Real-time length of one day (9am–5pm) in the Rush. */
export const DAY_LENGTH_MS = 120_000;

// ---------- Shop ----------

/** Pack tiers per item: [small, medium, large]. Bigger packs are cheaper per unit. */
export const PACKS: Record<Item, { size: number; price: number }[]> = {
  lemons: [
    { size: 10, price: 3.0 },
    { size: 25, price: 6.25 },
    { size: 50, price: 10.0 },
  ],
  sugar: [
    { size: 10, price: 1.5 },
    { size: 25, price: 3.0 },
    { size: 50, price: 5.0 },
  ],
  ice: [
    { size: 10, price: 1.0 },
    { size: 25, price: 2.0 },
    { size: 50, price: 3.0 },
  ],
  cups: [
    { size: 10, price: 1.0 },
    { size: 25, price: 2.0 },
    { size: 50, price: 3.0 },
  ],
};

// ---------- Weather ----------

/** temp = base + amplitude * sin(pi * (day - 1) / (SEASON_DAYS - 1)) + uniform(-noise, +noise), clamped. */
export const TEMPERATURE = {
  base: 78,
  amplitude: 10,
  noise: 8,
  min: 60,
  max: 100,
};

export const SKY_TABLE: Record<Sky, { weight: number; traffic: number }> = {
  sunny: { weight: 35, traffic: 1.0 },
  partlyCloudy: { weight: 25, traffic: 0.9 },
  cloudy: { weight: 20, traffic: 0.7 },
  rain: { weight: 15, traffic: 0.35 },
  storm: { weight: 5, traffic: 0 },
};

/** Index 0 = today, 1 = tomorrow, 2 = day after. */
export const FORECAST_ACCURACY: { skyCorrect: number; tempErrorF: number; confidence: ForecastConfidence }[] = [
  { skyCorrect: 0.85, tempErrorF: 2, confidence: 'pretty sure' },
  { skyCorrect: 0.65, tempErrorF: 5, confidence: 'thinks so' },
  { skyCorrect: 0.5, tempErrorF: 8, confidence: 'just guessing' },
];

// ---------- Demand ----------

export const DEMAND = {
  /** Passersby on an 80°F sunny quiet day at popularity 0. */
  baseTraffic: 40,
  /** tempFactor = tempFactorAt60 + (tempF - 60) * tempFactorPerDegree  → 0.5 at 60°F, 1.5 at 100°F */
  tempFactorAt60: 0.5,
  tempFactorPerDegree: 1 / 40,
  /** heatBonus = heatBonusAt60 + (tempF - 60) * heatBonusPerDegree  → 0.8 at 60°F, 1.2 at 100°F */
  heatBonusAt60: 0.8,
  heatBonusPerDegree: 0.4 / 40,
  /** maxPay is multiplied by uniform(1 - jitter, 1 + jitter). */
  maxPayJitter: 0.2,
  /** traffic multiplier = 1 + popularity * popularityTrafficPerPoint */
  popularityTrafficPerPoint: 0.01,
};

export const CUSTOMER_TYPES: Record<
  CustomerTypeId,
  { label: string; emoji: string; share: number; basePay: number; patienceMs: number; tipRate: number }
> = {
  kid: { label: 'Allowance Kid', emoji: '🧒', share: 0.35, basePay: 1.25, patienceMs: 18_000, tipRate: 0 },
  jogger: { label: 'Jogger', emoji: '🏃', share: 0.25, basePay: 2.5, patienceMs: 12_000, tipRate: 0.1 },
  grandma: { label: 'Grandma', emoji: '👵', share: 0.2, basePay: 2.0, patienceMs: 25_000, tipRate: 0.3 },
  worker: { label: 'Construction Worker', emoji: '👷', share: 0.2, basePay: 3.0, patienceMs: 15_000, tipRate: 0.15 },
};

// ---------- News ----------

const NO_EFFECT = { trafficMultiplier: 1, tempBonusF: 0, maxPayMultiplier: 1, priceMultipliers: {} };

/** One headline per day, picked by weight. */
export const NEWS_TABLE: { weight: number; event: NewsEvent }[] = [
  { weight: 50, event: { id: 'quiet', headline: 'A quiet day in the neighborhood.', ...NO_EFFECT } },
  {
    weight: 12,
    event: { id: 'heatwave', headline: 'HEATWAVE WARNING! Stay hydrated.', ...NO_EFFECT, tempBonusF: 10 },
  },
  {
    weight: 10,
    event: { id: 'poolClosed', headline: 'Town pool closed for repairs!', ...NO_EFFECT, trafficMultiplier: 1.3 },
  },
  {
    weight: 10,
    event: { id: 'iceShortage', headline: 'Ice shortage at the Corner Store!', ...NO_EFFECT, priceMultipliers: { ice: 2 } },
  },
  {
    weight: 10,
    event: { id: 'lemonSale', headline: 'Lemon sale! 30% off.', ...NO_EFFECT, priceMultipliers: { lemons: 0.7 } },
  },
  {
    weight: 8,
    event: {
      id: 'streetCrew',
      headline: 'Street crew working on your block.',
      ...NO_EFFECT,
      trafficMultiplier: 0.5,
      extraArrivals: { type: 'worker', count: 8, atFractionOfDay: 3 / 8 }, // noon
    },
  },
];

/** Fixed holiday: overrides the rolled headline. */
export const JULY_4TH_DAY = 4;
export const JULY_4TH: NewsEvent = {
  id: 'july4th',
  headline: 'Happy 4th of July! The whole town is out.',
  ...NO_EFFECT,
  trafficMultiplier: 2,
  maxPayMultiplier: 1.2,
};

// ---------- Service rating & popularity ----------

/** Per-customer contribution to the day's service rating (average over everyone who stopped). */
export const SERVICE_WEIGHTS = {
  green: 1,
  yellow: 0.7,
  red: 0.4,
  noRoom: 0.3,
  soldOut: 0.2,
  walkout: 0,
  /** Rating when nobody stopped (e.g. a storm). */
  nobodyStopped: 0.5,
};

/** popularity += (rating - 0.5) * changeScale; popularity += (anchor - popularity) * drift; clamp. */
export const POPULARITY = {
  changeScale: 20,
  drift: 0.05,
  anchor: 20,
  min: 0,
  max: 100,
};
