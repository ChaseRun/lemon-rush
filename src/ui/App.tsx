// App shell: Start → Morning → Rush (or Auto-serve) → Report → next Morning … → Summer's over / Bankrupt.
// All game rules come from the engine; this file only holds UI state and passes player choices to it.

import { useCallback, useRef, useState } from 'react';
import type { CustomerTypeId, DayOutcome, DayPlan, DayReport, GameState, Item } from '../contract';
import { ITEMS } from '../contract';
import { engine } from '../engine';
import { RushGame } from '../rush';
import { Morning, TopBar } from './screens/Morning';
import { Rules } from './screens/Rules';
import { CUSTOMER_TYPES, ITEM_EMOJI, SKY_EMOJI, SKY_NAME, clock, money, pct } from './screens/shared';
import { StartScreen } from './start/StartScreen';
import './theme.css';

type Phase = 'start' | 'morning' | 'rush' | 'report';

const newSeed = () => Math.floor(Math.random() * 1_000_000);
/** ?seed=123 replays a specific summer (same weather, news and customers). */
const urlSeed = Number(new URLSearchParams(location.search).get('seed'));
const pickSeed = () => (Number.isInteger(urlSeed) && urlSeed > 0 ? urlSeed : newSeed());

export function App() {
  const [game, setGame] = useState<GameState>(() => engine.newGame(pickSeed()));
  const [phase, setPhase] = useState<Phase>('start');
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [report, setReport] = useState<DayReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const dayFinished = useRef(false);

  const finishDay = (p: DayPlan, outcome: DayOutcome) => {
    const result = engine.endDay(game, p, outcome);
    setGame(result.state);
    setReport(result.report);
    setPhase('report');
    window.scrollTo(0, 0);
  };

  const startDay = (mode: 'rush' | 'auto') => {
    const p = engine.planDay(game);
    setPlan(p);
    setError(null);
    if (mode === 'auto') {
      finishDay(p, engine.autoServe(p));
    } else {
      dayFinished.current = false;
      setPhase('rush');
      window.scrollTo(0, 0);
    }
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

  const newGame = () => {
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

  if (showRules) {
    return (
      <div className="mk">
        {phase !== 'start' && <TopBar game={game} />}
        <Rules onBack={() => setShowRules(false)} backLabel={phase === 'start' ? 'Back to start' : 'Back to the stand'} />
      </div>
    );
  }

  if (phase === 'start') {
    return <StartScreen onStart={() => setPhase('morning')} onRules={() => setShowRules(true)} />;
  }

  return (
    <div className="mk">
      <TopBar game={game} />
      {phase === 'morning' && game.status === 'playing' && (
        <>
          <div className="mk-subnav">
            <span>Seed {game.seed}</span>
            <button className="mk-link" onClick={() => setShowRules(true)}>
              📖 Rules
            </button>
          </div>
          <Morning
            game={game}
            error={error}
            onBuy={buy}
            onPrice={(p) => setGame(engine.setPrice(game, p))}
            onStart={startDay}
          />
        </>
      )}

      {phase === 'rush' && plan && (
        <main className="mk-page">
          <RushGame plan={plan} onFinish={onRushFinish} />
        </main>
      )}

      {phase === 'report' && report && plan && (
        <Report report={report} dayLengthMs={plan.dayLengthMs} onNext={() => setPhase('morning')} />
      )}

      {phase === 'morning' && game.status !== 'playing' && <GameOver game={game} onRestart={newGame} />}
    </div>
  );
}

function Report({ report: r, dayLengthMs, onNext }: { report: DayReport; dayLengthMs: number; onNext: () => void }) {
  const tooExpensive = (Object.keys(r.tooExpensive) as CustomerTypeId[]).filter((t) => r.tooExpensive[t] > 0);
  const missed: [string, string, number][] = [
    ['😠', 'Walked out (waited too long)', r.walkouts],
    ['🚪', 'No room at the counter', r.noRoom],
    ['🚫', r.soldOutAtMs === null ? 'Sold out' : `Sold out at ${clock(r.soldOutAtMs, dayLengthMs)}`, r.soldOutMisses],
    ['🕔', 'Still waiting at 5pm (not held against you)', r.leftAtClose],
  ];
  return (
    <main className="mk-page">
      <div className="mk-headline">
        <span className="emoji" aria-hidden>
          🌙
        </span>
        <div>
          <h2>Day {r.day} is over</h2>
          <p>
            Walt said {SKY_EMOJI[r.forecast.sky]} {Math.round(r.forecast.tempF)}° ("{r.forecast.confidence}"). It was{' '}
            {SKY_EMOJI[r.weather.sky]} {SKY_NAME[r.weather.sky].toLowerCase()}, {Math.round(r.weather.tempF)}°. {r.news.headline}
          </p>
        </div>
      </div>

      <div className="mk-estimate mk-estimate-4">
        <div>
          <strong>{money(r.profit)}</strong>
          <small>profit today</small>
        </div>
        <div>
          <strong>{money(r.cashAfter)}</strong>
          <small>cash now</small>
        </div>
        <div>
          <strong>{r.glassesSold}</strong>
          <small>glasses sold at {money(r.price)}</small>
        </div>
        <div>
          <strong>
            {Math.round(r.popularityBefore)} ➜ {Math.round(r.popularityAfter)}
          </strong>
          <small>popularity (service rating {pct(r.serviceRating)})</small>
        </div>
      </div>

      <div className="mk-two">
        <section className="mk-card">
          <h2 className="mk-section-title">Who came by</h2>
          <p>
            {r.passersby} people walked by and <b>{r.stopped}</b> stopped. You served <b>{r.glassesSold}</b>: 🟩{' '}
            {r.servedByBar.green} green, 🟨 {r.servedByBar.yellow} yellow, 🟥 {r.servedByBar.red} red.
          </p>
          <h3 style={{ marginTop: 12 }}>Missed sales</h3>
          <ul className="mk-plain">
            <li>
              💸 Too expensive:{' '}
              {tooExpensive.length === 0
                ? 'nobody'
                : tooExpensive
                    .map((t) => `${r.tooExpensive[t]} ${CUSTOMER_TYPES[t].label}${r.tooExpensive[t] > 1 ? 's' : ''}`)
                    .join(', ')}
            </li>
            {missed.map(([emoji, label, n]) => (
              <li key={label}>
                {emoji} {label}: <b>{n}</b>
              </li>
            ))}
          </ul>
        </section>
        <section className="mk-card">
          <h2 className="mk-section-title">Money and stock</h2>
          <ul className="mk-plain">
            <li>Sales: {money(r.revenue)}</li>
            <li>Tips: {money(r.tips)}</li>
            <li>Spent this morning: {money(r.spent)}</li>
            <li>
              <b>Profit: {money(r.profit)}</b>
            </li>
          </ul>
          <h3 style={{ marginTop: 12 }}>Left for tomorrow</h3>
          <p>
            {ITEMS.map((i) => `${ITEM_EMOJI[i]} ${r.inventoryAfter[i]}`).join('   ')}
            <br />
            <span className="mk-note">🧊 {r.iceMelted} ice melted overnight.</span>
            {r.pouredOut > 0 && (
              <>
                <br />
                <span className="mk-note">
                  🫗 {r.pouredOut} glass{r.pouredOut > 1 ? 'es' : ''} of lemonade left in the jug was poured out (those lemons
                  and sugar are gone).
                </span>
              </>
            )}
          </p>
        </section>
      </div>

      <div className="mk-go">
        <button className="mk-btn primary" onClick={onNext}>
          Next morning
        </button>
      </div>
    </main>
  );
}

function GameOver({ game, onRestart }: { game: GameState; onRestart: () => void }) {
  const last = game.history[game.history.length - 1];
  return (
    <main className="mk-page">
      <div className="mk-headline">
        <span className="emoji" aria-hidden>
          {game.status === 'bankrupt' ? '💸' : '🎉'}
        </span>
        <div>
          <h2>
            {game.status === 'bankrupt'
              ? `Bankrupt on day ${last?.day ?? game.day}`
              : `Summer's over! Final score: ${money(game.cash)}`}
          </h2>
          <p>
            Seed {game.seed}. Add ?seed={game.seed} to the address to replay this exact summer.
          </p>
        </div>
      </div>
      <section className="mk-card" style={{ overflowX: 'auto' }}>
        <h2 className="mk-section-title">Your summer</h2>
        <table className="mk-table">
          <thead>
            <tr>
              {['Day', 'Weather', 'Price', 'Sold', 'Profit', 'Cash', 'Popularity'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {game.history.map((d) => (
              <tr key={d.day}>
                <td>{d.day}</td>
                <td>
                  {SKY_EMOJI[d.weather.sky]} {Math.round(d.weather.tempF)}°
                </td>
                <td>{money(d.price)}</td>
                <td>{d.glassesSold}</td>
                <td>{money(d.profit)}</td>
                <td>{money(d.cashAfter)}</td>
                <td>{Math.round(d.popularityAfter)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="mk-go">
        <button className="mk-btn primary" onClick={onRestart}>
          Play another summer
        </button>
      </div>
    </main>
  );
}
