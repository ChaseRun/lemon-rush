// Design mockup for the Morning and How-it-works screens. Opened with /?mockup.
// Uses the real engine and config, so every number shown is a real one.

import { useMemo, useState } from 'react';
import type { CustomerTypeId, ForecastDay, GameState, Item, NewsEvent, Sky } from '../../contract';
import { ITEMS, SKY_LADDER } from '../../contract';
import { config, engine, expectedFootTraffic, heatBonus, temperatureFactor } from '../../core';
import './mockup.css';

const {
  CUSTOMER_TYPES,
  DEMAND,
  FORECAST_ACCURACY,
  JULY_4TH,
  JULY_4TH_DAY,
  NEWS_TABLE,
  POPULARITY,
  PRICE_MAX,
  PRICE_MIN,
  SEASON_DAYS,
  SERVICE_WEIGHTS,
  SKY_TABLE,
  START_CASH,
} = config;

const TYPES = Object.keys(CUSTOMER_TYPES) as CustomerTypeId[];
const SKY_EMOJI: Record<Sky, string> = { sunny: '☀️', partlyCloudy: '🌤️', cloudy: '☁️', rain: '🌧️', storm: '⛈️' };
const SKY_NAME: Record<Sky, string> = {
  sunny: 'Sunny',
  partlyCloudy: 'Partly cloudy',
  cloudy: 'Cloudy',
  rain: 'Rain',
  storm: 'Storm',
};
const ITEM_EMOJI: Record<Item, string> = { lemons: '🍋', sugar: '🍬', ice: '🧊', cups: '🥤' };
const ITEM_NAME: Record<Item, string> = { lemons: 'Lemons', sugar: 'Sugar', ice: 'Ice', cups: 'Cups' };
const TYPE_COLOR: Record<CustomerTypeId, string> = {
  kid: 'var(--kid)',
  jogger: 'var(--jogger)',
  grandma: 'var(--grandma)',
  worker: 'var(--worker)',
};
const NEWS_EMOJI: Record<string, string> = {
  quiet: '🏡',
  heatwave: '🔥',
  poolClosed: '🏊',
  iceShortage: '🧊',
  lemonSale: '🍋',
  streetCrew: '🚧',
  july4th: '🎆',
};

const money = (n: number) => (n < 0 ? `-$${(-n).toFixed(2)}` : `$${n.toFixed(2)}`);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const times = (n: number) => `×${Number(n.toFixed(2))}`;

/** A day-3 game built by actually playing two auto-served days, so the mockup shows real state. */
function sampleGame(seed: number): GameState {
  let g = engine.newGame(seed);
  for (let d = 0; d < 2; d++) {
    for (const item of ITEMS) {
      const r = engine.buy(g, item, 1);
      if (r.ok) g = r.state;
    }
    const plan = engine.planDay(g);
    g = engine.endDay(g, plan, engine.autoServe(plan)).state;
  }
  return g;
}

/** Each customer type's range of "most I'll pay" today, and the share of them who stop at `price`. */
function willingness(type: CustomerTypeId, tempF: number, news: NewsEvent, price: number) {
  const mid = CUSTOMER_TYPES[type].basePay * heatBonus(tempF) * news.maxPayMultiplier;
  const lo = mid * (1 - DEMAND.maxPayJitter);
  const hi = mid * (1 + DEMAND.maxPayJitter);
  const stop = Math.min(1, Math.max(0, (hi - price) / (hi - lo)));
  return { lo, hi, stop };
}

function describeNews(e: NewsEvent): string[] {
  const parts: string[] = [];
  if (e.tempBonusF) parts.push(`+${e.tempBonusF}°F`);
  if (e.trafficMultiplier !== 1) parts.push(`Foot traffic ${times(e.trafficMultiplier)}`);
  if (e.maxPayMultiplier !== 1) parts.push(`People pay ${times(e.maxPayMultiplier)}`);
  for (const [item, m] of Object.entries(e.priceMultipliers))
    parts.push(`${ITEM_NAME[item as Item]} ${m! > 1 ? 'cost' : 'on sale'} ${times(m!)}`);
  if (e.extraArrivals)
    parts.push(`${e.extraArrivals.count} ${CUSTOMER_TYPES[e.extraArrivals.type].label}s arrive at noon`);
  return parts;
}

