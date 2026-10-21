// Actual weather and Walt's forecast (GAME_DESIGN §4).
//
// The whole season's weather is rolled up front in newGame, so the forecast is a
// noisy *view* of a fixed future rather than a prediction the engine has to honour.

import type { ForecastDay, GameState, NewsEvent, Sky, Weather } from '../contract';
import { SKY_LADDER } from '../contract';
import { FORECAST_ACCURACY, SEASON_DAYS, SKY_TABLE, TEMPERATURE } from './config';
import { clamp } from './money';
import { rngFor } from './rng';

/** Seasonal curve without noise: 78°F on day 1, peaking at 88°F mid-month, back to 78°F on day 30. */
export function seasonalBaseTempF(day: number, seasonDays: number = SEASON_DAYS): number {
  const phase = seasonDays > 1 ? (Math.PI * (day - 1)) / (seasonDays - 1) : Math.PI / 2;
  return TEMPERATURE.base + TEMPERATURE.amplitude * Math.sin(phase);
}

export function clampTempF(tempF: number): number {
  return clamp(tempF, TEMPERATURE.min, TEMPERATURE.max);
}

export function rollSky(seed: number, day: number): Sky {
  return rngFor(seed, day, 'sky').pickWeighted(SKY_LADDER, (sky) => SKY_TABLE[sky].weight);
}

/**
 * The day's real weather. News temperature effects (Heatwave +10°F) are baked in here,
 * so the forecast, demand and report all see the same number. Whole degrees, 60–100°F.
 */
export function rollWeather(seed: number, day: number, news: NewsEvent, seasonDays: number = SEASON_DAYS): Weather {
  const noise = rngFor(seed, day, 'temp').float(-TEMPERATURE.noise, TEMPERATURE.noise);
  const tempF = clampTempF(Math.round(seasonalBaseTempF(day, seasonDays) + noise + news.tempBonusF));
  return { sky: rollSky(seed, day), tempF };
}

/** Moves one step along the sunny → storm ladder; at either end the only neighbour is inward. */
function neighbourSky(sky: Sky, goWorse: boolean): Sky {
  const i = SKY_LADDER.indexOf(sky);
  if (i === 0) return SKY_LADDER[1];
  if (i === SKY_LADDER.length - 1) return SKY_LADDER[i - 1];
  return SKY_LADDER[goWorse ? i + 1 : i - 1];
}

/**
 * Walt's guess about `day`, made `lead` days ahead (0 = today, 1 = tomorrow, 2 = day after).
 * Sky is right with probability FORECAST_ACCURACY[lead].skyCorrect, else off by exactly one step.
 * Temperature is off by a whole number of degrees within ±tempErrorF.
 */
export function forecastDay(seed: number, day: number, lead: number, actual: Weather): ForecastDay {
  const accuracy = FORECAST_ACCURACY[lead];
  if (!accuracy) throw new Error(`No forecast accuracy for lead ${lead}`);
  const rng = rngFor(seed, day, `forecast${lead}`);
  const sky = rng.chance(accuracy.skyCorrect) ? actual.sky : neighbourSky(actual.sky, rng.chance(0.5));
  const tempF = clampTempF(actual.tempF + rng.int(-accuracy.tempErrorF, accuracy.tempErrorF));
  return { day, sky, tempF, confidence: accuracy.confidence };
}

/** This morning's forecast: today, tomorrow and the day after (fewer near season end). */
export function forecast(state: Pick<GameState, 'seed' | 'day' | 'weather'>): ForecastDay[] {
  const days: ForecastDay[] = [];
  for (let lead = 0; lead < FORECAST_ACCURACY.length; lead++) {
    const day = state.day + lead;
    const actual = state.weather[day - 1];
    if (!actual) break; // past the end of this season
    days.push(forecastDay(state.seed, day, lead, actual));
  }
  return days;
}
