// The morning screen: headline, Walt's forecast, stock, the price ruler and the Corner Store.

import type { ForecastDay, GameState, Item, NewsEvent } from '../../contract';
import { ITEMS } from '../../contract';
import { config, engine, expectedFootTraffic, heatBonus, temperatureFactor } from '../../core';
import {
  CUSTOMER_TYPES,
  ITEM_EMOJI,
  ITEM_NAME,
  NEWS_EMOJI,
  SKY_EMOJI,
  SKY_NAME,
  TYPE_COLOR,
  TYPES,
  describeNews,
  money,
  pct,
  times,
  willingness,
} from './shared';

const { FORECAST_ACCURACY, JULY_4TH_DAY, PRICE_MAX, PRICE_MIN, SEASON_DAYS, SKY_TABLE } = config;

export function TopBar({ game }: { game: GameState }) {
  const day = Math.min(game.day, SEASON_DAYS);
  return (
    <header className="mk-top">
      <div className="mk-top-inner">
        <div className="mk-logo">🍋 Lemon Rush</div>
        <div className="mk-summer">
          <span className="mk-summer-label">
            Day {day} of {SEASON_DAYS}
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

export function Morning(props: {
  game: GameState;
  error: string | null;
  onBuy: (item: Item, packIdx: number) => void;
  onPrice: (price: number) => void;
  onStart: (mode: 'rush' | 'auto') => void;
}) {
  const { game } = props;
  const today = game.forecast[0];
  const news = game.news[game.day - 1];
  const canMake = engine.glassesMakeable(game.inventory);

  return (
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
          The real weather is already decided. Walt is more accurate the closer the day is, and when he's wrong about the
          sky he's off by one step.
        </p>
        <div className="mk-forecast">
          {game.forecast.map((f, i) => (
            <ForecastCard key={f.day} f={f} lead={i} />
          ))}
        </div>
      </section>

      <div className="mk-prep">
        <section className="mk-card">
          <h2 className="mk-section-title">Your stock</h2>
          <Stock inventory={game.inventory} canMake={canMake} />
        </section>
        <PriceRuler game={game} today={today} news={news} canMake={canMake} onPrice={props.onPrice} />
      </div>

      <Store game={game} news={news} onBuy={props.onBuy} error={props.error} />

      <div className="mk-go">
        <p>Your price and stock lock once the stand opens.</p>
        <button className="mk-btn" onClick={() => props.onStart('auto')}>
          Auto-serve the day
        </button>
        <button className="mk-btn primary" onClick={() => props.onStart('rush')}>
          Open the stand
        </button>
      </div>
    </main>
  );
}

function ForecastCard({ f, lead }: { f: ForecastDay; lead: number }) {
  const acc = FORECAST_ACCURACY[lead];
  const isToday = lead === 0;
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
            You can't make lemonade yet. You're out of{' '}
            <b>{limiting.map((i) => ITEM_NAME[i].toLowerCase()).join(' and ')}</b>.
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
  canMake: number;
  onPrice: (p: number) => void;
}) {
  const { game, today, news, canMake } = props;
  const price = game.price;
  const at = (v: number) => `${(Math.min(v, PRICE_MAX) / PRICE_MAX) * 100}%`;
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
                <div
                  className="mk-band"
                  style={{ left: at(r.lo), width: `calc(${at(r.hi)} - ${at(r.lo)})`, background: TYPE_COLOR[r.t] }}
                />
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
            {[0, 1, 2, 3, 4, 5].map((d) => (
              <span key={d}>${d}</span>
            ))}
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

function Store(props: { game: GameState; news: NewsEvent; error: string | null; onBuy: (item: Item, idx: number) => void }) {
  const { game, news } = props;
  const listing = engine.shopListing(game);
  return (
    <section>
      <h2 className="mk-section-title">Corner Store</h2>
      <p className="mk-section-sub">Bigger packs cost less per glass. Lemons, sugar and cups keep; ice melts tonight.</p>
      {props.error && <p className="mk-error">{props.error}</p>}
      <div className="mk-store">
        {ITEMS.map((item) => {
          const smallUnit = listing[item][0].price / listing[item][0].size;
          const mult = news.priceMultipliers[item];
          return (
            <div className="mk-store-col" key={item}>
              <h3>
                {ITEM_EMOJI[item]} {ITEM_NAME[item]} <small className="mk-note">(have {game.inventory[item]})</small>
                {mult !== undefined && mult > 1 && <span className="mk-chip bad">Pricey today</span>}
                {mult !== undefined && mult < 1 && <span className="mk-chip good">On sale</span>}
              </h3>
              {listing[item].map((p, idx) => {
                const unitPrice = p.price / p.size;
                const save = 1 - unitPrice / smallUnit;
                return (
                  <button key={idx} className="mk-pack" disabled={p.price > game.cash} onClick={() => props.onBuy(item, idx)}>
                    <b>
                      {p.size} for {money(p.price)}
                    </b>
                    <small>
                      {money(unitPrice)} each{save > 0.01 && <span className="save">, save {pct(save)}</span>}
                    </small>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
