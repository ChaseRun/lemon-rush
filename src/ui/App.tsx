// App shell: Start → Morning → Rush (or Auto-serve) → Report → next Morning … → Summer's over / Bankrupt.
// All game rules come from the engine; this file only holds UI state and passes player choices to it.

import { useCallback, useRef, useState } from 'react';
import type { DayOutcome, DayPlan, DayReport, GameState, Item } from '../contract';
import { engine } from '../engine';
import { RushGame } from '../rush';
import { Calendar } from './screens/Calendar';
import { Morning, TopBar } from './screens/Morning';
import { Report } from './screens/Report';
import { Rules } from './screens/Rules';
import { SKY_EMOJI, money } from './screens/shared';
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
  const [showCalendar, setShowCalendar] = useState(false);
  const dayFinished = useRef(false);

  const finishDay = (p: DayPlan, outcome: DayOutcome) => {
    const result = engine.endDay(game, p, outcome);
    setGame(result.state);
    setReport(result.report);
    setPhase('report');
    window.scrollTo(0, 0);
  };

  const startDay = (mode: 'rush' | 'auto') => {
    // The buttons are disabled too; this guards any other way of starting a day.
    if (engine.glassesMakeable(game.inventory) === 0) {
      setError("You can't open the stand without the makings of at least one glass.");
      return;
    }
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

  /** Back to the start screen with a fresh seed, so the player can pick a summer length again. */
  const newGame = () => {
    setGame(engine.newGame(newSeed()));
    setPlan(null);
    setReport(null);
    setError(null);
    setPhase('start');
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

  if (showCalendar && phase !== 'start') {
    return (
      <div className="mk">
        <TopBar game={game} />
        <Calendar game={game} onBack={() => setShowCalendar(false)} />
      </div>
    );
  }

  if (phase === 'start') {
    return (
      <StartScreen
        onStart={(seasonDays) => {
          setGame(engine.newGame(game.seed, seasonDays));
          setPhase('morning');
        }}
        onRules={() => setShowRules(true)}
      />
    );
  }

  return (
    <div className="mk">
      <TopBar game={game} />
      {phase === 'morning' && game.status === 'playing' && (
        <>
          <div className="mk-subnav">
            <span>Seed {game.seed}</span>
            <span className="mk-style">
              <button className="mk-link" onClick={() => setShowCalendar(true)}>
                📅 Calendar
              </button>
              <button className="mk-link" onClick={() => setShowRules(true)}>
                📖 Rules
              </button>
            </span>
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
        <Report
          report={report}
          dayLengthMs={plan.dayLengthMs}
          actions={
            <>
              <button className="mk-btn" onClick={() => setShowCalendar(true)}>
                📅 Calendar
              </button>
              <button className="mk-btn primary" onClick={() => setPhase('morning')}>
                Next morning
              </button>
            </>
          }
        />
      )}

      {phase === 'morning' && game.status !== 'playing' && (
        <GameOver game={game} onRestart={newGame} onCalendar={() => setShowCalendar(true)} />
      )}
    </div>
  );
}

function GameOver({ game, onRestart, onCalendar }: { game: GameState; onRestart: () => void; onCalendar: () => void }) {
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
        <button className="mk-btn" onClick={onCalendar}>
          📅 Calendar
        </button>
        <button className="mk-btn primary" onClick={onRestart}>
          Play another summer
        </button>
      </div>
    </main>
  );
}
