// The balance report: `npm run sim` (sets BALANCE=1). Skipped in the normal test run.
// Plays every player model over many seeded seasons and prints the tables used in docs/BALANCE.md.

import { describe, it } from 'vitest';
import { DAY_LENGTH_MS, SEASON_DAYS, START_CASH } from './config';
import type { Player } from './sim';
import {
  PERFECT,
  capped,
  decentStrategy,
  formatDayByDay,
  formatReport,
  naiveStrategy,
  recklessStrategy,
  runSeasons,
  summarize,
} from './sim';

const SEEDS = Array.from({ length: Number(process.env.BALANCE_SEEDS ?? 300) }, (_, i) => i + 1);
/** Glasses a human can hand over in one day (see BALANCE.md: window Rush ≈ 10–14, side view ≈ 14–20). */
const CAPACITIES = [10, 14, 20];

function players(): Player[] {
  return [
    PERFECT,
    ...CAPACITIES.map((c) => capped(decentStrategy(c), c)),
    capped(decentStrategy(14, { slips: false }), 14),
    capped(naiveStrategy, 14),
    capped(naiveStrategy, 20),
    capped(recklessStrategy, 14),
  ];
}

describe.skipIf(!process.env.BALANCE)('balance report', () => {
  it('prints the season tables', () => {
    const out: string[] = [`Day length ${DAY_LENGTH_MS / 1000}s, start cash $${START_CASH}`, ''];
    for (const days of [SEASON_DAYS, 7]) {
      const listed = days === 7 ? [1, 3, 5, 7] : [1, 5, 10, 15, 20, 25, 30];
      const summaries = players().map((p) => summarize(p.name, runSeasons(p, SEEDS, days), { startCash: START_CASH, days: listed }));
      out.push(formatReport(summaries, `${days}-day season`));
      if (days === SEASON_DAYS) {
        for (const name of ['decent C=14', 'naive C=14', 'perfect (autoServe)']) {
          const s = summaries.find((x) => x.name === name);
          if (s) out.push(formatDayByDay(s));
        }
        // Is the price a real decision? A careful C=14 player who always prices off the best slider stop.
        const offsets = [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75];
        const sens = offsets.map((priceOffset) => {
          const p = capped(decentStrategy(14, { slips: false, priceOffset }), 14);
          return summarize(p.name, runSeasons(p, SEEDS, days), { startCash: START_CASH, days: listed });
        });
        out.push(formatReport(sens, 'Price sensitivity: careful C=14, always priced off the best slider stop'));
      }
    }
    process.stdout.write(`${out.join('\n')}\n`);
  }, 300_000);
});
