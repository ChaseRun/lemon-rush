# Balance: Lemon Rush economy

> **Current config = the play-test version (§0).** After play-testing the side-view Rush, the designer asked for a busier street. Traffic, starting popularity and the drift anchor went back near the old values; the 90 s day, the $2 nightly rent, dearer ice, and popularity-driven pay and traffic stay. Sections 3–7 document the **first pass** (a quiet street: 16 base traffic, popularity starting at 0). They explain each lever and why it exists.
>
> Reproduce: `npm run sim` (300 seeds × every player model, about 10 s). Code: `src/core/sim.ts`. Guards: `src/core/sim.test.ts`.

## 0. Play-test feedback: busier crowd (current config)

**What happened.** In the real-time side-view Rush, the first pass's quiet street (about 9 customers a day early on) felt dead: you stood at the counter waiting with nobody coming. A spreadsheet can't show that; play-testing did. The fix is to bring the crowd back and let the **challenge come from serving speed and the daily rent rather than an empty street**. With 25+ people stopping and room to serve about 14, the price has to ration the line. Too cheap means walkouts and a falling rating; too dear means a quiet day.

| Knob | Original | First pass | **Now** |
|---|---|---|---|
| `DEMAND.baseTraffic` | 40 | 16 | **36** |
| `START_POPULARITY` / `POPULARITY.anchor` | 20 / 20 | 0 / 0 | **20 / 20** |
| `DEMAND.popularityPayAt0` (+0.008/pt) | (none) | 0.8 | **0.84**, so ×1.0 at popularity 20 and day 1 prices feel like the original |
| `DAY_LENGTH_MS`, rent, ice, traffic/pt, changeScale, drift | 120 s, none, $1/$2/$3, 0.01, 20, 0.05 | 90 s, $2, $1.50/$3/$4.50, 0.015, 15, 0.03 | **unchanged from first pass** |

**Results (300 seeds × 30 days; medians, [p10–p90] in brackets)**

| Player | Original | First pass | **Now: final** | **Now: profit/day, days 1–5 / 6–20 / 21–30 (good days)** | Now: bankrupt |
|---|---|---|---|---|---|
| perfect (autoServe) | $2,144 | $1,310 | **$3,618** [$3,172–$4,089] | $63 / $129 / $137 ($76 / $163 / $173) | 0% |
| decent C=10 | $654 | $531 | **$731** [$618–$838] | $18 / $24 / $27 ($20 / $27 / $30) | 0% |
| decent C=14 | $813 | $704 | **$1,010** [$866–$1,153] | $22 / $33 / $39 ($25 / $38 / $44) | 1% |
| decent C=20 | $1,131 | $984 | **$1,545** [$1,349–$1,721] | $32 / $51 / $61 ($38 / $59 / $69) | 1% |
| naive C=14 | $547 | $378 | **$457** [$409–$492] | $13 / $15 / $15 | 1% |
| naive C=20 | $839 | $596 | **$774** | $23 / $26 / $26 | 1% |
| reckless C=14 | $1 (76% bk) | $0 (80% bk) | **$0** | about $0 | **76%** (median day 10) |

Decent C=14, day by day: the price climbs **$2.25 → $3.00 (day 5) → $3.50 (day 10) → $4.00 (day 20+)**. There are about 14–15 stoppers every day (the player prices to what they can serve). Popularity goes 24 → 51 (day 10) → 85 (day 30).

**What this costs against the original goals. The designer should know:**
- **The slow start is mostly gone.** Days 1–5 now pay about $22/day (target $3–10). Growth is still there (+75% from early to late, via popularity → pay), but the curve starts high.
- **Naive and decent players almost never go bankrupt (1%).** With 50+ passersby, even a $2 price sells about 13 glasses a day. Only spend-everything play loses (76%). The $2 rent alone doesn't create risk at this traffic level.
- **Uncapped auto-serve is now very generous ($3,618).** It sells to 39 people a day. If Auto-serve stays a button players can press every day, it beats playing the Rush by about 3.5×. Consider capping auto-serve at a human-like C (e.g. reuse `cappedServe({ capacity: 14 })`), or making it cost popularity.
- **Savings goal (the remaining way to lose):** at **$750** for 30 days, decent C=14 makes it 99%, decent C=10 40%, naive C=14 0%, naive C=20 69%. At $1,000, decent C=14 is about a coin flip (median $1,010). For the 7-day week, at **$200**: decent C=14 39%, C=20 90%, naive 0%. (7-day medians: perfect $534, decent C=14 $190, C=10 $146, naive $118; reckless 27% bankrupt.) Recommend **$750** (30 days) and **$150–200** (7 days).
- **Middle ground if the street feels too easy now:** `baseTraffic` 26–30 keeps the counter busy (about 18–22 stoppers at a fair price for a capped player) while bringing back some early tightness. One `npm run sim` checks it.

