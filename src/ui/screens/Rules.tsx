// The rules page. Every number comes from src/core/config.ts (and the Rush timings from src/rush/rushConfig.ts),
// so this page always matches what the game actually does.

import type { Sky } from '../../contract';
import { SKY_LADDER } from '../../contract';
import { config, heatBonus, maxPayRange, popularityPayFactor, temperatureFactor } from '../../core';
import { RUSH } from '../../rush/rushConfig';
import { CUSTOMER_TYPES, DEMAND, NEWS_EMOJI, SKY_EMOJI, SKY_NAME, TYPE_COLOR, TYPES, describeNews, money, pct, times } from './shared';

const { DAILY_COST, FORECAST_ACCURACY, JULY_4TH, JULY_4TH_DAY, NEWS_TABLE, POPULARITY, SEASON_LENGTHS, SERVICE_WEIGHTS, SKY_TABLE, START_CASH, START_POPULARITY } =
  config;

/** A no-effect headline, for showing typical numbers. */
const QUIET_NEWS = NEWS_TABLE.find((n) => n.event.id === 'quiet')!.event;

const SKY_FILL: Record<Sky, string> = {
  sunny: '#ffd43b',
  partlyCloudy: '#ffe8a3',
  cloudy: '#d6e2ec',
  rain: '#8fb8d8',
  storm: '#52627e',
};

const TOC: [string, string][] = [
  ['goal', 'The goal'],
  ['day', 'A day'],
  ['weather', 'Weather'],
  ['forecast', 'The forecast'],
  ['customers', 'Customers'],
  ['serving', 'Serving'],
  ['popularity', 'Popularity'],
  ['news', 'News'],
];

const secs = (ms: number) => `${Number((ms / 1000).toFixed(1))}s`;

