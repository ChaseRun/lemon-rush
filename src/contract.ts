// Shared contract between the engine (src/core), the Rush mini-game (src/rush) and the UI (src/ui).
// This is the only module the three areas share. Owned by the integrator — agents request changes, never edit.
//
// Day flow:
//   GameState --planDay--> DayPlan --[ autoServe | Rush ]--> DayOutcome --endDay--> GameState + DayReport

// ---------- Supplies ----------

export type Item = 'lemons' | 'sugar' | 'ice' | 'cups';
export const ITEMS: readonly Item[] = ['lemons', 'sugar', 'ice', 'cups'];

/** Units of each item on hand. One glass = 1 of each. */
export type Inventory = Record<Item, number>;

export interface Pack {
  size: number;
  /** Price in dollars, after any news modifiers. */
  price: number;
}

// ---------- Weather ----------

export type Sky = 'sunny' | 'partlyCloudy' | 'cloudy' | 'rain' | 'storm';
/** Ordered best → worst. A wrong forecast is off by exactly one step on this ladder. */
export const SKY_LADDER: readonly Sky[] = ['sunny', 'partlyCloudy', 'cloudy', 'rain', 'storm'];

export interface Weather {
  sky: Sky;
  tempF: number;
}

export type ForecastConfidence = 'pretty sure' | 'thinks so' | 'just guessing';

export interface ForecastDay extends Weather {
  day: number;
  confidence: ForecastConfidence;
}

// ---------- Customers & news ----------

export type CustomerTypeId = 'kid' | 'jogger' | 'grandma' | 'worker';

export type NewsId =
  | 'quiet'
  | 'heatwave'
  | 'poolClosed'
  | 'iceShortage'
  | 'lemonSale'
  | 'streetCrew'
  | 'july4th';

/** A headline plus its effects. Rows live in the news table in src/core/config.ts. */
export interface NewsEvent {
  id: NewsId;
  headline: string;
  /** Multiplies foot traffic. */
  trafficMultiplier: number;
  /** Added to the day's actual temperature (and its forecast). */
  tempBonusF: number;
  /** Multiplies every passerby's max willingness to pay. */
  maxPayMultiplier: number;
  /** Multiplies shop prices for the listed items. */
  priceMultipliers: Partial<Record<Item, number>>;
  /** Extra customers who arrive together (street crew lunch rush). */
  extraArrivals?: { type: CustomerTypeId; count: number; atFractionOfDay: number };
}

// ---------- Game state ----------

export type GameStatus = 'playing' | 'bankrupt' | 'finished';

export interface GameState {
  seed: number;
  /** 1-based; the season ends after `seasonDays`. */
  day: number;
  /** How many days this summer lasts (chosen on the start screen: 7 or 30). */
  seasonDays: number;
  /** Dollars, rounded to cents. Never negative. */
  cash: number;
  inventory: Inventory;
  /** 0–100. Starts at 20. */
  popularity: number;
  /** Price per glass for today; locked once the day starts. */
  price: number;
  /** Actual weather for every day, pre-rolled at newGame (index 0 = day 1), news effects included. */
  weather: Weather[];
  /** Headline for every day, pre-rolled at newGame (index 0 = day 1). */
  news: NewsEvent[];
  /** Walt's forecast as seen this morning: today, tomorrow, day after (fewer near season end). */
  forecast: ForecastDay[];
  /** Money spent in the shop since the last day ended (shown in the report). */
  spentToday: number;
  /** One report per completed day. */
  history: DayReport[];
  status: GameStatus;
}

// ---------- A day ----------

/** A passerby who stopped at the stand (their maxPay >= price). */
export interface Arrival {
  id: number;
  /** Milliseconds after opening, 0..dayLengthMs. */
  atMs: number;
  type: CustomerTypeId;
  maxPay: number;
  patienceMs: number;
  /** Fraction of the price tipped on a green serve. Carried here so the Rush never imports engine config. */
  tipRate: number;
}

