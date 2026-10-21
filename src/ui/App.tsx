// Bare-bones UI: one page that switches between Morning → Rush → Report → (next day | game over).
// All game rules come from the engine; this file only renders state and dispatches player choices.

import { useCallback, useRef, useState } from 'react';
import type { CustomerTypeId, DayOutcome, DayPlan, DayReport, GameState, Item, Sky } from '../contract';
import { ITEMS } from '../contract';
import { engine } from '../engine';
import { RushGame } from '../rush';
import { About } from './About';

type Phase = 'morning' | 'rush' | 'report';

const SKY_LABEL: Record<Sky, string> = {
  sunny: '☀️ Sunny',
  partlyCloudy: '🌤️ Partly cloudy',
  cloudy: '☁️ Cloudy',
  rain: '🌧️ Rain',
  storm: '⛈️ Storm',
};
const ITEM_LABEL: Record<Item, string> = { lemons: '🍋 Lemons', sugar: '🍬 Sugar', ice: '🧊 Ice', cups: '🥤 Cups' };
const TYPE_LABEL: Record<CustomerTypeId, string> = {
  kid: '🧒 Kids',
  jogger: '🏃 Joggers',
  grandma: '👵 Grandmas',
  worker: '👷 Workers',
};

const money = (n: number) => (n < 0 ? `-$${(-n).toFixed(2)}` : `$${n.toFixed(2)}`);
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** 0ms = 9:00am, dayLengthMs = 5:00pm. */
function clock(ms: number, dayLengthMs: number): string {
  const minutes = 9 * 60 + Math.round((ms / dayLengthMs) * 8 * 60);
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = h24 > 12 ? h24 - 12 : h24;
  return `${h12}:${String(m).padStart(2, '0')}${h24 >= 12 ? 'pm' : 'am'}`;
}

const PRICE_OPTIONS = Array.from({ length: 19 }, (_, i) => 0.5 + i * 0.25); // $0.50 – $5.00

const newSeed = () => Math.floor(Math.random() * 1_000_000);

const table: React.CSSProperties = { borderCollapse: 'collapse', margin: '8px 0' };
const cell: React.CSSProperties = { border: '1px solid #ccc', padding: '4px 8px', textAlign: 'left' };

export function App() {
  const [game, setGame] = useState<GameState>(() => engine.newGame(newSeed()));
  const [phase, setPhase] = useState<Phase>('morning');
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [report, setReport] = useState<DayReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const dayFinished = useRef(false);

  const startDay = (mode: 'rush' | 'auto') => {
    const p = engine.planDay(game);
    setPlan(p);
    setError(null);
    if (mode === 'auto') {
      finishDay(p, engine.autoServe(p));
    } else {
      dayFinished.current = false;
      setPhase('rush');
    }
  };

  const finishDay = (p: DayPlan, outcome: DayOutcome) => {
    const result = engine.endDay(game, p, outcome);
    setGame(result.state);
    setReport(result.report);
    setPhase('report');
  };

  // The Rush may call onFinish more than once (e.g. StrictMode); only the first call counts.
  const onRushFinish = useCallback(
    (outcome: DayOutcome) => {
      if (dayFinished.current || !plan) return;
      dayFinished.current = true;
      finishDay(plan, outcome);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, game],
  );

  const restart = () => {
    setGame(engine.newGame(newSeed()));
    setPlan(null);
    setReport(null);
    setError(null);
    setPhase('morning');
  };

  const buy = (item: Item, packIdx: number) => {
    const r = engine.buy(game, item, packIdx);
    if (r.ok) {
      setGame(r.state);
      setError(null);
    } else {
      setError(r.error);
    }
  };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <h1>
        🍋 Lemon Rush{' '}
        {phase !== 'rush' && !showAbout && <button onClick={() => setShowAbout(true)}>📖 How it works</button>}
      </h1>
      {showAbout && phase !== 'rush' ? (
        <About onBack={() => setShowAbout(false)} />
      ) : (
        <>
      <StatusBar game={game} />

      {phase === 'morning' && game.status === 'playing' && (
        <Morning game={game} error={error} onBuy={buy} onPrice={(p) => setGame(engine.setPrice(game, p))} onStart={startDay} />
      )}

      {phase === 'rush' && plan && (
        <div>
          <h2>The Rush — Day {plan.day}</h2>
          <p>←/→ (or A/D) to move · hold Space at the 🍋 station to make a glass · Space at a customer to serve.</p>
          <RushGame plan={plan} onFinish={onRushFinish} />
        </div>
      )}

      {phase === 'report' && report && plan && (
        <Report report={report} dayLengthMs={plan.dayLengthMs} onNext={() => setPhase('morning')} />
      )}

      {phase === 'morning' && game.status !== 'playing' && <GameOver game={game} onRestart={restart} />}
        </>
      )}
    </div>
  );
}

