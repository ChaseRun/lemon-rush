# 🍋 Lemon Rush — Game Design (v1)

> Source of truth for every rule and number. Ideas cut from v1 live in `docs/FUTURE.md`.

## 1. Pitch, score, and losing
- **The setup:** a kid's lemonade stand over **30 days of summer (July 1–30)**. You start with **$20**, no supplies, and popularity 20 out of 100.
- **Score:** your cash at the end of day 30. Leftover supplies are worth nothing.
- **Bankruptcy:** checked each night after the ice melts. You're bankrupt if you can't make a glass **and** can't afford the cheapest pack of each missing item. The game ends and shows the day you went under.
- Cash never goes below $0.

## 2. The daily loop
1. **Morning:** check the forecast and headline, buy supplies, set your price.
2. **The day:** play the **Rush** or press **Auto-serve**. Price and supplies are locked once the day starts.
3. **Report:** see what happened, then go to the next day.

## 3. Supplies
**One glass = 1 lemon + 1 sugar + 1 ice + 1 cup.** Glasses you can make = the smallest of your four counts. Lemons and sugar are used when you fill the 10-glass jug; ice and a cup are used for each glass you serve.

| Item | Small pack | Medium pack | Large pack | Goes bad? |
|---|---|---|---|---|
| 🍋 Lemons | 10 for $3.00 | 25 for $6.25 | 50 for $10.00 | Never |
| 🍬 Sugar | 10 for $1.50 | 25 for $3.00 | 50 for $5.00 | Never |
| 🧊 Ice | 10 for $1.00 | 25 for $2.00 | 50 for $3.00 | **Melts every night** |
| 🥤 Cups | 10 for $1.00 | 25 for $2.00 | 50 for $3.00 | Never |

You can't buy what you can't afford. Price range: $0.50–$5.00.

## 4. Weather and the forecast
- **Temperature:** about 78°F + 10 × sin(π × (day − 1) / 29), plus a random ±8°F, kept between 60°F and 100°F. That starts around 78°F, peaks around 88°F mid-month, and comes back down.
- **Sky:**

  | Sky | Chance | Foot traffic |
  |---|---|---|
  | ☀️ Sunny | 35% | ×1.0 |
  | 🌤️ Partly cloudy | 25% | ×0.9 |
  | ☁️ Cloudy | 20% | ×0.7 |
  | 🌧️ Rain | 15% | ×0.35 |
  | ⛈️ Storm | 5% | ×0 |

- **Forecast:** each morning shows today and the next 2 days. Every day's real weather is decided in advance.

  | Day | Sky right | Temperature within | Shown as |
  |---|---|---|---|
  | Today | 85% | ±2°F | "pretty sure" |
  | Tomorrow | 65% | ±5°F | "thinks so" |
  | Day after | 50% | ±8°F | "just guessing" |

  When the sky is wrong, it's off by one step on the sunny-to-storm scale.

## 5. Demand
- **Foot traffic** = 40 × temperature factor × sky factor × news factor × (1 + popularity / 100).
- **Temperature factor** = 0.5 + (temperature − 60) / 40. That's ×0.5 at 60°F, ×1.0 at 80°F, ×1.5 at 100°F.
- **Customer types:**

  | Type | Share | Base "most I'll pay" | Patience | Tip rate |
  |---|---|---|---|---|
  | 🧒 Allowance Kid | 35% | $1.25 | 18s | 0% |
  | 🏃 Jogger | 25% | $2.50 | 12s | 10% |
  | 👵 Grandma | 20% | $2.00 | 25s | 30% |
  | 👷 Construction Worker | 20% | $3.00 | 15s | 15% |

- **Each person's actual limit** = base × heat bonus × a random factor between 0.8 and 1.2. The heat bonus is 0.8 + 0.4 × (temperature − 60) / 40, so ×0.8 at 60°F up to ×1.2 at 100°F. On the 4th of July, limits are ×1.2.
- **A passerby stops if your price is at or below their limit.** Otherwise they're counted as "too expensive" for their type.
- **Arrivals** are spread evenly across the day.

