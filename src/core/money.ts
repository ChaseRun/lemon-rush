// Money helpers. Cash is stored in dollars but always rounded to whole cents,
// and comparisons are done in integer cents so float noise (0.1 + 0.2) never
// decides whether a purchase goes through.

/** Tiny nudge so values like 4.375 (stored as 4.37499999…) round half-up as a human expects. */
const HALF_UP_NUDGE = 1e-6;

/** Dollars → integer cents, rounding half up. */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100 + HALF_UP_NUDGE);
}

/** Rounds a dollar amount to the nearest cent (half up). */
export function roundCents(dollars: number): number {
  return toCents(dollars) / 100;
}

/** Sum of dollar amounts, computed in cents. */
export function sumCents(amounts: readonly number[]): number {
  return amounts.reduce((cents, a) => cents + toCents(a), 0) / 100;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
