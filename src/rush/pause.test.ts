import { describe, expect, it } from 'vitest';
import { fixturePlan } from '../fixtures';
import { coinFrameIndex } from './pixel/fx';
import { COIN_FRAMES } from './pixel/sprites';
import { NO_INPUT, createRush, endDayEarly, isOver, step, toOutcome, type RushState } from './rushRules';

/** Every arrival must land in exactly one bucket. */
function accounted(s: RushState): number {
  const o = toOutcome(s);
  return o.served.length + o.walkouts + o.noRoom + o.soldOutMisses + o.leftAtClose;
}

describe('coin pop-up frames (regression: the Rush froze right after the first serve)', () => {
  it('is always a valid frame, even while a lagging coin has a negative age', () => {
    for (let age = 0; age < 1000; age += 7) {
      for (const offset of [-60, 0, 60]) {
        const i = coinFrameIndex(age, offset, COIN_FRAMES.length);
        expect(COIN_FRAMES[i]).toBeDefined();
      }
    }
    expect(coinFrameIndex(10, -60, COIN_FRAMES.length)).toBe(0);
  });
});

describe('endDayEarly (pause menu: End the day now)', () => {
  it('closes the stand immediately and counts everyone still to come as leftAtClose', () => {
    let s = createRush(fixturePlan);
    s = step(s, 10_000, NO_INPUT);
    expect(isOver(s)).toBe(false);
    const ended = endDayEarly(s);
    expect(isOver(ended)).toBe(true);
    expect(ended.phase).toBe('closed');
    const o = toOutcome(ended);
    expect(o.leftAtClose).toBeGreaterThan(0);
    expect(accounted(ended)).toBe(fixturePlan.arrivals.length);
  });

  it('pours out lemonade already made: lemons and sugar stay used, no cups or ice are used', () => {
    let s = createRush(fixturePlan);
    // the kid starts at the prep station; hold Space long enough to fill the jug
    for (let t = 0; t < 2200; t += 50) s = step(s, 50, { left: false, right: false, space: true });
    expect(s.jug).toBeGreaterThan(0);
    const made = s.jug + (s.holdingGlass ? 1 : 0);
    const o = toOutcome(endDayEarly(s));
    expect(o.pouredOut).toBe(made);
    expect(o.used.lemons).toBe(10);
    expect(o.used.cups).toBe(0);
    expect(o.used.ice).toBe(0);
  });

  it('does not change the state it is given, and does nothing once the day is over', () => {
    const s = step(createRush(fixturePlan), 5_000, NO_INPUT);
    const before = JSON.stringify(s);
    const ended = endDayEarly(s);
    expect(JSON.stringify(s)).toBe(before);
    expect(endDayEarly(ended)).toBe(ended);
  });
});
