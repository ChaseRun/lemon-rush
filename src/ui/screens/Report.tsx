// The evening report for one day. Used after each day and from the calendar.

import type { CustomerTypeId, DayReport } from '../../contract';
import { ITEMS } from '../../contract';
import { CUSTOMER_TYPES, ITEM_EMOJI, SKY_EMOJI, SKY_NAME, clock, money, pct } from './shared';

export function Report({
  report: r,
  dayLengthMs,
  actions,
}: {
  report: DayReport;
  dayLengthMs: number;
  /** Buttons shown under the report (e.g. "Next morning", "Calendar"). */
  actions?: React.ReactNode;
}) {
  const soldOut = r.soldOutAtMs !== null;
  const tooExpensive = (Object.keys(r.tooExpensive) as CustomerTypeId[]).filter((t) => r.tooExpensive[t] > 0);
  const missed: [string, string, number][] = [
    ['😠', 'Walked out (waited too long)', r.walkouts],
    ['🚪', 'No room at the counter', r.noRoom],
    ['🚫', r.soldOutAtMs === null ? 'Sold out' : `Sold out at ${clock(r.soldOutAtMs, dayLengthMs)}`, r.soldOutMisses],
    ['🕔', 'Still waiting at closing time (not held against you)', r.leftAtClose],
  ];
  return (
    <main className="mk-page">
      <div className="mk-headline">
        <span className="emoji" aria-hidden>
          {soldOut ? '🚫' : '🌙'}
        </span>
        <div>
          <h2>
            {soldOut
              ? `Day ${r.day}: sold out at ${clock(r.soldOutAtMs!, dayLengthMs)}`
              : `Day ${r.day}: closed at ${clock(dayLengthMs, dayLengthMs)}`}
          </h2>
          {soldOut && (
            <p>
              <b>
                You ran out of supplies, so the stand closed early
                {r.soldOutMisses > 0 ? ` and ${r.soldOutMisses} customer${r.soldOutMisses === 1 ? '' : 's'} missed out` : ''}.
              </b>
            </p>
          )}
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
            <li>Spent: {money(r.spent)} (supplies + Mom's table rent)</li>
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

      {actions && <div className="mk-go">{actions}</div>}
    </main>
  );
}
