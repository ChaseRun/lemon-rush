import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { DayOutcome } from './contract';
import { fixturePlan } from './fixtures';
import { RushGame } from './rush';
import { App } from './ui/App';
import { StartScreen } from './ui/start/StartScreen';

/** Dev page: /?rush=fixture plays the Rush with the fixture plan and logs the outcome. */
function RushFixturePage() {
  const [outcome, setOutcome] = useState<DayOutcome | null>(null);
  return (
    <div>
      <h1>Rush test page (fixture plan)</h1>
      {outcome ? (
        <pre>{JSON.stringify(outcome, null, 2)}</pre>
      ) : (
        <RushGame
          plan={fixturePlan}
          onFinish={(o) => {
            console.log('[rush outcome]', o);
            setOutcome(o);
          }}
        />
      )}
    </div>
  );
}

const params = new URLSearchParams(location.search);
const isRushFixture = params.get('rush') === 'fixture';
const isStartPreview = params.has('start');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isStartPreview ? <StartScreen onStart={() => console.log('[start] start')} onRules={() => console.log('[start] rules')} /> : isRushFixture ? <RushFixturePage /> : <App />}</StrictMode>,
);
