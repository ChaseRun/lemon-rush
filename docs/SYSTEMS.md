# Systems: how the engine works

The engine in `src/core/` is plain TypeScript. It has no React, no DOM, no `Math.random()` and no clock, so the same seed and the same choices always produce the same season. Every number lives in `src/core/config.ts`. The logic files only hold formulas.

```
newGame(seed) ─► GameState ─► buy / setPrice ─► planDay ─► DayPlan ─► autoServe | Rush ─► DayOutcome ─► endDay ─► GameState + DayReport
```

## Randomness: `rng.ts`
- **mulberry32** PRNG. `rngFor(seed, day, purpose)` hashes `"seed|day|purpose"` (FNV-1a plus a murmur3 finalizer) into a fresh stream.
- The streams are `news`, `sky`, `temp`, `demand`, `extraArrivals` and `forecast0/1/2`. Each one is independent, so adding a roll to one system never changes another system's numbers.

## Formulas and where they live

| Rule | Formula | File: function |
|---|---|---|
| Season roll | All 30 days of news are rolled first, then weather (it needs the Heatwave bonus) | `state.ts`: `rollSeason`, `newGame` |
| Temperature | `round(78 + 10·sin(π·(day−1)/29) + U(−8, 8) + news.tempBonusF)`, clamped to 60–100°F | `weather.ts`: `rollWeather`, `seasonalBaseTempF` |
| Sky | Weighted pick: 35 / 25 / 20 / 15 / 5 | `weather.ts`: `rollSky` |
| Forecast | Sky is right with p = 0.85 / 0.65 / 0.50, otherwise one step off on the sunny→storm ladder. Temperature = actual + an integer in U[−2,2] / [−5,5] / [−8,8] | `weather.ts`: `forecastDay`, `forecast` |
| News | Weighted pick from `NEWS_TABLE`. Day 4 is always the 4th of July | `news.ts`: `rollNews` |
| Shop price | `round¢(pack.price × news.priceMultipliers[item])` | `shop.ts`: `packsFor`, `shopListing` |
| Buy | Rejected if `price¢ > cash¢`. Otherwise cash −= price, spentToday += price, stock += size | `shop.ts`: `buy` |
| Foot traffic | `round(36 × tempFactor × sky × news.traffic × (1 + 0.015·popularity))` | `demand.ts`: `expectedFootTraffic`, `popularityFactor` |
| Temperature factor | `0.5 + (T − 60)/40` | `demand.ts`: `temperatureFactor` |
| Limit ("most I'll pay") | `round¢(basePay × (0.8 + 0.4·(T − 60)/40) × (0.84 + 0.008·popularity) × news.maxPay × U(0.8, 1.2))` | `demand.ts`: `rollMaxPay`, `typicalMaxPay`, `heatBonus`, `popularityPayFactor` |
| Expected stoppers | `traffic × Σ share × P(limit ≥ price)`, limits uniform over `typical × (1 ± 0.2)`, plus news extras. What a player can work out on the Morning screen | `demand.ts`: `maxPayRange`, `stopChance`, `expectedStoppers` |
| Stops? | `price ≤ limit`, otherwise `tooExpensive[type]++` | `demand.ts`: `willStop`, `generateDemand` |
| Arrival times | Stopper i of n arrives at `(i + 0.5)/n × dayLengthMs`. Street-crew extras all arrive at 3/8 of the day (noon) | `demand.ts`: `generateDemand` |
| Jug rule | Lemonade is made in jugs of `JUG_CAPACITY` (10). Filling a jug uses `fill` lemons + `fill` sugar **immediately**. Each served glass takes one from the jug plus 1 cup + 1 ice. Lemonade left in the jug at day end is poured out (`pouredOut`) | `day.ts`: `autoServe` (the Rush has its own copy) |
| Auto-serve | Serve arrivals in order, on green. When the jug is empty and a glass is needed, fill `min(10, lemons, sugar)`. Sold out when the jug is empty and lemons or sugar can't refill it, **or** cups or ice are out; the rest are sold-out misses. Tip = `price × tipRate`. `used` = {lemons, sugar: filled; cups, ice: served}, and `pouredOut = filled − served` | `day.ts`: `autoServe` |
| Glasses makeable | `min(lemons, sugar, ice, cups)`: the most glasses the stock could sell (a partial jug can always be filled) | `inventory.ts`: `glassesMakeable` |
| Service rating | Average of green 1, yellow 0.7, red 0.4, no room 0.3, sold out 0.2, walkout 0. If nobody stopped, 0.5 | `popularity.ts`: `serviceRating` |
| Popularity | `p += (r − 0.5)·15`, then `p += (20 − p)·0.03`, clamped to 0–100 | `popularity.ts`: `updatePopularity` |
| Night | Cash += revenue + tips − `DAILY_COST` (never below $0; `report.spent` = this morning's shopping + the rent actually charged), stock −= `used` (which already counts the poured-out lemons and sugar), all ice melts, meters update, report (with `pouredOut` and `leftAtClose`), next day, status | `day.ts`: `endDay` |
| Bankrupt | `glassesMakeable = 0` **and** cash < the sum of the cheapest packs of every missing item at that day's prices | `state.ts`: `isBankrupt`, `restockCost` |
| Price | Clamped to $0.50–$5.00 and rounded to cents | `state.ts`: `setPrice` |

Money is stored in dollars but rounded to whole cents, and comparisons are made in integer cents (`money.ts`), so a purchase is never decided by float noise.

## Tuning knobs (`src/core/config.ts`)

| Knob | Value | What raising it does |
|---|---|---|
| `START_CASH` | $20 | An easier start, with fewer early bankruptcies |
| `START_POPULARITY` | 20 | A faster start: more people, paying more, from day 1 |
| `DAILY_COST.amount` | $2 (Mom's table rent) | Tighter early days and more bankruptcies; barely matters late |
| `PACKS[item][i].price` | see GAME_DESIGN §3 (ice 10/$1.50, 25/$3, 50/$4.50) | Lower margins. The bulk discount (big packs) matters more |
| `DEMAND.baseTraffic` | 36 | More customers every day. Speed in the Rush becomes the bottleneck sooner |
| `DEMAND.tempFactorPerDegree` | 1/40 | Hot days matter more for traffic. The forecast becomes more valuable |
| `DEMAND.heatBonusPerDegree` | 0.4/40 | Hot days support higher prices |
| `DEMAND.maxPayJitter` | 0.2 | A wider spread of limits. The demand curve gets flatter, so price matters less sharply |
| `DEMAND.popularityTrafficPerPoint` | 0.015 | Good service compounds faster into foot traffic |
| `DEMAND.popularityPayAt0` | 0.84 (×1.0 at popularity 20) | A new stand can charge more; a flatter progression |
| `DEMAND.popularityPayPerPoint` | 0.008 | A popular stand can charge more; the late game pays off harder |
| `CUSTOMER_TYPES[t].share` | 35/25/20/20% | More of that type walk by |
| `CUSTOMER_TYPES[t].basePay` | $1.25–$3.00 | That type accepts higher prices |
| `CUSTOMER_TYPES[t].patienceMs` | 12–25 s | That type waits longer in the Rush (fewer walkouts) |
| `CUSTOMER_TYPES[t].tipRate` | 0–30% | Bigger tips from that type on green and yellow serves |
| `TIP_MULTIPLIER_BY_BAR` | 1 / 0.5 / 0 | Slow (yellow or red) serves cost less in tips |
| `SKY_TABLE[sky].weight` | 35/25/20/15/5 | That sky shows up more often |
| `SKY_TABLE[sky].traffic` | 1.0–0 | Less punishment for bad weather |
| `TEMPERATURE.noise` | ±8°F | More day-to-day swing. The forecast becomes more useful |
| `FORECAST_ACCURACY[lead].skyCorrect` | 0.85/0.65/0.50 | A more trustworthy forecast and less risk in buying ahead |
| `FORECAST_ACCURACY[lead].tempErrorF` | 2/5/8 | A noisier temperature forecast |
| `NEWS_TABLE[i].weight` | 50/12/10/10/10/8 | That headline shows up more often |
| `JULY_4TH` multipliers | traffic ×2, limits ×1.2 | A bigger holiday spike, which rewards stocking up |
| `SERVICE_WEIGHTS.*` | 1/0.7/0.4/0.3/0.2/0 | That outcome hurts popularity less |
| `POPULARITY.changeScale` | 15 | Popularity swings faster on good and bad days |
| `POPULARITY.drift` | 0.03 | A stronger pull back to the anchor. Popularity is harder to bank |
| `POPULARITY.anchor` | 20 | Where popularity settles if service is merely average |
| `DAY_LENGTH_MS` | 90 000 | A longer Rush. Arrivals spread out, so it's easier (and a season takes longer to play) |
| `JUG_CAPACITY` | 10 | Fewer refills in the Rush, but more lemons and sugar poured out at day end |

## Choices the design doc leaves open
- **Temperatures are whole degrees.** The Heatwave +10°F is added before clamping, so it can hit the 100°F cap.
- **`soldOutAtMs` is when the stand could no longer produce a glass**: the time of the last serve, or 0 if the stand opened unable to make one. It is set even if nobody was left waiting. This matches the Rush, which ends the day the moment it sells out.
- **Customers still waiting at 5pm** (`leftAtClose`) are not rated. The rating averages only served customers, walkouts, no-room misses and sold-out misses.
- **Auto-serve fills a jug only when a customer needs it**, so waste comes only from the last jug of the day. It fills `min(10, lemons, sugar)` even when cups or ice would run out first; the extra is poured out.
- **Street-crew workers still check the price.** They count as passersby and can be "too expensive".
- **Bankruptcy uses tomorrow's prices** (for example, an Ice shortage tomorrow raises the bar). After day 30 the status is `'finished'` even if you couldn't restock.
- **When the game ends, `day` still advances** (`31` when finished). The day you went under is `history.at(-1).day`.
- **The reducer ignores** a `finishDay` whose plan isn't for today (for example, a duplicate dispatch), and every action except `newGame` once the game is over.

## Balance simulator: `sim.ts`
`npm run sim` plays scripted players (perfect, decent, careful, naive, reckless) over 300 seeded seasons through the real engine and prints cash curves, profit per phase, bankruptcy and savings-goal rates. `cappedServe({ capacity })` is a human-speed stand-in for the Rush (one server, 3 spots, patience, walkouts), so balance is judged at what a person can actually serve. `sim.test.ts` holds loose guards on the balance goals. Results and reasoning: `docs/BALANCE.md`.
