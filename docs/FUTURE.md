# Lemon Rush: What's Next

> v1 (`docs/GAME_DESIGN.md`) is deliberately small: one price, four supplies, one popularity meter, one mini-game. This doc covers what I'd build next and **where each idea plugs into the code**. Each idea lists: **what it is · the decision it adds · where it plugs in · effort (S/M/L) · risks**.

## How new features plug in

A day runs `planDay → DayPlan → simulator (autoServe | Rush) → DayOutcome → endDay`. Almost every idea below touches just one or two of these five places:

| Seam | Where | What changes there |
|---|---|---|
| **Config tables** | `src/core/config.ts` | Packs, customer types, news, and later upgrades and locations |
| **Plan the day** | `planDay` (`core/day.ts`) → `generateDemand` (`core/demand.ts`) | Foot traffic, who stops, each Arrival's patience |
| **Simulate the day** | `src/rush/rushRules.ts` or `autoServe` | Kid speed, prep time, spots, what the kid carries |
| **Close the day** | `endDay` (`core/day.ts`) | Money, ice melt, popularity, daily costs |
| **UI** | `src/ui/` | Shop, report, charts |

Two v1 rules make this work, and new features should keep them:
1. **The Rush never imports `src/core`.** Anything it needs travels inside the `DayPlan`, the way `Arrival.tipRate` does today.
2. **Every random roll has its own stream** (`rngFor(seed, day, purpose)`). A new system adds a new `RngPurpose`, so old seeds keep the same weather and demand, and old tests stay valid.

**Build order:** the balance sim (§10) first, because everything here is a tuning change and the payback numbers below are rough estimates until it checks them. Next, Upgrades (§1), the most decisions for the least code. Then Flyers (§2), which are small. Then Brad (§3), the biggest new decision and the biggest change.

---

## 1. Upgrades

**What:** one-time purchases in the morning shop, defined as data: `{ id, cost, modifiers[] }`. Each modifier adjusts a number that already exists, so **a new upgrade is a config row, not new code**.
**What it adds:** a second spending decision (supplies or growth?) and a reason to plan ahead. Each upgrade has a payback window, and the season is only 30 days.

```ts
// src/core/upgrades.ts (sketch)
export type Stat =
  | 'demand.traffic'    // × expectedFootTraffic           (Painted Sign, Flyers)
  | 'demand.sky.rain'   // replaces SKY_TABLE.rain.traffic (Umbrella)
  | 'arrival.patience'  // × Arrival.patienceMs in planDay (Boombox)
  | 'morning.ice'       // free ice added in endDay        (Freezer)
  | 'daily.upkeep'      // fixed cost charged in endDay    (Little Sibling)
  | 'rush.speed' | 'rush.prep' | 'rush.carry' | 'rush.spots' | 'rush.helpers'; // → DayPlan.rushMods

export type Modifier = { stat: Stat; op: 'set' | 'add' | 'mul'; value: number };

export interface Upgrade { id: string; name: string; cost: number; fixes: string; modifiers: Modifier[] }

/** Pure. Applies set → add → mul, so the order you bought things in never matters. */
export function resolve(stat: Stat, base: number, owned: readonly Upgrade[]): number;

// config.ts: a whole upgrade is one row
{ id: 'umbrella', name: 'Umbrella', cost: 12, fixes: 'Empty rainy days',
  modifiers: [{ stat: 'demand.sky.rain', op: 'set', value: 0.6 }] }
```

**The Rush stays separate:** `planDay` turns the `rush.*` stats into `DayPlan.rushMods` (`speedMul`, `prepMul`, `carry`, `extraSpots`, `helpers`), which are multipliers and counts. `createRush` applies them to its own `rushConfig.ts`. Core doesn't need the Rush's base numbers, and the Rush doesn't need to know about upgrades. Default `rushMods` give exactly v1, so the Rush tests don't change.

**Payback estimates** use GAME_DESIGN §11's Day 1 (about 54 passersby, 31 stop, 5 walkouts, 3 no-room) and about **$1.50 profit per extra glass** at $2.00. I assumed each glass takes about a 3s loop: 1.0s prep, 0.8s serve, about 1.2s walking.

