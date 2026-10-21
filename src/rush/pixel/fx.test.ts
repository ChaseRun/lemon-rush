import { describe, expect, it } from 'vitest';
import { fixturePlan } from '../../fixtures';
import { RUSH } from '../rushConfig';
import { type RushState, createRush } from '../rushRules';
import { createFx, toArtX, updateFx } from './fx';

/** A state with one customer waiting at spot 0 and the given events, as if a step() just emitted them. */
function withEvents(events: RushState['events']): [RushState, RushState] {
  const base = createRush({ ...fixturePlan, arrivals: [] });
  const arrival = { id: 7, atMs: 0, type: 'grandma' as const, maxPay: 5, patienceMs: 10_000, tipRate: 0.2 };
  const prev: RushState = { ...base, spots: [{ arrival, patienceLeftMs: 5000 }, null, null] };
  return [prev, { ...prev, spots: [null, null, null], events }];
}

describe('view fx', () => {
  it('a serve adds a coin pop-up and a happy customer walking off', () => {
    const [prev, next] = withEvents([{ kind: 'served', atMs: 0, spot: 0, amount: 2.4, text: '+$2.40' }]);
    const fx = updateFx(createFx(), prev, next, 16);
    expect(fx.popups).toMatchObject([{ text: '+$2.40', coins: true, x: toArtX(RUSH.spotX[0]) }]);
    expect(fx.leavers).toMatchObject([{ type: 'grandma', angry: false }]);
    expect(fx.hopMs).toBeGreaterThan(0);
  });

  it('a walkout sends the customer off angry', () => {
    const [prev, next] = withEvents([{ kind: 'walkout', atMs: 0, spot: 0 }]);
    const fx = updateFx(createFx(), prev, next, 16);
    expect(fx.leavers).toMatchObject([{ type: 'grandma', angry: true }]);
  });

  it('pop-ups and leavers expire, and the kid faces the way he moved', () => {
    const [prev, next] = withEvents([{ kind: 'served', atMs: 0, spot: 0, amount: 2, text: '+$2.00' }]);
    let fx = updateFx(createFx(), prev, next, 16);
    const moved = { ...next, kidX: next.kidX + 10, events: [] };
    fx = updateFx(fx, next, moved, 5000);
    expect(fx.popups).toEqual([]);
    expect(fx.leavers).toEqual([]);
    expect([fx.facing, fx.running]).toEqual([1, true]);
  });
});
