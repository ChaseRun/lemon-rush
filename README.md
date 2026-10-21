# 🍋 Lemon Rush

A lemonade stand game. You're a kid with $20 and 30 days of summer. Each morning you read the weather forecast, buy supplies, and set a price. Then you run the stand in **the Rush**, a real-time serving mini-game inspired by *Dave the Diver*. Your score is the cash you have at the end of summer. If you run out of money and can't make lemonade, you're bankrupt.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest: engine + Rush rules
npm run build      # typecheck + production build
```

- `http://localhost:5173/?seed=123` replays a specific summer. The seed is shown in the status bar.
- `http://localhost:5173/?rush=fixture` plays the Rush on its own with a sample day and prints the outcome.
- Tests: **125 passing.** 96 cover the engine, including a fixed-seed 30-day season and statistical checks over many seeds. 29 cover the Rush rules, including a fuzz test over random plans and key presses.

## How to play

1. **Morning.**
   - Check Walt's 3-day forecast and today's headline.
   - Buy lemons, sugar, ice and cups. Bigger packs are cheaper per unit.
   - Set your price. **Ice melts every night**, and everything else carries over.
2. **The day.** Press **Start Rush** to play, or **Auto-serve** to skip ahead assuming perfect service.
   - **Move** with ←/→ (or A/D).
   - **Fill the jug and pour:** hold Space at the 🍋 station to fill the 10-glass jug (2s). Filling uses the lemons and sugar right away. Keep holding to pour a glass (0.3s), which takes an ice and a cup. Refill when it's empty. Lemonade left in the jug at closing is poured out.
   - **Serve:** run to a customer and press Space.
   - Customers lose patience while they wait. A fast serve earns tips, and if patience runs out they walk out.
3. **Evening report.**
   - Missed sales, broken down by reason: too expensive, walked out, no room, sold out
   - Money and leftover stock
   - Service rating, and how your popularity changed

**Popularity is driven by how fast you serve.** It raises tomorrow's foot traffic. The core decision each day is **price against speed**: a low price brings in more people than you can serve, which costs you popularity.

## Architecture

```
GameState ──planDay──► DayPlan ──[ autoServe | Rush ]──► DayOutcome ──endDay──► GameState + DayReport
```

| Path | What it is |
|---|---|
| `src/contract.ts` | Shared types and the `Engine` interface. It's the only module the three areas share. |
| `src/core/` | **The engine.** Pure, deterministic TypeScript with no React or DOM. All numbers live in data tables in `config.ts`. |
| `src/rush/` | **The Rush.** `rushRules.ts` is a pure state machine (`step(state, dt, input)`); `RushGame.tsx` is a thin canvas display over it. |
| `src/ui/` | A bare-bones React UI. It only renders state and passes player choices to the engine. |
| `src/fixtures.ts`, `src/engine.ts` | A stub engine and sample data. `engine.ts` is the single switch from the stub to the real engine. |
| `docs/` | `GAME_DESIGN.md` (the rules), `SYSTEMS.md` (formulas and tuning knobs), `FUTURE.md` (roadmap), `AGENTS.md` (how the work was split) |

**Key design decisions**
- **A day is played out by a pluggable *day simulator*** (`DayPlan → DayOutcome`). Auto-serve (perfect play) and the Rush mini-game can be swapped for each other. Everything else in the game only ever sees the plan and the outcome, so the Rush could be replaced, or a bot player added, without touching the economy.
- **Deterministic and seeded.** Every random number comes from a seeded generator, with a separate stream for each day and system. The same seed always produces the same summer, which makes the rules testable, including a full 30-day season in a test.
- **Data-driven.** Pack prices, customer types, sky odds, news events and the popularity constants are all tables in `src/core/config.ts`. Tuning the game means editing config, not logic.
- **The contract came first, then parallel work.** The shared types and a stub engine were written first. Three Claude agents then worked in parallel, each owning one folder: the engine, the Rush, and the future roadmap. See `docs/AGENTS.md`.

## Data model (short version)

- **`GameState`:** day, cash, inventory, popularity, price, pre-rolled weather and news for all 30 days, the current forecast, history, and status.
- **`DayPlan`:** the day's weather and news, your price, opening stock, and the **arrivals**: passersby whose limit is at or above your price, each with a type, arrival time, patience and tip rate.
- **`DayOutcome`:** who was served (with patience-bar color and tip), walkouts, no-room misses, sold-out misses, and stock used.
- **`DayReport`:** everything the evening screen shows. One per day, kept in `history`.

## Systems and tuning

See **`docs/SYSTEMS.md`** for every formula and its tuning knobs: weather and forecast, demand, the service rating, popularity, bankruptcy. In brief:
- **Foot traffic** = 40 × temperature factor × sky factor × news × (1 + popularity/100).
- **A passerby stops if your price is at or below their limit.** Their limit is the customer type's base × a heat bonus × ±20% randomness.
- **Service rating** = the average over customers who stopped (green 1, yellow 0.7, red 0.4, no room 0.3, sold out 0.2, walkout 0).
- **Popularity** += (rating − 0.5) × 20, then drifts 5% back toward 20 each day.

## How we read the brief

- **"No changes during the day":** price and stock are locked once the day starts.
- **"Run out of inventory, the day is over":** selling out ends the Rush early.
- **"Leftover ice melts":** all ice is gone every night. Everything else carries over.
- **Bankruptcy:** after the ice melts, you can't make a glass *and* can't afford the cheapest pack of each missing item.
- **Score:** cash at the end of day 30. Leftover stock is worth nothing.

## What's next

See **`docs/FUTURE.md`**. It covers upgrades as data-driven modifiers, a rival stand, recipes, more mini-games, locations, and balance tooling.
