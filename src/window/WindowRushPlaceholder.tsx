import { useEffect } from 'react';
import type { DayOutcome, DayPlan } from '../contract';
import { fixtureEngine } from '../fixtures';

/** Placeholder: auto-serves immediately until the real window-style Rush exists. */
export function WindowRush({ plan, onFinish }: { plan: DayPlan; onFinish: (outcome: DayOutcome) => void }) {
  useEffect(() => {
    onFinish(fixtureEngine.autoServe(plan));
  }, [plan, onFinish]);
  return <p>Window Rush placeholder: auto-serving…</p>;
}
