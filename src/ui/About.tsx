// "How it works" page. Every number is read from src/core/config.ts, so this page can never drift
// from the rules the engine actually uses.

import type { CustomerTypeId, Item, NewsEvent, Sky } from '../contract';
import { ITEMS, SKY_LADDER } from '../contract';
import {
  CUSTOMER_TYPES,
  DEMAND,
  FORECAST_ACCURACY,
  JULY_4TH,
  JULY_4TH_DAY,
  NEWS_TABLE,
  PACKS,
  POPULARITY,
  SEASON_DAYS,
  SERVICE_WEIGHTS,
  SKY_TABLE,
  START_CASH,
  START_POPULARITY,
} from '../core/config';

const SKY_LABEL: Record<Sky, string> = {
  sunny: '☀️ Sunny',
  partlyCloudy: '🌤️ Partly cloudy',
  cloudy: '☁️ Cloudy',
  rain: '🌧️ Rain',
  storm: '⛈️ Storm',
};
const ITEM_LABEL: Record<Item, string> = { lemons: '🍋 Lemons', sugar: '🍬 Sugar', ice: '🧊 Ice', cups: '🥤 Cups' };

const money = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const times = (n: number) => `×${Number(n.toFixed(2))}`;

const tempFactor = (t: number) => DEMAND.tempFactorAt60 + (t - 60) * DEMAND.tempFactorPerDegree;
const heatBonus = (t: number) => DEMAND.heatBonusAt60 + (t - 60) * DEMAND.heatBonusPerDegree;

function describeNews(e: NewsEvent): string {
  const parts: string[] = [];
  if (e.tempBonusF) parts.push(`+${e.tempBonusF}°F`);
  if (e.trafficMultiplier !== 1) parts.push(`foot traffic ${times(e.trafficMultiplier)}`);
  if (e.maxPayMultiplier !== 1) parts.push(`customers will pay ${times(e.maxPayMultiplier)}`);
  for (const [item, m] of Object.entries(e.priceMultipliers)) parts.push(`${item} price ${times(m!)}`);
  if (e.extraArrivals) parts.push(`+${e.extraArrivals.count} ${CUSTOMER_TYPES[e.extraArrivals.type].label}s arrive together`);
  return parts.join(', ') || 'no effect';
}

