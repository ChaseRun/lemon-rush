import { useEffect } from 'react';
import type { DayOutcome, DayPlan } from '../contract';
import { fixtureEngine } from '../fixtures';

export function RushGame({ plan, onFinish }: { plan: DayPlan; onFinish: (outcome: DayOutcome) => void }) {
  useEffect(() => {
    onFinish(fixtureEngine.autoServe(plan));
  }, [plan, onFinish]);
  return <p>Rush placeholder: auto-serving…</p>;
}