## 1. Goals (from the designer)

| Phase | Target for a decent player | Feel |
|---|---|---|
| Days 1–5 | **$3–10/day** on good weather | Money is tight; a bad call (ice before rain, overpricing) stings |
| Days 6–20 | **$15–35/day** | Growth: popularity builds, bulk packs become affordable |
| Days 21–30 | **$35–70/day** on good days | The payoff |
| End of season | decent **$400–900**, naive **$100–300**, perfect clearly higher but not absurd | |
| Losing | decent ~5–10%, naive ~20–30%, reckless 40%+ bankrupt | Players should lose sometimes |

Other goals: the right price is a real decision every day; a day takes 60–90 s; fewer people per day (about 6–10 early), so each customer matters.

## 2. Method: the simulator

`src/core/sim.ts` drives the **real engine** (`newGame → buy/setPrice → planDay → serve → endDay`) with scripted players over many seeds. It has no new dependencies and is deterministic like the rest of the engine.

**Why a capacity cap matters.** `autoServe` serves everyone instantly, but a person playing the Rush can't. If you balance for autoServe, cheap prices always win. With a real speed limit, extra customers become walkouts and no-room misses, which hurts popularity. `cappedServe({ capacity: C })` models that:
- One server, first come first served, **3 waiting spots**.
- Each hand-over takes `dayLength / C × U(0.65, 1.35)`, plus a 2.5 s minimum from arrival (glass already poured, walk over, 0.8 s serve).
- Patience comes from the customer type. The bar color comes from patience left at hand-over (green > 60%, red < 30%), and tips follow it.
- A customer whose patience runs out first **walks out**. An arrival who finds all spots full is a **no-room** miss. The jug rule and sold-out rule are exactly the engine's.

**Capacities.** At a 90 s day: the window style serves 1 customer every 6–8 s, so **C ≈ 10–14**; the side view can serve **C ≈ 14–20**. I balanced for **C = 14** and checked that C = 10 is still viable.

| Player | Morning | Serving |
|---|---|---|
| **perfect** | Prices to the nickel on today's forecast to maximise expected profit, buys expected stoppers + 10%, buys bulk when cash allows, stays shut on a forecast storm | autoServe (uncapped) |
| **decent C** | Reads the forecast and stays shut on a storm. Prices on the $0.25 slider so expected stoppers ≈ C, buys about that many glasses (never more than C), and buys big packs once cash allows. **Human slips:** half the days the price is one slider step off, buys up to 40% extra, and grabs bulk with only a $3 cushion | capped C |
| **careful C** | Same as decent, without the slips (bulk only with a $10 cushion) | capped C |
| **naive** | Always $2. Every morning tops up any item below 25 with a medium pack (scarcest first), ignoring the forecast | capped C |
| **reckless** | Always $2. Spends every cent each morning: full sets at the biggest affordable tier, then small packs with the change | capped 14 |

Players plan with `expectedStoppers()` (new in `demand.ts`). It's exactly what the Morning screen can show: expected traffic × the chance each type's limit is at least your price.

## 3. First pass: before vs after (300 seeds × 30 days)

"Before" uses the old config (120 s day, the same per-day capacities). "After" is the new config. Values are medians, with [p10–p90] in brackets.

**Final cash and bankruptcy**