| Upgrade | Cost | Effect | Plugs into | Payback (est.) |
|---|---|---|---|---|
| Roller Skates | $15 | Move ×1.5 | Rush rules (`rushMods.speedMul`) | ~4–5 days, busy days only |
| Boombox | $12 | Patience ×1.25 | `planDay` arrivals (`patienceMs`) | ~3–4 days, plus a better rating |
| Painted Sign | $15 | Foot traffic ×1.2 | demand (`expectedFootTraffic`) | ~2 days, *if* you can serve them |
| Freezer | $30 | +15 ice each morning (leftover still melts, per the brief) | `endDay` | **20–33 days: never pays back** |
| Tray | $25 | Carry 2 glasses | Rush (`rushMods.carry`) | ~5–6 days; needs 2+ waiting |
| Electric Mixer | $20 | Prep 1.0s → 0.4s | Rush (`rushMods.prepMul`) | ~4 days (~20% faster per glass) |
| Bigger Counter | $20 | A 4th spot | Rush (`rushMods.extraSpots`) | ~5 days, or never |
| Umbrella | $12 | Rain penalty ×0.35 → ×0.6 | demand (sky factor) | On the 2nd rain day (~1–2 weeks) |
| Little Sibling | $2/day | Serves slowly on their own; the daily cost raises bankruptcy risk | Rush (`rushMods.helpers`) + `endDay` | Needs 2+ extra glasses a day |

**Each upgrade fixes a miss the report already counts** (the Lemonade Tycoon model), so the report can suggest a fix: "5 walked out. A Boombox would have kept about 2."

| Report shows | Fix |
|---|---|
| Walked out | Boombox, Roller Skates, Electric Mixer |
| No room | Bigger Counter, Tray, Little Sibling |
| Sold out early | Freezer, or buy more |
| Few passersby | Painted Sign, Umbrella (rain), Flyers |
| Too expensive | No upgrade. Pricing stays the player's job. |

**Balance notes:**
- **Traffic without speed just makes more walkouts.** People you can't serve become no-room misses (0.3) and walkouts (0), so the rating drops, popularity drops, and traffic falls back. Popularity keeps this in check on its own. The Sign looks like the fastest payback but backfires on a slow counter, so the order you buy upgrades in is the real decision.
- **The Bigger Counter can lower your rating.** It turns no-room misses (0.3) into customers who wait and then walk out (0) unless you're faster. Buy it after a speed upgrade.
- **The Freezer is a trap as written.** 15 ice is worth $0.90–$1.50 a day. Price it around $10, or make it +30 ice.
- **Little Sibling:** $2 × 29 days is $58, charged on storm days too. It's better as a **daily hire each morning**, so the forecast decides. Under $2 cash, the sibling stays home, since cash never goes below $0.
- **Timing:** a 5-day payback is worth it on day 10 and wasted on day 27.
- **Auto-serve makes the Rush upgrades worthless.** `autoServe` has no speed limit, so Skates, Mixer, Tray and Counter do nothing for it. The fix (§10) is to run Auto-serve as a bot that plays `rushRules` with the same `rushMods`.

**Contract requests:** `GameState.upgrades`; a `{ type: 'buyUpgrade'; id }` action handled by a `buyUpgrade(): BuyResult` that never throws, like `buy`; `DayPlan.rushMods`; `DayReport.upkeep`.
**Tests:** one table row per upgrade ("owning only X changes stat Y and nothing else"); a property test that buying order doesn't change the stats.
**Effort:** M for the framework plus the demand, `planDay` and `endDay` upgrades. Tray, Counter and Sibling are M each, because they change Rush rules: a held count, a variable number of spots, and a second actor.

---

## 2. Flyers

**What:** a daily ad spend at $0.50 each, inspired by the signs in *Lemonade Stand* (1979). Each one helps less than the last: boost = 1 + 0.5·(1 − e^(−0.4·n)).

| Flyers | 1 | 2 | 3 | 5 | 10 |
|---|---|---|---|---|---|
| Traffic boost | +16% | +28% | +35% | +43% | +49% |
| Added by the last flyer | +16% | +11% | +7% | +3% | +0.5% |

**What it adds:** a daily bet on the weather. The boost is a percentage, so flyers pay most on hot, sunny days, which are exactly the days your counter is already full. On Day 1 the first flyer brings about 9 more passersby for $0.50. Whether that's profit or walkouts depends on how fast you serve.
**Plugs into:** config `FLYERS = { price, maxBoost, decay, max }`; a morning `{ type: 'buyFlyers'; n }` action that adds to `spentToday`, so the report's profit is already right; `expectedFootTraffic` multiplies by `flyerBoost(n)`; `endDay` resets the count. You pay in the morning, so "no changes once the day starts" still holds.
**Effort:** S.
**Risks:** flyers multiply with the Sign, popularity and the 4th of July. Cap the total traffic multiplier, or a fully upgraded stand is always swamped. Test that the boost only rises and levels off at ×1.5.

