// Public surface of the engine. src/engine.ts switches the app to `engine` at integration.

import type { Engine } from '../contract';
import { autoServe, endDay, planDay } from './day';
import { glassesMakeable } from './inventory';
import { gameReducer } from './reducer';
import { buy, shopListing } from './shop';
import { isBankrupt, newGame, setPrice } from './state';

export const engine: Engine = {
  newGame,
  shopListing,
  buy,
  setPrice,
  planDay,
  autoServe,
  endDay,
  glassesMakeable,
  isBankrupt,
  gameReducer,
};

export { autoServe, endDay, planDay } from './day';
export {
  CUSTOMER_TYPE_IDS,
  expectedFootTraffic,
  generateDemand,
  heatBonus,
  popularityFactor,
  temperatureFactor,
  zeroByType,
} from './demand';
export { emptyInventory, glassesMakeable } from './inventory';
export { roundCents, toCents } from './money';
export { newsPriceMultiplier, rollNews } from './news';
export { serviceRating, updatePopularity } from './popularity';
export { gameReducer } from './reducer';
export { createRng, mulberry32, rngFor } from './rng';
export type { Rng } from './rng';
export { buy, cheapestPack, packsFor, shopListing } from './shop';
export { isBankrupt, newGame, restockCost, rollSeason, setPrice } from './state';
export { forecast, forecastDay, rollWeather, seasonalBaseTempF } from './weather';
export * as config from './config';
