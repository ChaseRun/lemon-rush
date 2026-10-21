// July at a glance: finished days show their results, upcoming days show Walt's forecast (never the real weather).
// Clicking a finished day opens its full evening report.

import { useState } from 'react';
import type { DayReport, GameState } from '../../contract';
import { config } from '../../core';
import { Report } from './Report';
import { SKY_EMOJI, money } from './shared';

const { JULY_4TH_DAY, DAY_LENGTH_MS } = config;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** The summer runs July 1–30. Weekday layout follows July 2026. */
const FIRST_WEEKDAY = new Date(2026, 6, 1).getDay();

export function Calendar({ game, onBack }: { game: GameState; onBack: () => void }) {
  const byDay = new Map<number, DayReport>(game.history.map((r) => [r.day, r]));
  const forecastByDay = new Map(game.forecast.map((f) => [f.day, f]));
  const [selected, setSelected] = useState<number | null>(game.history.at(-1)?.day ?? null);
  const best = game.history.reduce<DayReport | null>((b, r) => (!b || r.profit > b.profit ? r : b), null);
  const totals = game.history.reduce(
    (t, r) => ({ profit: t.profit + r.profit, sold: t.sold + r.glassesSold, poured: t.poured + r.pouredOut }),
    { profit: 0, sold: 0, poured: 0 },
  );
  const selectedReport = selected !== null ? byDay.get(selected) : undefined;

  return (
    <main className="mk-page">
      <div className="mk-go" style={{ justifyContent: 'space-between' }}>
        <h2 className="mk-section-title" style={{ margin: 0 }}>
          📅 July
        </h2>
        <button className="mk-btn" onClick={onBack}>
          Back
        </button>
      </div>

      <div className="mk-estimate mk-estimate-4">
        <div>
          <strong>{money(totals.profit)}</strong>
          <small>profit so far</small>
        </div>
        <div>
          <strong>{totals.sold}</strong>
          <small>glasses sold</small>
        </div>
        <div>
          <strong>{best ? `Jul ${best.day}` : '—'}</strong>
          <small>{best ? `best day: ${money(best.profit)}` : 'best day'}</small>
        </div>
        <div>
          <strong>{Math.max(0, game.seasonDays - game.history.length)}</strong>
          <small>days of summer left</small>
        </div>
      </div>

      <div className="mk-cal" role="grid" aria-label="July calendar">
        {WEEKDAYS.map((w) => (
          <div key={w} className="mk-cal-head" role="columnheader">
            {w}
          </div>
        ))}
        {Array.from({ length: FIRST_WEEKDAY }, (_, i) => (
          <div key={`pad-${i}`} className="mk-cal-pad" aria-hidden />
        ))}
        {Array.from({ length: game.seasonDays }, (_, i) => {
          const day = i + 1;
          const r = byDay.get(day);
          const f = forecastByDay.get(day);
          const isToday = day === game.day && game.status === 'playing';
          const cls = ['mk-cal-day', r ? 'done' : '', isToday ? 'today' : '', selected === day ? 'selected' : '']
            .filter(Boolean)
            .join(' ');
          const body = r ? (
            <>
              <span className="wx">
                {SKY_EMOJI[r.weather.sky]} {Math.round(r.weather.tempF)}°
              </span>
              <span className={`profit ${r.profit >= 0 ? 'up' : 'down'}`}>{money(r.profit)}</span>
              <span className="sold">{r.glassesSold} sold</span>
            </>
          ) : f ? (
            <>
              <span className="wx forecast">
                {SKY_EMOJI[f.sky]} {Math.round(f.tempF)}°
              </span>
              <span className="sold">Walt: "{f.confidence}"</span>
            </>
          ) : null;
          return r ? (
            <button key={day} className={cls} role="gridcell" onClick={() => setSelected(day)} aria-pressed={selected === day}>
              <span className="date">
                Jul {day} {day === JULY_4TH_DAY && '🎆'} {best?.day === day && '⭐'}
              </span>
              {body}
            </button>
          ) : (
            <div key={day} className={cls} role="gridcell">
              <span className="date">
                Jul {day} {day === JULY_4TH_DAY && '🎆'} {isToday && <b>Today</b>}
              </span>
              {body}
            </div>
          );
        })}
      </div>
      {totals.poured > 0 && (
        <p className="mk-note">🫗 {totals.poured} glasses of leftover lemonade poured out so far this summer.</p>
      )}

      {selectedReport ? (
        <Report report={selectedReport} dayLengthMs={DAY_LENGTH_MS} />
      ) : (
        <p className="mk-section-sub">Finish a day and its results will show up here. Click any finished day to see its report.</p>
      )}
    </main>
  );
}