---

## 3. Rival stand (Brad)

**What:** Brad sets up down the street. **Hidden prices:** both stands set prices each morning without seeing each other's. You see Brad's price in the report afterwards.
**How customers choose:** each passerby picks between you, Brad and nobody, at random, weighted by a score. Each stand at or under their limit scores **4·(limit − price)/limit + popularity/50**; "nobody" scores **1.0**. *Example:* limit $2.40. You charge $2.00 with popularity 20 (score 1.07); Brad charges $1.75 with popularity 20 (score 1.48). Result: you 30%, Brad 42%, nobody 28%.

| Brad's hidden personality | How he prices | Trash talk (the hint) |
|---|---|---|
| Undercutter | Your price yesterday − $0.25 | "Whatever you charge, I'll beat it." |
| Weather Chaser | $0.50 + $0.03 per °F over 60 in the forecast | "Big heat tomorrow. Hope you're ready." |
| Copycat | Matches your price yesterday | "Nice price yesterday. Real nice." |
| Sore Loser | −$0.20 after losing a day, +$0.15 after winning | "Yesterday was a fluke." |

**What it adds:** reading an opponent. The skill is working out his personality from his trash talk and his prices. **Tie to the Rush:** when your counter is full, the no-room misses go to Brad. A slow counter loses the sale *and* hands Brad the day.
**Plugs into:** a new `src/core/rival.ts` with a pure `bradPrice(personality, yesterday)` you can test with a table; a choice step in `generateDemand` that replaces `willStop`, using `rngFor(seed, day, 'choice')`; `endDay` records Brad's sales (+ `outcome.noRoom`), who won, and his next price; `GameState.rival = { personality, price, popularity }`, with the personality rolled at `newGame`; Brad's price, sales and trash talk added to `DayReport`; weights and personality rows in config.
**Effort:** L.
**Risks:**
- **"Nobody" takes customers v1 never loses.** In v1 everyone at or under their limit stops. Retune traffic, or bring Brad in mid-season as a difficulty step (Grand Opening, §8).
- **You can bait the Undercutter:** charge $5 today and he goes to $4.75, then you charge $2. That's the intended "read him" skill, because baiting costs you a day of sales. Keep his price within $0.50–$5.00.
- His function only gets **yesterday's** report, so the hidden-prices rule is enforced by the function signature.

---

## 4. Recipes and quality

**What:** set lemons and sugar per pitcher, and ice per cup. Quality (0–1) is how close you are to an ideal recipe, and the **ideal ice rises with temperature**. Customers comment: "Too sour!", "Watery." Quality affects tips and satisfaction.
**What it adds:** cost against quality. A weak recipe stretches your stock but loses tips and rating, and the moving ice target means retuning every day.
**Plugs into:** config `IDEAL_RECIPE`; `GameState.recipe`; `planDay` puts `perGlass: Inventory` and `quality` on the plan; `glassesMakeable`, `autoServe` and `rushRules` use `perGlass` instead of "1 of each"; `serviceRating` and tips scale by quality. **The default recipe equals v1**, so the existing tests still pass.
**Effort:** L. It breaks the "one glass = 1 of each" rule, which several modules rely on.
**Risks:** without readable comments, quality is invisible math. Once players find the best recipe it's solved; the temperature-linked ice keeps it moving.

## 5. Cooking Mama-style prep

**What:** the jar has three ingredient piles. Press Space at each pile, hold to mix, then hold to pour up to a line.
**What it adds:** turns the dead second of holding Space into a skill moment. Pour accuracy can feed quality (§4).
**Plugs into:** `rushRules.ts` only. Prep becomes a small state machine inside `step` (`adding → mixing → pouring`), with timings in `rushConfig.ts`.
**Effort:** M.
**Risks:** a skilled player's prep must stay near 1.0s, or all the demand tuning has to be redone. Overpouring mustn't cause unfair sell-outs. Keep a "simple prep" option.

## 6. Errand mini-games

