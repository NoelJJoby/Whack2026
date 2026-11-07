import type { AgentRuntimeState, EventType, SimulationState } from '../shared/types';
import { buildAgentState, cast } from './data';
import { checkQuit, passiveUpdate, resolveAction } from './rules';

export function createInitialSimulation(seed = 42): SimulationState {
  const agents = Object.fromEntries(
    cast.map((profile) => {
      const base = buildAgentState(profile);
      const runtime: AgentRuntimeState = {
        ...base,
        status: 'active',
        quit_tick: null,
      };
      return [profile.id, runtime];
    }),
  );

  return {
    tick: 0,
    seed,
    started: false,
    running: false,
    event: null,
    queue: [],
    feed: ['Simulation ready.'],
    claims: [],
    agents,
    metrics: {
      crack_order: [],
      first_quit_tick: null,
      true_reach: 0,
      false_reach: 0,
    },
    mode: 'llm_bias',
  };
}

export function stepSimulation(state: SimulationState): SimulationState {
  const nextTick = state.tick + 1;
  const queue = [...state.queue];
  const event = queue.shift() ?? state.event;

  const nextAgents = Object.fromEntries(
    Object.entries(state.agents).map(([agentId, agentState]) => {
      const passive = passiveUpdate(agentState, event ?? undefined);
      const resolved = resolveAction(passive, 'work');
      const hasQuit = checkQuit(resolved);

      const nextAgent: AgentRuntimeState = {
        ...resolved,
        status: hasQuit ? 'quit' : agentState.status,
        quit_tick: hasQuit ? nextTick : agentState.quit_tick,
      };

      if (hasQuit && agentState.status !== 'quit') {
        nextAgent.status = 'quit';
        nextAgent.quit_tick = nextTick;
      }

      return [agentId, nextAgent];
    }),
  );

  const nextFeed = [...state.feed];
  if (event) {
    nextFeed.push(`Event ${event} applied on tick ${nextTick}.`);
  }
  nextFeed.push(`Tick ${nextTick} complete.`);

  const trueReach = state.claims.filter((claim) => claim.is_true).length;
  const falseReach = state.claims.filter((claim) => !claim.is_true).length;

  return {
    ...state,
    tick: nextTick,
    event,
    queue,
    agents: nextAgents,
    feed: nextFeed,
    metrics: {
      ...state.metrics,
      true_reach: trueReach,
      false_reach: falseReach,
    },
  };
}

export function injectEvent(state: SimulationState, event: EventType): SimulationState {
  return {
    ...state,
    queue: [...state.queue, event],
    event,
  };
}