export function Mockup() {
  const [view, setView] = useState<'morning' | 'about'>(
    new URLSearchParams(location.search).get('mockup') === 'about' ? 'about' : 'morning',
  );
  return (
    <div className="mk">
      <nav className="mk-switch" aria-label="Mockup screens">
        <b>Design mockup</b>
        <button aria-pressed={view === 'morning'} onClick={() => setView('morning')}>
          Morning
        </button>
        <button aria-pressed={view === 'about'} onClick={() => setView('about')}>
          How it works
        </button>
      </nav>
      {view === 'morning' ? <MorningMockup /> : <AboutMockup />}
    </div>
  );
}

// ---------------------------------------------------------------- Morning

function MorningMockup() {
  const [game, setGame] = useState(() => sampleGame(4242));
  const [price, setPrice] = useState(2);
  const today = game.forecast[0];
  const news = game.news[game.day - 1];
  const listing = engine.shopListing(game);
  const canMake = engine.glassesMakeable(game.inventory);

  const buy = (item: Item, idx: number) => {
    const r = engine.buy(game, item, idx);
    if (r.ok) setGame(r.state);
  };

  return (
    <>
      <TopBar game={game} />
      <main className="mk-page">
        <div className="mk-headline">
          <span className="emoji" aria-hidden>
            {NEWS_EMOJI[news.id]}
          </span>
          <div>
            <h2>{news.headline}</h2>
            <p>{describeNews(news).join('. ') || 'Nothing special today.'}</p>
          </div>
        </div>

        <section>
          <h2 className="mk-section-title">Walt's forecast</h2>
          <p className="mk-section-sub">
            The real weather is already decided. Walt is more accurate the closer the day is, and when he's wrong about
            the sky he's off by one step.
          </p>
          <div className="mk-forecast">
            {game.forecast.map((f, i) => (
              <ForecastCard key={f.day} f={f} lead={i} isToday={i === 0} />
            ))}
          </div>
        </section>

        <div className="mk-prep">
          <section className="mk-card">
            <h2 className="mk-section-title">Your stock</h2>
            <Stock inventory={game.inventory} canMake={canMake} />
          </section>

          <PriceRuler game={game} today={today} news={news} price={price} onPrice={setPrice} canMake={canMake} />
        </div>

        <section>
          <h2 className="mk-section-title">Corner Store</h2>
          <p className="mk-section-sub">Bigger packs cost less per glass. Lemons, sugar and cups keep; ice melts tonight.</p>
          <div className="mk-store">
            {ITEMS.map((item) => {
              const smallUnit = listing[item][0].price / listing[item][0].size;
              const mult = news.priceMultipliers[item];
              return (
                <div className="mk-store-col" key={item}>
                  <h3>
                    {ITEM_EMOJI[item]} {ITEM_NAME[item]}
                    {mult !== undefined && mult > 1 && <span className="mk-chip bad">Pricey today</span>}
                    {mult !== undefined && mult < 1 && <span className="mk-chip good">On sale</span>}
                  </h3>
                  {listing[item].map((p, idx) => {
                    const unit = p.price / p.size;
                    const save = 1 - unit / smallUnit;
                    return (
                      <button key={idx} className="mk-pack" disabled={p.price > game.cash} onClick={() => buy(item, idx)}>
                        <b>
                          {p.size} for {money(p.price)}
                        </b>
                        <small>
                          {money(unit)} each{save > 0.01 && <span className="save">, save {pct(save)}</span>}
                        </small>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </section>

        <div className="mk-go">
          <p>Price and stock lock once the stand opens. (Mockup: these buttons don't start a day.)</p>
          <button className="mk-btn">Auto-serve the day</button>
          <button className="mk-btn primary">Open the stand</button>
        </div>
      </main>
    </>
  );
}

function TopBar({ game }: { game: GameState }) {
  return (
    <header className="mk-top">
      <div className="mk-top-inner">
        <div className="mk-logo">🍋 Lemon Rush</div>
        <div className="mk-summer">
          <span className="mk-summer-label">
            Day {game.day} of {SEASON_DAYS}
          </span>
          <div className="mk-days" aria-hidden>
            {Array.from({ length: SEASON_DAYS }, (_, i) => {
              const d = i + 1;
              const cls = [d < game.day ? 'done' : '', d === game.day ? 'today' : '', d === JULY_4TH_DAY ? 'holiday' : '']
                .filter(Boolean)
                .join(' ');
              return <span key={d} className={cls} title={d === JULY_4TH_DAY ? '4th of July' : `Day ${d}`} />;
            })}
          </div>
        </div>
        <div className="mk-wallet">
          <div className="mk-pill">
            <small>Cash</small>
            <strong>{money(game.cash)}</strong>
          </div>
          <div className="mk-pill">
            <small>Popularity</small>
            <strong>{Math.round(game.popularity)}</strong>
            <div className="mk-meter">
              <i style={{ width: `${game.popularity}%` }} />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function ForecastCard({ f, lead, isToday }: { f: ForecastDay; lead: number; isToday: boolean }) {
  const acc = FORECAST_ACCURACY[lead];
  const traffic = temperatureFactor(f.tempF) * SKY_TABLE[f.sky].traffic;
  const pay = heatBonus(f.tempF);
  return (
    <article className={`mk-fday${isToday ? ' today' : ''}`}>
      <div className="mk-fday-head">
        <h3>{isToday ? 'Today' : lead === 1 ? 'Tomorrow' : `Day ${f.day}`}</h3>
        <span className="mk-note">{SKY_NAME[f.sky]}</span>
      </div>
      <div className="mk-fday-sky">
        <span className="emoji" aria-hidden>
          {SKY_EMOJI[f.sky]}
        </span>
        <span className="mk-fday-temp">
          {Math.round(f.tempF)}°<small> ±{acc.tempErrorF}</small>
        </span>
      </div>
      <div className="mk-sure">
        <span>
          Walt is "{f.confidence}": sky right {pct(acc.skyCorrect)} of the time
        </span>
        <div className="mk-sure-bar">
          <i style={{ width: pct(acc.skyCorrect) }} />
        </div>
      </div>
      <div className="mk-effects">
        {f.sky === 'storm' ? (
          <span className="mk-chip bad">If it storms, nobody comes</span>
        ) : (
          <span className={`mk-chip ${traffic >= 1 ? 'good' : 'bad'}`}>Foot traffic {times(traffic)}</span>
        )}
        <span className={`mk-chip ${pay >= 1 ? 'good' : 'bad'}`}>People pay {times(pay)}</span>
      </div>
      {isToday && <p className="mk-note">Ice melts tonight, so buy ice for today only.</p>}
    </article>
  );
}

function Stock({ inventory, canMake }: { inventory: GameState['inventory']; canMake: number }) {
  const limiting = ITEMS.filter((i) => inventory[i] === canMake);
  return (
    <>
      <div className="mk-stock">
        {ITEMS.map((item) => (
          <div key={item} className={limiting.includes(item) ? 'limit' : ''}>
            <span className="emoji" aria-hidden>
              {ITEM_EMOJI[item]}
            </span>
            <strong>{inventory[item]}</strong>
            <small>{ITEM_NAME[item]}</small>
          </div>
        ))}
      </div>
      <p className="mk-cando">
        {canMake === 0 ? (
          <>
            You can't make lemonade yet. You're out of <b>{limiting.map((i) => ITEM_NAME[i].toLowerCase()).join(' and ')}</b>.
          </>
        ) : (
          <>
            You can make <b>{canMake} glasses</b>. {ITEM_NAME[limiting[0]]} runs out first.
          </>
        )}
      </p>
    </>
  );
}

function PriceRuler(props: {
  game: GameState;
  today: ForecastDay;
  news: NewsEvent;
  price: number;
  onPrice: (p: number) => void;
  canMake: number;
}) {
  const { game, today, news, price, canMake } = props;
  const scaleMax = PRICE_MAX;
  const at = (v: number) => `${(Math.min(v, scaleMax) / scaleMax) * 100}%`;
  const rows = TYPES.map((t) => ({ t, ...willingness(t, today.tempF, news, price) }));
  const walkBy = expectedFootTraffic(today, news, game.popularity);
  const extra = news.extraArrivals;
  const stopping =
    walkBy * rows.reduce((s, r) => s + CUSTOMER_TYPES[r.t].share * r.stop, 0) +
    (extra ? extra.count * willingness(extra.type, today.tempF, news, price).stop : 0);
  const listing = engine.shopListing(game);
  const unit = (item: Item, idx: number) => listing[item][idx].price / listing[item][idx].size;
  const costLarge = ITEMS.reduce((s, i) => s + unit(i, 2), 0);
  const costSmall = ITEMS.reduce((s, i) => s + unit(i, 0), 0);

  return (
    <section className="mk-ruler-card" aria-labelledby="price-title">
      <h2 className="mk-section-title" id="price-title">
        Set today's price
      </h2>
      <p className="mk-section-sub">
        Each bar shows what that kind of customer will pay at today's forecast of {Math.round(today.tempF)}°F. Anyone whose
        bar reaches past your price stops.
      </p>
      <div className="mk-price-row">
        <span className="mk-price-big">{money(price)}</span>
        <input
          type="range"
          min={PRICE_MIN}
          max={PRICE_MAX}
          step={0.25}
          value={price}
          onChange={(e) => props.onPrice(Number(e.target.value))}
          aria-label="Price per glass"
        />
      </div>
      <div className="mk-ruler">
        {rows.map((r) => {
          const c = CUSTOMER_TYPES[r.t];
          const verdict = r.stop >= 0.99 ? 'all' : r.stop <= 0.01 ? 'none' : 'some';
          return (
            <div className="mk-ruler-row" key={r.t}>
              <span className="who">
                <span aria-hidden>{c.emoji}</span>
                <span>{c.label}</span>
              </span>
              <div className="mk-track">
                <div className="mk-band" style={{ left: at(r.lo), width: `calc(${at(r.hi)} - ${at(r.lo)})`, background: TYPE_COLOR[r.t] }} />
                <div className="mk-priceline" style={{ left: at(price) }} />
              </div>
              <span className={`mk-verdict ${verdict}`}>
                {verdict === 'all' ? 'All stop' : verdict === 'none' ? 'Walk past' : `${pct(r.stop)} stop`}
              </span>
            </div>
          );
        })}
        <div className="mk-scale" aria-hidden>
          <span />
          <div>
            <span>$0</span>
            <span>$1</span>
            <span>$2</span>
            <span>$3</span>
            <span>$4</span>
            <span>$5</span>
          </div>
          <span />
        </div>
      </div>
      <div className="mk-estimate">
        <div>
          <strong>~{Math.round(walkBy + (extra?.count ?? 0))}</strong>
          <small>walk by if Walt is right</small>
        </div>
        <div>
          <strong>~{Math.round(stopping)}</strong>
          <small>stop at {money(price)}</small>
        </div>
        <div>
          <strong>{canMake}</strong>
          <small>{canMake >= stopping ? 'glasses ready: enough' : `glasses ready: ${Math.ceil(stopping - canMake)} short`}</small>
        </div>
      </div>
      <p className="mk-note" style={{ marginTop: 12 }}>
        A glass costs {money(costLarge)}–{money(costSmall)} depending on pack size, so you keep {money(price - costSmall)}–
        {money(price - costLarge)} each. Serving fast earns tips on top.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- How it works

function AboutMockup() {
  const skyTotal = SKY_LADDER.reduce((s, sky) => s + SKY_TABLE[sky].weight, 0);
  const newsTotal = NEWS_TABLE.reduce((s, n) => s + n.weight, 0);
  const maxPatience = Math.max(...TYPES.map((t) => CUSTOMER_TYPES[t].patienceMs));
  const SKY_FILL: Record<Sky, string> = {
    sunny: '#ffd43b',
    partlyCloudy: '#ffe8a3',
    cloudy: '#d6e2ec',
    rain: '#8fb8d8',
    storm: '#52627e',
  };
  const serveOrder = useMemo(
    () => [...TYPES].sort((a, b) => CUSTOMER_TYPES[a].patienceMs - CUSTOMER_TYPES[b].patienceMs),
    [],
  );
  const toc = [
    ['goal', 'The goal'],
    ['day', 'A day'],
    ['weather', 'Weather'],
    ['forecast', 'The forecast'],
    ['customers', 'Customers'],
    ['rush', 'Serving'],
    ['popularity', 'Popularity'],
    ['news', 'News'],
  ];

  return (
    <div className="mk-about">
      <nav className="mk-toc" aria-label="Sections">
        {toc.map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {label}
          </a>
        ))}
      </nav>
      <div className="mk-about-body">
        <section id="goal">
          <h2>How Lemon Rush works</h2>
          <p className="mk-about-intro">
            You have {money(START_CASH)} and {SEASON_DAYS} days of summer. Whatever cash you have at the end is your score.
            Every number on this page is the one the game uses.
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
            Ice melts every night. Lemons, sugar and cups keep. You go bankrupt if you can't make a glass and can't afford
            the cheapest pack of what's missing.
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
              <p className="mk-note">When Walt is wrong about the sky, he's off by exactly one step:</p>
              <div className="mk-ladder">
                {SKY_LADDER.map((s, i) => (
                  <span key={s}>
                    {SKY_EMOJI[s]} {SKY_NAME[s]}
                    {i < SKY_LADDER.length - 1 ? '' : ''}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="customers">
          <h2 className="mk-section-title">Who walks by</h2>
          <p className="mk-section-sub">
            About {DEMAND.baseTraffic} people pass on a mild day, more when it's hot or you're popular. Each one stops only
            if your price is within what they'll pay.
          </p>
          <div className="mk-people">
            {TYPES.map((t) => {
              const c = CUSTOMER_TYPES[t];
              const at80 = c.basePay * heatBonus(80);
              return (
                <article className="mk-person" key={t} style={{ ['--c' as string]: TYPE_COLOR[t] }}>
                  <span className="emoji" aria-hidden>
                    {c.emoji}
                  </span>
                  <h3>{c.label}</h3>
                  <span className="mk-note">{pct(c.share)} of passersby</span>
                  <div className="mk-stat">
                    <span>
                      Pays up to {money(at80 * (1 - DEMAND.maxPayJitter))}–{money(at80 * (1 + DEMAND.maxPayJitter))} at 80°F
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

        <section id="rush">
          <h2 className="mk-section-title">Serving: who to help first</h2>
          <div className="mk-two">
            <div className="mk-card">
              <h3>Serve in this order when the counter is full</h3>
              <ol className="mk-order" style={{ marginTop: 10 }}>
                {serveOrder.map((t) => (
                  <li key={t}>
                    {CUSTOMER_TYPES[t].emoji} <b>{CUSTOMER_TYPES[t].label}</b>: gives up after {CUSTOMER_TYPES[t].patienceMs / 1000}s
                    {CUSTOMER_TYPES[t].tipRate >= 0.25 ? ', and tips the most' : CUSTOMER_TYPES[t].tipRate === 0 ? ', never tips' : ''}
                  </li>
                ))}
              </ol>
            </div>
            <div className="mk-card">
              <h3>The patience bar sets the tip</h3>
              <ul className="mk-order" style={{ marginTop: 10 }}>
                <li>🟩 Green (over 60% left): full tip</li>
                <li>🟨 Yellow (30–60%): half tip</li>
                <li>🟥 Red (under 30%): no tip</li>
                <li>Empty: they leave without paying, and you keep the stock</li>
              </ul>
            </div>
          </div>
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
              Popularity moves by (rating − 50%) × {POPULARITY.changeScale} each night, then drifts {pct(POPULARITY.drift)} back toward{' '}
              {POPULARITY.anchor}. Each point adds {pct(DEMAND.popularityTrafficPerPoint)} more foot traffic. Pricing so low that
              you can't keep up costs you customers tomorrow.
            </p>
          </div>
        </section>

        <section id="news">
          <h2 className="mk-section-title">News</h2>
          <div className="mk-news">
            {[...NEWS_TABLE.map((n) => ({ e: n.event, chance: pct(n.weight / newsTotal) })), { e: JULY_4TH, chance: `Day ${JULY_4TH_DAY}` }].map(
              ({ e, chance }) => (
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
              ),
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
