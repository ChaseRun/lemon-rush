// Pure reducer over the engine functions, for React's useReducer.

import type { GameAction, GameState } from '../contract';
import { endDay } from './day';
import { buy } from './shop';
import { newGame, setPrice } from './state';

/**
 * Invalid actions return the state unchanged instead of throwing:
 * a failed buy, any action after the game is over, or a finishDay whose plan
 * is not for today (e.g. a duplicate dispatch from a double-fired callback).
 */
export function gameReducer(state: GameState, action: GameAction): GameState {
  if (action.type === 'newGame') return newGame(action.seed);
  if (state.status !== 'playing') return state;
  switch (action.type) {
    case 'buy': {
      const result = buy(state, action.item, action.packIdx);
      return result.ok ? result.state : state;
    }
    case 'setPrice':
      return setPrice(state, action.price);
    case 'finishDay':
      if (action.plan.day !== state.day) return state;
      return endDay(state, action.plan, action.outcome).state;
    default:
      return state;
  }
}
