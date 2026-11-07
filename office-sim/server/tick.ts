import type { EventType, SimulationState } from '../shared/types';

export function createInitialSimulation(seed = 42): SimulationState {
  return {
    tick: 0,
    seed,
    started: false,
    running: false,
    event: null,
    queue: [],
    feed: ['Simulation ready.'],
    claims: [],
    agents: {},
    metrics: {
      crack_order: [],
      first_quit_tick: null,
      true_reach: 0,
      false_reach: 0,
    },
  };
}

export function stepSimulation(state: SimulationState): SimulationState {
  return {
    ...state,
    tick: state.tick + 1,
    feed: [...state.feed, `Tick ${state.tick + 1} complete.`],
  };
}

export function injectEvent(state: SimulationState, event: EventType): SimulationState {
  return {
    ...state,
    queue: [...state.queue, event],
    feed: [...state.feed, `Queued event: ${event}`],
  };
}