/** Everything a day simulator needs. Built by planDay. */
export interface DayPlan {
  day: number;
  weather: Weather;
  news: NewsEvent;
  price: number;
  /** Stock at opening. */
  inventory: Inventory;
  /** Sorted by atMs. */
  arrivals: Arrival[];
  /** Everyone who walked by, including those who didn't stop. */
  passersby: number;
  /** Passersby who walked on because price > maxPay, by type. */
  tooExpensive: Record<CustomerTypeId, number>;
  dayLengthMs: number;
}

export type Bar = 'green' | 'yellow' | 'red';

export interface ServedRecord {
  arrivalId: number;
  type: CustomerTypeId;
  /** The price paid (excludes tip). */
  paid: number;
  tip: number;
  /** Patience bar color at the moment the serve completed. */
  bar: Bar;
  atMs: number;
}

/** What happened during the day. Produced by a day simulator. */
export interface DayOutcome {
  served: ServedRecord[];
  /** Ran out of patience: no payment, no stock used. */
  walkouts: number;
  /** Arrived when every spot was taken. */
  noRoom: number;
  /** Waiting or yet to arrive when the stand sold out. */
  soldOutMisses: number;
  soldOutAtMs: number | null;
  /** Still waiting when the stand closed at 5pm. Not walkouts; excluded from the service rating. */
  leftAtClose: number;
  /** Glasses' worth of lemonade made but never served (left in the jug or in hand at day end) and poured out. */
  pouredOut: number;
  /**
   * Stock consumed. Filling the jug uses lemons + sugar immediately (one of each per glass it holds);
   * each served glass uses 1 ice + 1 cup when the serve completes.
   */
  used: Inventory;
}

/** Turns a plan into an outcome. autoServe (engine) and the Rush (mini-game) are interchangeable. */
export type DaySimulator = (plan: DayPlan) => DayOutcome;

export interface DayReport {
  day: number;
  /** What Walt said this morning about today. */
  forecast: ForecastDay;
  weather: Weather;
  news: NewsEvent;
  price: number;
  passersby: number;
  stopped: number;
  tooExpensive: Record<CustomerTypeId, number>;
  servedByBar: Record<Bar, number>;
  glassesSold: number;
  walkouts: number;
  noRoom: number;
  soldOutMisses: number;
  soldOutAtMs: number | null;
  leftAtClose: number;
  /** Glasses' worth of lemonade poured out at the end of the day. */
  pouredOut: number;
  revenue: number;
  tips: number;
  /** Shop spending this morning. */
  spent: number;
  /** revenue + tips - spent */
  profit: number;
  cashAfter: number;
  iceMelted: number;
  inventoryAfter: Inventory;
  /** 0–1. */
  serviceRating: number;
  popularityBefore: number;
  popularityAfter: number;
}

// ---------- Engine API ----------

export type BuyResult = { ok: true; state: GameState } | { ok: false; error: string };

export type GameAction =
  | { type: 'newGame'; seed: number; seasonDays?: number }
  | { type: 'buy'; item: Item; packIdx: number }
  | { type: 'setPrice'; price: number }
  | { type: 'finishDay'; plan: DayPlan; outcome: DayOutcome };

/** Implemented by src/core (exported as `engine`) and stubbed by src/fixtures.ts. */
export interface Engine {
  /** seasonDays defaults to the standard 30-day summer. */
  newGame(seed: number, seasonDays?: number): GameState;
  /** Packs on sale today for every item, with news price modifiers applied. */
  shopListing(state: GameState): Record<Item, Pack[]>;
  /** Never throws; rejects if cash is insufficient or the pack doesn't exist. */
  buy(state: GameState, item: Item, packIdx: number): BuyResult;
  /** Clamps to the allowed price range and rounds to cents. */
  setPrice(state: GameState, price: number): GameState;
  planDay(state: GameState): DayPlan;
  /** Perfect play: serve every arrival on green, in order, until stock runs out. */
  autoServe: DaySimulator;
  /** Applies the outcome, melts ice, updates popularity, advances the day, checks bankruptcy/season end. */
  endDay(state: GameState, plan: DayPlan, outcome: DayOutcome): { state: GameState; report: DayReport };
  glassesMakeable(inventory: Inventory): number;
  isBankrupt(state: GameState): boolean;
  /** Pure reducer over the functions above. A failed buy returns the state unchanged. */
  gameReducer(state: GameState, action: GameAction): GameState;
}