export function Rules({ onBack, backLabel }: { onBack: () => void; backLabel: string }) {
  const skyTotal = SKY_LADDER.reduce((s, sky) => s + SKY_TABLE[sky].weight, 0);
  const newsTotal = NEWS_TABLE.reduce((s, n) => s + n.weight, 0);
  const maxPatience = Math.max(...TYPES.map((t) => CUSTOMER_TYPES[t].patienceMs));
  const serveOrder = [...TYPES].sort((a, b) => CUSTOMER_TYPES[a].patienceMs - CUSTOMER_TYPES[b].patienceMs);

  return (
    <div className="mk-about">
      <nav className="mk-toc" aria-label="Rules sections">
        <button className="mk-btn" style={{ fontSize: 16, padding: '6px 12px', marginBottom: 8 }} onClick={onBack}>
          {backLabel}
        </button>
        {TOC.map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {label}
          </a>
        ))}
      </nav>
      <div className="mk-about-body">
        <section id="goal">
          <h2>Rules</h2>
          <p className="mk-about-intro">
            You have {money(START_CASH)} and a summer of {SEASON_LENGTHS.join(' or ')} days (you pick on the start screen).
            Whatever cash you have after the last day is your score. Every number on this page is the one the game uses.
          </p>
          <p className="mk-note" style={{ marginTop: 8 }}>
            {DAILY_COST.label} is {money(DAILY_COST.amount)} every night, open or not. You go bankrupt if, after the ice
            melts at night, you can't make a glass and can't afford the cheapest pack of what's missing. Leftover stock is
            worth nothing at the end.
          </p>
        </section>

        <section id="day">
          <h2 className="mk-section-title">A day at the stand</h2>
          <div className="mk-loop">
            <div>
              <b>Read the forecast</b>
              <small>Walt shows today and the next two days.</small>
            </div>
            <div>
              <b>Buy supplies</b>
              <small>A glass needs 1 lemon, 1 sugar, 1 ice and 1 cup.</small>
            </div>
            <div>
              <b>Set a price</b>
              <small>It's locked once you open.</small>
            </div>
            <div>
              <b>Serve the rush</b>
              <small>Fast service earns tips and popularity.</small>
            </div>
          </div>
          <p className="mk-note" style={{ marginTop: 10 }}>
            Lemons and sugar go into a 10-glass jug when you fill it; ice and a cup go into each glass you serve. Ice
            melts every night and leftover lemonade is poured out. Lemons, sugar and cups in your stock keep, so bigger
            packs are safe once you can afford them.
          </p>
        </section>

        <section id="weather">
          <h2 className="mk-section-title">Weather</h2>
          <div className="mk-two">
            <div className="mk-card">
              <h3>Heat brings people out, and they pay more</h3>
              <p className="mk-note">👥 how many walk by, 💵 how much they'll pay</p>
              <div className="mk-temp-strip" style={{ marginTop: 12 }}>
                {[60, 70, 80, 90, 100].map((t, i) => (
                  <div key={t} style={{ background: ['#d0ebff', '#e3f2d8', '#fff3bf', '#ffd8a8', '#ffa8a8'][i] }}>
                    <strong>{t}°</strong>
                    <small title="Foot traffic">👥 {times(temperatureFactor(t))}</small>
                    <small title="What people will pay">💵 {times(heatBonus(t))}</small>
                  </div>
                ))}
              </div>
            </div>
            <div className="mk-card">
              <h3>The sky decides who's outside</h3>
              <div className="mk-stack" aria-hidden>
                {SKY_LADDER.map((s) => (
                  <div key={s} style={{ width: pct(SKY_TABLE[s].weight / skyTotal), background: SKY_FILL[s] }}>
                    {SKY_EMOJI[s]}
                  </div>
                ))}
              </div>
              <div className="mk-legend">
                {SKY_LADDER.map((s) => (
                  <span key={s}>
                    {SKY_EMOJI[s]} {SKY_NAME[s]}: {pct(SKY_TABLE[s].weight / skyTotal)} of days,{' '}
                    {SKY_TABLE[s].traffic === 0 ? 'nobody comes' : `traffic ${times(SKY_TABLE[s].traffic)}`}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="forecast">
          <h2 className="mk-section-title">What Walt's forecast means</h2>
          <div className="mk-card mk-acc">
            {FORECAST_ACCURACY.map((a, i) => (
              <div className="mk-acc-row" key={a.confidence}>
                <span>
                  <b>"{a.confidence}"</b>
                  <br />
                  <small>{['Today', 'Tomorrow', 'Day after'][i]}</small>
                </span>
                <div className="mk-sure-bar" style={{ height: 14 }}>
                  <i style={{ width: pct(a.skyCorrect) }} />
                </div>
                <span>
                  {pct(a.skyCorrect)} right
                  <br />
                  <small>±{a.tempErrorF}°F</small>
                </span>
              </div>
            ))}
            <div>
              <p className="mk-note">
                Every day's real weather is decided at the start of summer. When Walt is wrong about the sky, he's off by
                exactly one step on this scale:
              </p>
              <div className="mk-ladder">
                {SKY_LADDER.map((s) => (
                  <span key={s}>
                    {SKY_EMOJI[s]} {SKY_NAME[s]}
                  </span>
                ))}
              </div>
              <p className="mk-note" style={{ marginTop: 10 }}>
                Buy ice for today's forecast only. Use tomorrow and the day after to decide whether to stock up on lemons,
                sugar and cups.
              </p>
            </div>
          </div>
        </section>

        <section id="customers">
          <h2 className="mk-section-title">Customers</h2>
          <p className="mk-section-sub">
            About {DEMAND.baseTraffic} people pass on a mild day, more when it's hot or you're popular. Each one stops only
            if your price is within what they'll pay; the rest are counted as "too expensive" in your report.
          </p>
          <div className="mk-people">
            {TYPES.map((t) => {
              const c = CUSTOMER_TYPES[t];
              const range = maxPayRange(t, 80, QUIET_NEWS, START_POPULARITY);
              return (
                <article className="mk-person" key={t} style={{ ['--c' as string]: TYPE_COLOR[t] }}>
                  <span className="emoji" aria-hidden>
                    {c.emoji}
                  </span>
                  <h3>{c.label}</h3>
                  <span className="mk-note">{pct(c.share)} of passersby</span>
                  <div className="mk-stat">
                    <span>
                      Pays up to {money(range.lo)}–{money(range.hi)} at 80°F (new stand)
                    </span>
                  </div>
                  <div className="mk-stat">
                    <span>Waits {c.patienceMs / 1000}s</span>
                    <div className="bar">
                      <i style={{ width: pct(c.patienceMs / maxPatience) }} />
                    </div>
                  </div>
                  <div className="mk-stat">
                    <span>Tips {pct(c.tipRate)} when served fast</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section id="serving">
          <h2 className="mk-section-title">Serving the rush</h2>
          <div className="mk-two">
            <div className="mk-card">
              <h3>Controls</h3>
              <ul className="mk-order" style={{ marginTop: 10 }}>
                <li>
                  <b>← / →</b> (or A / D) to run along the counter.
                </li>
                <li>
                  <b>Make a jug</b> (hold Space at the 🍋 station when the jug is empty): <b>squeeze</b> (alternate ← →),{' '}
                  <b>sweeten</b> (tap Space on the sweet spot), <b>stir</b> (↑ → ↓ ←, twice round). Better jugs tip more: ★★★ ×
                  {RUSH.jugTip[3]}, ★★ ×{RUSH.jugTip[2]}, ★ ×{RUSH.jugTip[1]}. A jug holds {RUSH.jugCapacity} glasses and uses 1
                  lemon + 1 sugar per glass as soon as you start it.
                </li>
                <li>
                  <b>Pour a glass</b>: hold Space and let go at the line. PERFECT ×{RUSH.pourTip.perfect}, GOOD ×{RUSH.pourTip.good},
                  SHORT ×{RUSH.pourTip.short}; overflowing spills the glass (its cup + ice are lost). Each glass takes 1 ice + 1 cup.
                </li>
                <li>
                  <b>Press Space</b> at a customer to hand it over ({secs(RUSH.serveMs)}).
                </li>
                <li>You carry one glass at a time. When the jug is empty, go back and refill it.</li>
                <li>
                  <b>Lemonade left in the jug at the end of the day is poured out</b>, and its lemons and sugar are gone.
                  Think twice before filling a fresh jug late in the afternoon.
                </li>
              </ul>
            </div>
            <div className="mk-card">
              <h3>Who to help first</h3>
              <ol className="mk-order" style={{ marginTop: 10 }}>
                {serveOrder.map((t) => (
                  <li key={t}>
                    {CUSTOMER_TYPES[t].emoji} <b>{CUSTOMER_TYPES[t].label}</b>: gives up after{' '}
                    {CUSTOMER_TYPES[t].patienceMs / 1000}s
                    {CUSTOMER_TYPES[t].tipRate >= 0.25 ? ', and tips the most' : CUSTOMER_TYPES[t].tipRate === 0 ? ', never tips' : ''}
                  </li>
                ))}
              </ol>
              <h3 style={{ marginTop: 14 }}>The patience bar sets the tip</h3>
              <ul className="mk-order" style={{ marginTop: 6 }}>
                <li>🟩 Green (over 60% left): full tip</li>
                <li>🟨 Yellow (30–60%): half tip</li>
                <li>🟥 Red (under 30%): no tip</li>
                <li>Empty: they leave without paying</li>
              </ul>
            </div>
          </div>
          <p className="mk-note" style={{ marginTop: 10 }}>
            If all 3 spots are taken, new arrivals leave. If you run out of supplies, the stand sells out and the day ends.
          </p>
        </section>

        <section id="popularity">
          <h2 className="mk-section-title">Popularity</h2>
          <div className="mk-card">
            <div className="mk-flow">
              <span>How you served today</span>
              <b aria-hidden>➜</b>
              <span>Service rating</span>
              <b aria-hidden>➜</b>
              <span>Popularity overnight</span>
              <b aria-hidden>➜</b>
              <span>Tomorrow's foot traffic</span>
            </div>
            <div className="mk-bars" aria-label="How each customer counts toward the service rating">
              {(
                [
                  ['🟩 Served green', SERVICE_WEIGHTS.green],
                  ['🟨 Served yellow', SERVICE_WEIGHTS.yellow],
                  ['🟥 Served red', SERVICE_WEIGHTS.red],
                  ['🚪 No room', SERVICE_WEIGHTS.noRoom],
                  ['🚫 Sold out', SERVICE_WEIGHTS.soldOut],
                  ['😠 Walked out', SERVICE_WEIGHTS.walkout],
                ] as [string, number][]
              ).map(([label, w]) => (
                <div key={label}>
                  <i style={{ height: `${Math.max(3, w * 100)}px` }} />
                  <span>
                    {label}
                    <br />
                    <b>{pct(w)}</b>
                  </span>
                </div>
              ))}
            </div>
            <p className="mk-note" style={{ marginTop: 12 }}>
              Your service rating is the average over everyone who stopped. Popularity moves by (rating − 50%) ×{' '}
              {POPULARITY.changeScale} each night, then drifts {pct(POPULARITY.drift)} back toward {POPULARITY.anchor}. Each
              point adds {pct(DEMAND.popularityTrafficPerPoint)} more foot traffic, and popular stands can charge more: what people
              will pay is ×{popularityPayFactor(0).toFixed(2)} at popularity 0, ×{popularityPayFactor(50).toFixed(2)} at 50 and ×
              {popularityPayFactor(100).toFixed(2)} at 100. Pricing so low that you can't keep up costs
              you customers tomorrow.
            </p>
          </div>
        </section>

        <section id="news">
          <h2 className="mk-section-title">News</h2>
          <div className="mk-news">
            {[
              ...NEWS_TABLE.map((n) => ({ e: n.event, chance: pct(n.weight / newsTotal) })),
              { e: JULY_4TH, chance: `Day ${JULY_4TH_DAY}` },
            ].map(({ e, chance }) => (
              <div key={e.id}>
                <span>
                  {NEWS_EMOJI[e.id]} {e.headline}
                </span>
                <span className="mk-note">{chance}</span>
                <span className="mk-effects">
                  {(describeNews(e).length ? describeNews(e) : ['No effect']).map((p) => (
                    <span className="mk-chip" key={p}>
                      {p}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