function StatusBar({ game }: { game: GameState }) {
  return (
    <p>
      <b>Day {Math.min(game.day, 30)} / 30</b> · Cash <b>{money(game.cash)}</b> · Popularity{' '}
      <b>{Math.round(game.popularity)}</b> · Stock:{' '}
      {ITEMS.map((i) => `${ITEM_LABEL[i]} ${game.inventory[i]}`).join(' · ')} · Can make{' '}
      <b>{engine.glassesMakeable(game.inventory)}</b> glasses <small>(seed {game.seed})</small>
    </p>
  );
}

function Morning(props: {
  game: GameState;
  error: string | null;
  onBuy: (item: Item, packIdx: number) => void;
  onPrice: (price: number) => void;
  onStart: (mode: 'rush' | 'auto') => void;
}) {
  const { game } = props;
  const listing = engine.shopListing(game);
  const news = game.news[game.day - 1];
  const canMake = engine.glassesMakeable(game.inventory);

  return (
    <div>
      <h2>☀️ Morning — Day {game.day}</h2>
      {news && <p>📰 <b>{news.headline}</b></p>}

      <h3>Walt's forecast</h3>
      <table style={table}>
        <thead>
          <tr>
            <th style={cell}>Day</th>
            <th style={cell}>Sky</th>
            <th style={cell}>Temp</th>
            <th style={cell}>Walt says</th>
          </tr>
        </thead>
        <tbody>
          {game.forecast.map((f) => (
            <tr key={f.day}>
              <td style={cell}>{f.day === game.day ? 'Today' : `Day ${f.day}`}</td>
              <td style={cell}>{SKY_LABEL[f.sky]}</td>
              <td style={cell}>{Math.round(f.tempF)}°F</td>
              <td style={cell}>"{f.confidence}"</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Corner Store</h3>
      <p>
        <small>One glass = 1 lemon + 1 sugar + 1 ice + 1 cup. Ice melts every night.</small>
      </p>
      <table style={table}>
        <tbody>
          {ITEMS.map((item) => (
            <tr key={item}>
              <td style={cell}>
                {ITEM_LABEL[item]} <small>(have {game.inventory[item]})</small>
              </td>
              {listing[item].map((pack, idx) => (
                <td style={cell} key={idx}>
                  <button disabled={pack.price > game.cash} onClick={() => props.onBuy(item, idx)}>
                    {pack.size} for {money(pack.price)}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {props.error && <p style={{ color: 'crimson' }}>{props.error}</p>}

      <h3>Price</h3>
      <label>
        Price per glass: $
        <select value={game.price.toFixed(2)} onChange={(e) => props.onPrice(Number(e.target.value))}>
          {PRICE_OPTIONS.map((p) => (
            <option key={p} value={p.toFixed(2)}>
              {p.toFixed(2)}
            </option>
          ))}
        </select>
      </label>

      <h3>Open the stand</h3>
      {canMake === 0 && <p style={{ color: 'crimson' }}>You can't make any lemonade yet — buy one of each item.</p>}
      <button onClick={() => props.onStart('rush')}>▶ Start Rush</button>{' '}
      <button onClick={() => props.onStart('auto')}>⏩ Auto-serve (perfect play)</button>
    </div>
  );
}

function Report({ report: r, dayLengthMs, onNext }: { report: DayReport; dayLengthMs: number; onNext: () => void }) {
  const rows: [string, React.ReactNode][] = [
    ['Forecast', `${SKY_LABEL[r.forecast.sky]} ${Math.round(r.forecast.tempF)}°F ("${r.forecast.confidence}")`],
    ['Actual weather', `${SKY_LABEL[r.weather.sky]} ${Math.round(r.weather.tempF)}°F`],
    ['News', r.news.headline],
    ['Price', money(r.price)],
    ['Passersby', r.passersby],
    ['Stopped at your stand', r.stopped],
    ['Glasses sold', `${r.glassesSold} (🟩 ${r.servedByBar.green} · 🟨 ${r.servedByBar.yellow} · 🟥 ${r.servedByBar.red})`],
    [
      '💸 Too expensive',
      (Object.keys(r.tooExpensive) as CustomerTypeId[])
        .filter((t) => r.tooExpensive[t] > 0)
        .map((t) => `${TYPE_LABEL[t]} ${r.tooExpensive[t]}`)
        .join(' · ') || 'none',
    ],
    ['😠 Walked out (waited too long)', r.walkouts],
    ['🚪 No room at the counter', r.noRoom],
    [
      '🚫 Sold out',
      r.soldOutAtMs === null ? 'no' : `at ${clock(r.soldOutAtMs, dayLengthMs)} — ${r.soldOutMisses} customers missed`,
    ],
    ['Revenue', money(r.revenue)],
    ['Tips', money(r.tips)],
    ['Spent this morning', money(r.spent)],
    ['Profit', <b>{money(r.profit)}</b>],
    ['Cash now', <b>{money(r.cashAfter)}</b>],
    ['🧊 Ice melted', r.iceMelted],
    ['Stock left', ITEMS.map((i) => `${ITEM_LABEL[i]} ${r.inventoryAfter[i]}`).join(' · ')],
    ['Service rating', pct(r.serviceRating)],
    ['Popularity', `${Math.round(r.popularityBefore)} → ${Math.round(r.popularityAfter)}`],
  ];
  return (
    <div>
      <h2>🌙 Evening Report — Day {r.day}</h2>
      <table style={table}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th style={cell}>{k}</th>
              <td style={cell}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={onNext}>Next →</button>
    </div>
  );
}

function GameOver({ game, onRestart }: { game: GameState; onRestart: () => void }) {
  const last = game.history[game.history.length - 1];
  return (
    <div>
      {game.status === 'bankrupt' ? (
        <h2>💸 Bankrupt on day {last?.day ?? game.day}!</h2>
      ) : (
        <h2>🎉 Summer's over! Final score: {money(game.cash)}</h2>
      )}
      <h3>Your summer</h3>
      <table style={table}>
        <thead>
          <tr>
            {['Day', 'Weather', 'Price', 'Sold', 'Profit', 'Cash', 'Popularity'].map((h) => (
              <th style={cell} key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {game.history.map((d) => (
            <tr key={d.day}>
              <td style={cell}>{d.day}</td>
              <td style={cell}>
                {SKY_LABEL[d.weather.sky]} {Math.round(d.weather.tempF)}°F
              </td>
              <td style={cell}>{money(d.price)}</td>
              <td style={cell}>{d.glassesSold}</td>
              <td style={cell}>{money(d.profit)}</td>
              <td style={cell}>{money(d.cashAfter)}</td>
              <td style={cell}>{Math.round(d.popularityAfter)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={onRestart}>New game</button>
    </div>
  );
}
