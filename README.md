# 🍋 Lemon Rush

A lemonade stand game. You're a kid with $20 and a summer (7 or 30 days). Each morning you read Walt's weather forecast, buy supplies, and set a price. Then you run the stand in **the Rush**, a real-time, *Dave the Diver*–style serving game where you run between the jug and the counter while customers lose patience. Your score is the cash you have at the end of summer. Run out of money and stock and you're bankrupt.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest: 364 tests (engine, Rush rules, simulator, UI)
npm run sim        # balance report: hundreds of simulated summers per player type
npm run build      # typecheck + production build
```

- `?seed=123` replays a specific summer (the seed is on the morning screen and the game-over screen).
- `?rush=fixture` plays the Rush on its own with a sample day and prints the outcome.
- `?window=fixture` plays the **window-style prototype** (an alternative Rush we built and compared, then set aside).
- `?start` previews the pixel-art title screen.

## How to play

1. **Start screen:** pick a **Quick week (7 days)** or **Full summer (30 days)**. **📖 Rules** explains every system with the game's real numbers.
2. **Morning**
   - Walt's 3-day forecast. "Pretty sure" / "thinks so" / "just guessing" = sky right 85% / 65% / 50% of the time.
   - Today's headline (heatwave, pool closed, ice shortage, street crew… and the 4th of July on day 4).
   - **Set your price with the price ruler:** each customer type's price range for today, a line at your price, and how many will stop.
   - Buy lemons, sugar, ice and cups. Bigger packs are cheaper per unit. **Ice melts every night**; the rest keeps.
   - Cash, stock and popularity stay pinned in the title bar. You can't open without the makings of at least one glass.
3. **The Rush** (full screen, ~90 seconds for 9am–5pm)
   - **Move** with ←/→ or A/D.
   - **Hold Space at the 🍋 station** to fill the 10-glass jug. Filling uses the lemons and sugar right away. Keep holding to pour a glass, which takes an ice and a cup.
   - **Press Space at a customer** to serve. Fast service (green patience bar) earns tips; empty bars walk out.
   - Lemonade left in the jug at closing is poured out.
   - **Esc / P pauses.** The pause menu can **end the day early**.
   - **Auto-serve** skips the Rush, assuming perfect service.
4. **Evening report:** missed sales by reason (too expensive, walked out, no room, sold out), money (including Mom's $2/night table rent), leftover stock, ice melted, lemonade poured out, service rating and popularity.
5. **📅 Calendar:** every finished day's weather, profit and sales. Click a day for its full report.

**The core decision is price against speed.** A low price brings more people than you can serve, which costs popularity. Popularity raises tomorrow's foot traffic *and* what people will pay.

## Architecture

```
GameState ──planDay──► DayPlan ──[ autoServe | Rush ]──► DayOutcome ──endDay──► GameState + DayReport
```

| Path | What it is |
|---|---|
| `src/contract.ts` | Shared types and the `Engine` interface: the only module the engine, Rush and UI share. |
| `src/core/` | **The engine.** Pure, deterministic TypeScript (no React/DOM). Every number is a data table in `config.ts`. `sim.ts` is the balance simulator. |
| `src/rush/` | **The Rush.** `rushRules.ts` is a pure state machine, `step(state, dtMs, input)`. `RushGame.tsx` + `pixel/` are a pixel-art canvas view over it. |
| `src/window/` | The window-style prototype (one customer at a time, Cooking-Mama jug and pour). Same contract, also pure rules + view. |
| `src/ui/` | React screens: start, morning, rules, report, calendar, game over. They only render state and pass choices to the engine. |
| `src/shared/` | The pause menu used by both Rush styles. |
| `docs/` | `GAME_DESIGN.md` (rules), `SYSTEMS.md` (formulas and tuning knobs), `BALANCE.md` (simulator results and play-test changes), `FUTURE.md` (roadmap). |

**Key design decisions**
- **A day is played by a pluggable *day simulator*** (`DayPlan → DayOutcome`). Auto-serve, the side-view Rush and the window prototype are interchangeable. The economy never knows which one ran, which is how two Rush styles could be built and compared without touching it.
- **Deterministic and seeded.** Every random number comes from `rngFor(seed, day, purpose)`, a separate stream per day and system. The same seed gives the same summer, so the rules (including full seasons) are testable, and bug reports are reproducible.
- **Data-driven.** Packs, customer types, sky odds, forecast accuracy, news events, rent and popularity constants live in `config.ts`. The Rules page and price ruler read the same tables, so they can't drift from the real rules.
- **Rules separate from rendering.** Both Rush styles keep their rules in pure, fuzz-tested state machines. A rendering bug once froze the game, so the view now catches draw errors and the rules keep running.
- **The contract came first, then parallel agents.** The shared types and a stub engine were written first. Claude agents then worked in parallel, each owning one folder: engine, Rush, roadmap doc, start screen, Rush pixel art, window prototype, balance, mini-games.

## Data model (short version)

- **`GameState`:** seed, day, season length, cash, inventory, popularity, price, pre-rolled weather and news for the whole season, the morning forecast, history, status.
- **`DayPlan`:** the day's weather and news, your price, opening stock, and the **arrivals**: passersby whose limit is at or above your price, each with a type, arrival time, patience and tip rate.
- **`DayOutcome`:** who was served (patience-bar color and tip), walkouts, no-room misses, sold-out misses, customers still waiting at close, lemonade poured out, stock used.
- **`DayReport`:** everything the evening screen and calendar show, one per day in `history`.

## Systems and balance

See **`docs/SYSTEMS.md`** for every formula and knob, and **`docs/BALANCE.md`** for the simulator results. In brief:
- **Foot traffic** = 36 × temperature × sky × news × (1 + 1.5% per popularity point).
- **Stopping:** a passerby stops if your price is within their limit = type base × heat bonus × popularity pay factor × ±20%.
- **Service rating** = average over everyone who stopped (green 1, yellow 0.7, red 0.4, no room 0.3, sold out 0.2, walkout 0).
- **Popularity** += (rating − 0.5) × 15, then drifts 3% toward 20.
- **Costs:** pack prices (ice is pricier, since it melts), plus Mom's $2/night table rent.
- **Balance was tuned with a simulator** (`npm run sim`) that models human-paced players (10/14/20 customers a day), naive and reckless players, and perfect play, over hundreds of seeds. Play-testing then overrode one result: fewer customers felt dead in the real-time Rush, so traffic went back up (see `BALANCE.md` §0).

## How we read the brief

- **"No changes during the day":** price and stock lock once the stand opens.
- **"Run out of inventory, the day is over":** selling out ends the Rush early.
- **"Leftover ice melts":** all ice is gone every night. Lemons, sugar and cups carry over (lemonade already made into the jug does not).
- **Bankruptcy:** after the ice melts and the rent is paid, you can't make a glass *and* can't afford the cheapest pack of each missing item.
- **Score:** cash after the last day. Leftover stock is worth nothing.

## What's next

See **`docs/FUTURE.md`** (upgrades as data-driven modifiers, a rival stand, recipes, more mini-games, locations) and the recommendations at the top of **`docs/BALANCE.md`** (a savings goal as a second way to lose, capping Auto-serve at a human pace).