**What:** 2 errand slots each morning, each a short mini-game (about 15s) that gets supplies cheaper than the shop: **Lemon Tree Shake** (shake, then catch falling lemons), **Ice Run** (carry ice home before it melts, faster on hot days), **Sugar Pour** (stop the pour at the line), **Cup Hunt** (find cups hidden around the house).
**What it adds:** choosing which two shortages to cover with skill and which to pay for. On an Ice-shortage day, the Ice Run is worth twice as much.
**Plugs into:** a new `src/errands/` folder split like the Rush (pure rules driven by `dtMs`, plus a canvas). Each errand returns `{ item, units, cost }`, which a new action adds to stock the way `buy` does.
**Effort:** L (M for the first errand and the shared setup, S–M for each one after).
**Risks:** if errands beat the shop by too much, the shop is pointless, so cap the savings at about 30–40%. Errands and the Rush both reward skill, so weaker players fall behind twice. Let players skip errands.

## 7. Locations with rent

**What:** as in *Lemonade Tycoon*, pick a spot each morning: park (free), pool (rent, more kids, big on hot days), ballfield (rent, workers and joggers on game days). Each spot has **its own popularity**.
**What it adds:** chasing demand against the cost of switching. A new spot starts with low popularity.
**Plugs into:** a config `LOCATIONS` table (rent, traffic, customer shares); `popularity` becomes `Record<LocationId, number>`; `generateDemand` looks up the spot's shares and traffic; news becomes location-aware (Pool closed: pool ×0, park ×1.3); `endDay` charges rent; `isBankrupt` adds rent to `restockCost`.
**Effort:** L. Popularity changes from one number to a map, which touches the state, the report and the UI.
**Risks:** rent on a rainy day leads to bankruptcy fast. Choose the spot after seeing the forecast, so rain is a decision rather than a trap.

## 8. More events and pricing

| Idea | What it adds | Plugs into | Effort |
|---|---|---|---|
| Brad gets grounded | A day with no rival, a chance to raise your price | A news row with a `rivalAbsent` flag | S (after §3) |
| Brad's Grand Opening | Brings Brad in mid-season as a difficulty step | News row + `RIVAL.startDay` | S (after §3) |
| Bulk-buyer contracts | "Little League wants 20 glasses at $1.25 at 2pm." Guaranteed sales at a low margin, using up stock | A group arrival (the street crew's `extraArrivals` shape); `endDay` takes popularity if you don't deliver | M |
| Happy Hour | A second price for 3–5pm, **set in the morning** (still "no changes during the day"). Also sells off ice that would melt tonight | The price becomes a schedule; `willStop` checks the price at each `atMs`. `ServedRecord.paid` already records each customer's price | M |

Many events need **no code**: they're new `NEWS_TABLE` rows using fields that already exist. For example, "Little League game" = 12 Joggers via `extraArrivals`, and "Sugar recall" = `priceMultipliers: { sugar: 1.5 }`.

## 9. Polish

| Item | Note | Effort |
|---|---|---|
| Art (Phaser or pixel art) | The Rush's rules are separate from its drawing, so art only touches `RushGame.tsx`, never the rules or tests | M |
| Thought bubbles ("$3?! No way") | Live price feedback instead of report-only. `planDay` exposes the passersby who didn't stop | S |
| Cash-over-time chart | The data is already in `history[].cashAfter` | S |
| Saving, loading, high scores | Save the seed plus the `GameAction` log and replay it through `gameReducer`. `finishDay` carries the outcome, so the Rush is never re-run. A "daily seed" leaderboard comes almost for free | M |
| Sound, mouse controls, mobile | Rush input is `{ left, right, space }`; on-screen buttons feed the same input | M |

## 10. Balance tooling

- **`npm run sim` (S):** runs N seeded seasons through `engine` with scripted strategies (cheap $1, fair $2, premium $3) and prints the spread of final cash (p10/p50/p90), the bankruptcy rate, and average walkouts and sell-outs. It checks the numbers in this doc, finds any strategy that's always best, and can become a CI check that a tuning change doesn't move the "fair" median out of range.
- **A bot that plays the Rush through `rushRules` (M):** `src/rush/rushBot.ts` turns a `RushState` into `{ left, right, space }`. It preps when not holding a glass, then serves the customer with the least patience who can still be reached in time. It makes the Rush upgrades measurable, and it can **replace Auto-serve's perfect play**, so playing the Rush well beats Auto-serve. Risk: the bot should play at a real player's level, not perfectly. Tune it against a few recorded human runs.

---

## Inspirations

- **Dave the Diver:** the sushi-bar serving loop. Patience bars, move → prep → serve, and upgrades that make you faster.
- **Lemonade Tycoon:** satisfaction feeding popularity, and upgrades that each fix one specific problem (the model for §1).
- **Lemonade Stand (1979):** the demand curve, signs (→ Flyers) and storms.
- **Cooking Mama:** step-by-step prep gestures (§5).