## 6. The Rush (reduced)
- **Layout:** 3 customer spots on the left and a prep station on the right. The kid moves left and right between them.
- **Length:** 120 seconds of real time, running from 9am to 5pm.
- **Controls:** ← / → (or A / D) to move. Space to act.
- **The jug:** lemonade comes from a **10-glass jug** that starts each day empty. Hold Space at the prep station for **2.0s** to fill it with up to 10 glasses (fewer if lemons or sugar run short). **Filling uses 1 lemon + 1 sugar per glass immediately.**
- **Pouring a glass:** with lemonade in the jug, hold Space at the station for **0.3s** to pour a glass. It needs a free cup and ice. You can carry 1 glass. When the jug is empty, go back and refill it.
- **End of day:** lemonade still in the jug (or in your hand) is **poured out**. Its lemons and sugar are lost, and the report shows how many glasses' worth was wasted.
- **Serving:** at a waiting customer while holding a glass, press Space. Serving takes **0.8s** and you can't do anything else during it.
- **When a serve finishes:**
  - 1 ice and 1 cup are taken from stock (the lemon and sugar were used when the jug was filled).
  - The customer pays your price plus a tip, which is added to your cash.
  - A "+$X.XX" pops up.
  - The customer leaves.
- **Patience bar:** 🟩 green above 60%, 🟨 yellow from 30–60%, 🟥 red below 30%.
  - At 0, the customer **walks out**. They pay nothing and no stock is used.
- **Tip** = price × the type's tip rate × 1 on green, 0.5 on yellow, 0 on red.
- **Full counter:** an arrival who finds all spots taken is a **no-room** miss.
- **Sold out:** when your free stock can't make another glass, the jug is empty, and you aren't holding one, the day ends early. Everyone still waiting or yet to arrive becomes a **sold-out miss**.
- **5pm:** customers still waiting leave. They aren't counted as walkouts.
- **Auto-serve:** every arrival is served on green, in order, until stock runs out. The rest become sold-out misses.

## 7. News (one headline each morning, plus a fixed holiday)
| Headline | Chance | Effect |
|---|---|---|
| Quiet day | 50% | None |
| 🔥 Heatwave | 12% | +10°F, already in the forecast |
| 🏊 Pool closed | 10% | Foot traffic ×1.3 |
| 🧊 Ice shortage | 10% | Ice price ×2 |
| 🍋 Lemon sale | 10% | Lemons −30% |
| 🚧 Street crew | 8% | Foot traffic ×0.5, plus 8 extra Construction Workers arriving at noon |

**🎆 Day 4, the 4th of July:** foot traffic ×2 and limits ×1.2.

## 8. Service rating and popularity
- **Each customer who stopped counts toward the day's service rating:**

  | What happened | Counts as |
  |---|---|
  | Served on green | 1.0 |
  | Served on yellow | 0.7 |
  | Served on red | 0.4 |
  | No room | 0.3 |
  | Sold-out miss | 0.2 |
  | Walked out | 0 |

  The rating is the average of these. If nobody stopped, it's 0.5.
- **Popularity update (overnight):**
  1. popularity += (rating − 0.5) × 20
  2. Then drift toward 20: popularity += (20 − popularity) × 0.05
  3. Keep it between 0 and 100.
- **Effect:** +1% foot traffic per point. Fast service today means more customers tomorrow.
- **The main decision:** price against how fast you can serve. A low price brings more people than you can handle, which means walkouts and a falling popularity.

## 9. Report
- **Weather:** actual vs forecast, and the headline.
- **Customers:** passersby, how many stopped, and how many you served (green / yellow / red).
- **Missed sales:**
  - Too expensive, by customer type
  - Walked out
  - No room
  - Sold out, and when
- **Money:** revenue, tips, spent today, profit, cash.
- **Stock:** what's left, and how much ice melted.
- **Meters:** service rating, and popularity before → after.

## 10. How we read the brief
- No changes once the day starts.
- Selling out ends the day.
- All ice melts every night, and lemonade left in the jug is poured out.
- Bankruptcy as defined in §1.
- Score is cash at the end of day 30.

## 11. Day 1 example (sanity check)
- **Morning:** ☀️ 85°F. Buy 25 of each medium pack for $13.25, leaving $6.75 in cash. Price **$2.00**.
- **Passersby:** about 54. All 19 kids are priced out, and about 31 people stop.
- **Rush:** a decent first try serves about 23, with about 5 walkouts and 3 no-room misses.
- **Evening:** cash about $56. Rating about 67%, so popularity goes 20 → about 23.
