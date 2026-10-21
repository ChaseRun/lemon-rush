import { describe, expect, it } from 'vitest';
import type { Sky } from '../contract';
import { SKY_LADDER } from '../contract';
import { FORECAST_ACCURACY, SEASON_DAYS, SKY_TABLE, TEMPERATURE } from './config';
import { rollSeason } from './state';
import { newsById } from './testing';
import { forecast, forecastDay, rollWeather, seasonalBaseTempF } from './weather';

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

describe('seasonal temperature curve', () => {
  it('starts at 78°F, peaks near 88°F mid-month and returns to 78°F', () => {
    expect(seasonalBaseTempF(1)).toBeCloseTo(78);
    expect(seasonalBaseTempF(15.5)).toBeCloseTo(88);
    expect(seasonalBaseTempF(SEASON_DAYS)).toBeCloseTo(78);
  });
});

describe('rollWeather', () => {
  it('keeps temperatures whole and between 60 and 100°F, within ±8°F of the curve on quiet days', () => {
    const quiet = newsById('quiet');
    for (const seed of SEEDS.slice(0, 50)) {
      for (let day = 1; day <= SEASON_DAYS; day++) {
        const { tempF } = rollWeather(seed, day, quiet);
        expect(Number.isInteger(tempF)).toBe(true);
        expect(tempF).toBeGreaterThanOrEqual(TEMPERATURE.min);
        expect(tempF).toBeLessThanOrEqual(TEMPERATURE.max);
        expect(Math.abs(tempF - seasonalBaseTempF(day))).toBeLessThanOrEqual(TEMPERATURE.noise + 0.5);
      }
    }
  });

  it('a Heatwave adds +10°F to the same roll (capped at 100°F) and leaves the sky alone', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      for (const day of [1, 10, 15, 30]) {
        const normal = rollWeather(seed, day, newsById('quiet'));
        const hot = rollWeather(seed, day, newsById('heatwave'));
        expect(hot.tempF).toBe(Math.min(TEMPERATURE.max, normal.tempF + 10));
        expect(hot.sky).toBe(normal.sky);
      }
    }
  });

  it('sky frequencies match the 35/25/20/15/5 table', () => {
    const counts: Record<Sky, number> = { sunny: 0, partlyCloudy: 0, cloudy: 0, rain: 0, storm: 0 };
    let n = 0;
    for (const seed of SEEDS) {
      for (const w of rollSeason(seed).weather) {
        counts[w.sky]++;
        n++;
      }
    }
    for (const sky of SKY_LADDER) expect(counts[sky] / n).toBeCloseTo(SKY_TABLE[sky].weight / 100, 1);
  });

  it('season weather includes the news (heatwave days are hotter in GameState.weather)', () => {
    let checked = 0;
    for (const seed of SEEDS.slice(0, 100)) {
      const { news, weather } = rollSeason(seed);
      news.forEach((n, i) => {
        if (n.id !== 'heatwave') return;
        expect(weather[i]).toEqual(rollWeather(seed, i + 1, newsById('heatwave')));
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('forecast', () => {
  it('covers today, tomorrow and the day after with confidence labels', () => {
    const { weather } = rollSeason(5);
    const days = forecast({ seed: 5, day: 10, weather });
    expect(days.map((d) => d.day)).toEqual([10, 11, 12]);
    expect(days.map((d) => d.confidence)).toEqual(['pretty sure', 'thinks so', 'just guessing']);
  });

  it('shrinks near the end of the season', () => {
    const { weather } = rollSeason(5);
    expect(forecast({ seed: 5, day: 29, weather }).map((d) => d.day)).toEqual([29, 30]);
    expect(forecast({ seed: 5, day: 30, weather }).map((d) => d.day)).toEqual([30]);
    expect(forecast({ seed: 5, day: 31, weather })).toEqual([]);
  });

  it('is deterministic', () => {
    const { weather } = rollSeason(5);
    expect(forecast({ seed: 5, day: 7, weather })).toEqual(forecast({ seed: 5, day: 7, weather }));
  });

  it('sky accuracy over many seeds lands near 85% / 65% / 50%, and misses are one step off', () => {
    FORECAST_ACCURACY.forEach((accuracy, lead) => {
      let right = 0;
      let n = 0;
      for (const seed of SEEDS) {
        const { weather } = rollSeason(seed);
        for (let day = 1; day <= SEASON_DAYS; day++) {
          const actual = weather[day - 1];
          const guess = forecastDay(seed, day, lead, actual);
          n++;
          if (guess.sky === actual.sky) right++;
          else expect(Math.abs(SKY_LADDER.indexOf(guess.sky) - SKY_LADDER.indexOf(actual.sky))).toBe(1);
        }
      }
      expect(right / n).toBeGreaterThan(accuracy.skyCorrect - 0.02);
      expect(right / n).toBeLessThan(accuracy.skyCorrect + 0.02);
    });
  });

  it('temperature is within ±2 / ±5 / ±8°F of the actual', () => {
    FORECAST_ACCURACY.forEach((accuracy, lead) => {
      let maxError = 0;
      for (const seed of SEEDS.slice(0, 100)) {
        const { weather } = rollSeason(seed);
        for (let day = 1; day <= SEASON_DAYS; day++) {
          const err = Math.abs(forecastDay(seed, day, lead, weather[day - 1]).tempF - weather[day - 1].tempF);
          maxError = Math.max(maxError, err);
        }
      }
      expect(maxError).toBe(accuracy.tempErrorF); // reaches the edge but never passes it
    });
  });
});