const table: React.CSSProperties = { borderCollapse: 'collapse', margin: '8px 0' };
const cell: React.CSSProperties = { border: '1px solid #ccc', padding: '4px 8px', textAlign: 'left' };

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <table style={table}>
      <thead>
        <tr>
          {head.map((h) => (
            <th style={cell} key={h}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td style={cell} key={j}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function About({ onBack }: { onBack: () => void }) {
  const skyTotal = SKY_LADDER.reduce((s, sky) => s + SKY_TABLE[sky].weight, 0);
  const newsTotal = NEWS_TABLE.reduce((s, n) => s + n.weight, 0);
  const types = Object.keys(CUSTOMER_TYPES) as CustomerTypeId[];
  const jitter = DEMAND.maxPayJitter;

  return (
    <div>
      <button onClick={onBack}>← Back to the game</button>
      <h2>📖 How it works</h2>
      <p>Every number on this page comes straight from the game's config, so it's exactly what the game uses.</p>

      <h3>🎯 Goal</h3>
      <p>
        You start with {money(START_CASH)}. After {SEASON_DAYS} days, your cash is your score (leftover stock is worth
        nothing). You go <b>bankrupt</b> if, after the ice melts at night, you can't make a glass <i>and</i> can't
        afford the cheapest pack of each missing item.
      </p>

      <h3>🛒 Supplies</h3>
      <p>
        <b>One glass = 1 lemon + 1 sugar + 1 ice + 1 cup.</b> <b>Ice melts every night.</b> Everything else keeps
        forever, so it's safe to buy in bulk.
      </p>
      <Table
        head={['Item', 'Small', 'Medium', 'Large']}
        rows={ITEMS.map((item) => [
          ITEM_LABEL[item],
          ...PACKS[item].map((p) => `${p.size} for ${money(p.price)} (${money(p.price / p.size)} each)`),
        ])}
      />

      <h3>🌦️ Weather</h3>
      <p>
        <b>Temperature</b> changes both how many people walk by and how much they'll pay. Summer peaks mid-July.
      </p>
      <Table
        head={['Temperature', 'Foot traffic', 'What people will pay']}
        rows={[60, 70, 80, 90, 100].map((t) => [`${t}°F`, times(tempFactor(t)), times(heatBonus(t))])}
      />
      <p>
        <b>Sky</b> changes how many people are outside.
      </p>
      <Table
        head={['Sky', 'Chance on any day', 'Foot traffic']}
        rows={SKY_LADDER.map((sky) => [
          SKY_LABEL[sky],
          pct(SKY_TABLE[sky].weight / skyTotal),
          SKY_TABLE[sky].traffic === 0 ? '×0 — nobody comes' : times(SKY_TABLE[sky].traffic),
        ])}
      />

      <h3>📺 What Walt's forecast means</h3>
      <p>
        Every day's real weather is decided in advance; Walt sees it through some noise. The closer the day, the more
        accurate he is. When he gets the sky wrong, he's off by <b>one step</b> on the scale{' '}
        {SKY_LADDER.map((s) => SKY_LABEL[s]).join(' → ')} — "cloudy" might really be partly cloudy or rain, never sunny
        or a storm.
      </p>
      <Table
        head={['Walt says', 'For', 'Sky is right', 'Temperature is within']}
        rows={FORECAST_ACCURACY.map((f, i) => [
          `"${f.confidence}"`,
          ['Today', 'Tomorrow', 'The day after'][i],
          pct(f.skyCorrect),
          `±${f.tempErrorF}°F`,
        ])}
      />
      <p>
        💡 Buy <b>ice</b> for today's forecast only. Use tomorrow and the day after to decide whether to stock up on
        lemons, sugar and cups.
      </p>

      <h3>🚶 Who walks by, and who stops</h3>
      <p>
        <b>Passersby</b> = {DEMAND.baseTraffic} × temperature × sky × news × (1 + popularity ×{' '}
        {DEMAND.popularityTrafficPerPoint}). Each passerby is one of the types below. Their <b>limit</b> is the base
        price × the heat bonus × a random {pct(1 - jitter)}–{pct(1 + jitter)}.{' '}
        <b>They stop if your price is at or below their limit</b>; otherwise they walk on (shown as "too expensive" in
        the report).
      </p>
      <Table
        head={['Customer', 'Share', 'Base limit', 'Limit at 80°F', 'Patience', 'Tip (on green)']}
        rows={types.map((t) => {
          const c = CUSTOMER_TYPES[t];
          const at80 = c.basePay * heatBonus(80);
          return [
            `${c.emoji} ${c.label}`,
            pct(c.share),
            money(c.basePay),
            `${money(at80 * (1 - jitter))}–${money(at80 * (1 + jitter))}`,
            `${c.patienceMs / 1000}s`,
            pct(c.tipRate),
          ];
        })}
      />

      <h3>🏃 The Rush — who to serve first</h3>
      <ul>
        <li>
          Hold <b>Space</b> at the 🍋 station to make a glass, then run to a customer and press <b>Space</b> to serve.
          You carry one glass at a time.
        </li>
        <li>
          Patience bar: 🟩 green (over 60%) → full tip, 🟨 yellow (30–60%) → half tip, 🟥 red (under 30%) → no tip. At
          zero they walk out without paying (no stock used).
        </li>
        <li>
          <b>Joggers</b> have the least patience — serve them first. <b>Grandmas</b> wait longest and tip the most, so
          don't let them slip to red. <b>Kids</b> never tip.
        </li>
        <li>If every spot is full, new arrivals leave ("no room"). If you run out of stock, the day ends early.</li>
      </ul>

      <h3>⭐ Service rating & popularity</h3>
      <p>Every customer who stopped counts toward the day's service rating (the average):</p>
      <Table
        head={['What happened', 'Counts as']}
        rows={[
          ['Served on 🟩 green', pct(SERVICE_WEIGHTS.green)],
          ['Served on 🟨 yellow', pct(SERVICE_WEIGHTS.yellow)],
          ['Served on 🟥 red', pct(SERVICE_WEIGHTS.red)],
          ['No room at the counter', pct(SERVICE_WEIGHTS.noRoom)],
          ['Missed because you sold out', pct(SERVICE_WEIGHTS.soldOut)],
          ['Walked out', pct(SERVICE_WEIGHTS.walkout)],
        ]}
      />
      <p>
        Overnight, popularity changes by (rating − 50%) × {POPULARITY.changeScale}, then drifts{' '}
        {pct(POPULARITY.drift)} back toward {POPULARITY.anchor}. It starts at {START_POPULARITY} and each point adds{' '}
        {pct(DEMAND.popularityTrafficPerPoint)} foot traffic. 💡 Pricing so low that you can't keep up costs you
        popularity — price to the crowd you can handle.
      </p>

      <h3>📰 News</h3>
      <Table
        head={['Headline', 'Chance', 'Effect']}
        rows={[
          ...NEWS_TABLE.map((n) => [n.event.headline, pct(n.weight / newsTotal), describeNews(n.event)]),
          [JULY_4TH.headline, `Always day ${JULY_4TH_DAY}`, describeNews(JULY_4TH)],
        ]}
      />

      <button onClick={onBack}>← Back to the game</button>
    </div>
  );
}