| Player | Before: final | Before: bankrupt | **After: final** | **After: bankrupt** |
|---|---|---|---|---|
| perfect (autoServe) | $2,144 [$1,868–$2,386] | 1% | **$1,310** [$1,106–$1,501] | 0% |
| decent C=10 | $654 | 0% | **$531** [$441–$615] | 0% |
| decent C=14 | $813 | 0% | **$704** [$579–$807] | 0% |
| decent C=20 | $1,131 | 0% | **$984** [$825–$1,124] | 0% |
| naive C=14 | $547 | 0% | **$378** (survivors ~$400) | **19%** |
| naive C=20 | $839 | 0% | **$596** | **19%** |
| reckless C=14 | $1 | 76% | **$0** | **80%** |

**Profit per day by phase (decent C=14; in brackets: sunny or partly cloudy days only)**

| | Days 1–5 | Days 6–20 | Days 21–30 | Shape |
|---|---|---|---|---|
| Before | $23 ($27) | $28 ($32) | $27 ($30) | Flat: rich from day 1, never improves |
| **After** | **$8 ($11)** | **$23 ($28)** | **$30 ($36)** | Slow start, then growth |
| After, C=10 | $8 ($11) | $17 ($20) | $21 ($25) | Slower, still viable |
| After, C=20 | $10 ($14) | $32 ($40) | $43 ($54) | Fast servers earn the payoff |
| After, perfect | $13 ($17) | $43 ($55) | $58 ($73) | |

**Cash curve (median), decent C=14**

```
        day:   1     5     10    15    20    25    30
before:       $39  $137  $273  $412  $550  $693  $813   ▁▁▁▂▂▂▂▃▃▃▃▄▄▄▄▅▅▅▅▆▆▆▆▇▇▇▇███  (straight line)
after:        $14   $61  $145  $266  $404  $554  $704   ▁▁▁▁▁▂▂▂▂▂▃▃▃▃▄▄▄▄▅▅▅▆▆▆▆▇▇▇██  (bends upward)
profit/day after:  ▁▃▄▆▄▅▅▅▅▆▆▆▇▇▇▇▇█▇█████████▇█
```

**What a decent C=14 player sees, day by day (medians)**

| Day | 1 | 3 | 4 (July 4th) | 7 | 10 | 15 | 20 | 25 | 30 |
|---|---|---|---|---|---|---|---|---|---|
| Price | $1.75 | $1.75 | $2.50 | $2.25 | $2.75 | $3.00 | $3.25 | $3.50 | $3.25 |
| Stoppers | 7 | 8 | 13 | 11 | 13 | 13 | 13 | 13 | 13 |
| Popularity | 7 | 20 | 22 | 36 | 47 | 61 | 74 | 84 | 92 |
| Profit | −$6 (stocking up) | $10 | $24 | $17 | $21 | $28 | $32 | $33 | $32 |

The price climbs from $1.75 to $3.50 as the stand gets popular. That's the progression you can feel.

**Is the price a real decision? (careful C=14, always priced off the best slider stop)**

| Price vs. best | −$0.75 | −$0.50 | −$0.25 | best | +$0.25 | +$0.50 | +$0.75 |
|---|---|---|---|---|---|---|---|
| Final cash | $282 | $465 | $585 | $721 | $761 | $657 | $460 |
| Bankrupt | 0% | 0% | 0% | 0% | 1% | 3% | **22%** |

Too cheap floods the counter: walkouts, lost popularity and thin margins. Too dear empties the street and can sink you early. Missing by one $0.25 step is forgiving. (The planner's "best" sits about $0.25 low because it ignores tips and popularity, so pricing a notch high pays.)

## 4. Every change in the first pass, why, and its effect (see §0 for what play-testing reverted)

| Change (old → new) | Why | Effect |
|---|---|---|
| `DAY_LENGTH_MS` 120 000 → **90 000** | A day should take 60–90 s. It also matches the C=10–14 window pace | 30 days × (90 s Rush + ~30 s morning/report) ≈ **60 min** per summer; the 7-day quick week ≈ 15 min |
| `DEMAND.baseTraffic` 40 → **16** | Fewer people, so each one matters and the count fits human serving speed | Day 1: 18 walk by, **~9 stop** at $1.75 (was 54 and 31) |
| `START_POPULARITY` 20 → **0** | Nobody knows a brand-new stand | Slow start; popularity becomes something you build |
| `POPULARITY.changeScale` 20 → **15**, `drift` 0.05 → **0.03**, `anchor` 20 → **0** | The old popularity hit 100 by day 12 for good play, then the game stopped changing | Decent C=14: popularity 7 → 47 (day 10) → 74 (day 20) → 92 (day 30). Growth all summer |
| `DEMAND.popularityTrafficPerPoint` 0.01 → **0.015** | Popularity should visibly bring more people | ×2.2 foot traffic at popularity 80 |
| **New lever** `DEMAND.popularityPayAt0` **0.8**, `popularityPayPerPoint` **0.008** ("people pay more at a popular stand": limit × (0.8 + 0.008·pop)) | With a capacity cap, more people only helps if they'll pay more. This is what makes the late game pay | ×0.8 at a new stand, ×1.2 at 50, ×1.6 at 100. The decent price goes $1.75 → $3.50 |
| **New lever** `DAILY_COST` **$2/night** ("Mom's table rent"), charged in `endDay`, never below $0, included in `report.spent` | A fixed cost makes early days tight and late days fat, and gives a reason to lose | About 25% of an early day's takings, about 5% of a late one. Idle stands go under in a week |
| `PACKS.ice` 10/25/50 for $1/$2/$3 → **$1.50/$3.00/$4.50** | Overbuying ice before rain should sting | A wasted 25-pack costs $3, about half an early day's profit |

Engine changes are small and tested: `popularityPayFactor`, `typicalMaxPay`, `maxPayRange`, `stopChance` and `expectedStoppers` in `demand.ts`, and the daily cost in `endDay`. The contract is unchanged. Neutral values (`popularityPayAt0: 1`, `perPoint: 0`, `DAILY_COST 0`) reproduce the old game exactly; that's how the "before" numbers were measured.

## 5. What drives the progression

1. **Popularity → willingness to pay** (new). This is the main late-game lever. With a capped server you can't sell many more glasses, so you sell the same ~13 for more.
2. **Popularity → foot traffic.** More people means you can raise the price and still fill your counter.
3. **Service quality → popularity.** Pricing so cheap that you can't keep up causes walkouts, which drag the rating down. The cap makes this bite.
4. **Bulk packs.** The per-glass cost goes from $0.70 (small) to $0.45 (large), but large packs need spare cash. That's affordable from about day 6.
5. **The fixed $2 rent** shrinks from 25% to 5% of a day's takings as revenue grows.
6. *(Not modelled: players getting faster at the Rush. In real play, C rises over the summer, which adds to the curve.)*

## 6. Losing, and the savings goal (first pass)

**Bankruptcy targets: partly met.** Naive 19% (target 20–30%) ✓, reckless 80% (40%+) ✓, **decent 0% (target 5–10%) ✗.**

Why decent players almost never go under: ice is the only thing that must be rebought, a small ice pack is $1.50, and leftover lemons, sugar and cups carry over. A sensible player can always shrink to a tiny day and ride out bad weather. The 4th of July (day 4: traffic ×2, pay ×1.2) also rescues the riskiest stretch. I measured the trade-off (120 seeds, decent C=14):

| Start cash | Rent | Weather | Decent bankrupt | Naive bankrupt | Reckless | Decent final |
|---|---|---|---|---|---|---|
| **$20** | **$2** | normal | **0%** | **21%** (day 2–3) | 81% | $709 |
| $20 | $2.50 | normal | 0% | 25% | 81% | $694 |
| $15 | $2 | normal | 1% | 47% | 80% | $702 |
| $15 | $3 | normal | 4% | 58% | 82% | $673 |
| $15 | $2 | harsh (rain ×0.2, cloudy ×0.6, storms 8%) | 3% | 62% | 94% | $617 |

Any setting that pushes decent bankruptcy toward 5% makes naive players die on **day 2** more than half the time, which is a bad first experience. **Recommendation: keep $20 / $2, and make decent players lose through the savings goal instead.**

**Savings goal ("save $X for a new bike"): share of seasons that reach it**

| 30-day summer | ≥$300 | **≥$500** | ≥$600 | ≥$750 |
|---|---|---|---|---|
| perfect | 100% | 100% | 100% | 100% |
| decent C=20 | 100% | 100% | 100% | 96% |
| decent C=14 | 100% | **99%** | 86% | 28% |
| decent C=10 | 100% | **66%** | 14% | 0% |
| naive C=20 | 81% | 79% | 47% | 0% |
| naive C=14 | 79% | **0%** | 0% | 0% |
| reckless | 0% | 0% | 0% | 0% |

→ **Recommend $500 for 30 days.** Naive players at window speed never make it, a slow server (C=10) misses it 1 time in 3, and a typical player makes it but has to play well. Choose **$600** if the designer wants typical (C=14) players to miss about 1 time in 7.

| 7-day quick week | ≥$50 | **≥$75** | ≥$100 |
|---|---|---|---|
| perfect | 100% | 96% | 84% |
| decent C=20 | 98% | 90% | 70% |
| decent C=14 | 96% | **83%** | 44% |
| decent C=10 | 97% | 66% | 14% |
| naive C=14 | 74% | **37%** | 6% |
| reckless | 0% | 0% | 0% |

→ **Recommend $75 for the quick week.**

## 7. The 7-day quick week (first pass; current numbers in §0)

The week is the "slow start" part of the curve, by design: weather peaks mid-week (the curve spans the chosen length) and the 4th of July lands on day 4.

| Player | Final median [p10–p90] | Bankrupt | Profit/day, days 1–3 → 4–7 |
|---|---|---|---|
| perfect | $141 [$91–$181] | 0% | $6 → $25 |
| decent C=14 | $97 [$66–$124] | 0% | $4 → $16 |
| decent C=10 | $82 [$58–$102] | 0% | $3 → $13 |
| naive C=14 | $70 [$1–$95] | 16% | $2 → $11 |
| reckless | $12 | 37% | |

It's short, tight and readable: you finish with $70–$140 and see the first taste of growth. That's fine for quick play and testing.

## 8. Remaining issues and next steps

- **Decent bankruptcy is ~0%** (see §6). If the designer insists on it, the cleanest lever is $15 start cash with $3 rent, but that accepts ~55% naive bankruptcies on day 2. I'd ship the savings goal instead.
- **Naive bankruptcies come early** (median day 3): a $2 price at a stand nobody knows, plus a medium set every day. The Morning screen can soften this. Show "expected stoppers" (`expectedStoppers()` is exported for it) and the rent on the money line.
- **Late game for C=14 sits at the bottom of the target** ($36 on good days vs $35–70). C=20 lands mid-range ($54). If playtests show window players at C≈12, raise `popularityPayPerPoint` 0.008 → 0.009.
- **The capped server is a model, not the Rush.** Next step: a bot that plays `rushRules`/`windowRules` at human-like speed to measure the real C, then re-run `npm run sim`.
- **Rush timing recommendations** (not edited; src/rush and src/window aren't mine):
  - Both styles read `plan.dayLengthMs`, so the 90 s day applies automatically.
  - **Window style:** with 1 window and a line of 4 at ~7 s per customer, the third person in line waits ~14 s, longer than a jogger's 12 s patience. Drain patience **at half speed while in line** (full speed at the window), or scale patience ×1.25 for the window style. Otherwise joggers walk out on any busy day.
  - **Side view:** 3 spots and the current timings fit C≈14–20; no change needed.
  - The early game has only ~1 customer every 10 s. The Rush should feel calm then, which is fine (a natural tutorial). Busy days come with popularity.

## 9. For the integrator

- The Morning screen's price ruler (`ui/screens/shared.ts` `willingness`) uses basePay × heat × news only. It should also multiply by `popularityPayFactor(game.popularity)`, or simply call the exported `maxPayRange`/`stopChance`/`expectedStoppers`. Without this, the bars are wrong by ×0.8–1.6.
- Show **Mom's $2 rent** (`config.DAILY_COST`) on the Morning/Report money lines. `report.spent` already includes it.
- The Rules page reads config, so it updates itself. Its "Pays up to … at 80°F" line describes a popularity-50 stand (×1.2 now). Consider labelling it "at popularity 50" or using `maxPayRange`.
