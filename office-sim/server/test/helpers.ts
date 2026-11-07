import type { EngineAgent, EngineClaim, EngineTraits, World } from '../engine-types';
import type { AgentState } from '../../shared/types';

export function makeAgent(
  id: string,
  state: Partial<AgentState>,
  traits: Partial<EngineTraits> = {},
  extra: Partial<EngineAgent> = {},
): EngineAgent {
  return {
    id,
    profile: {
      id,
      name: id[0].toUpperCase() + id.slice(1),
      archetype: 'Test',
      role: 'Staff',
      functionGroup: 'Engineering',
      traits: {
        ambition: 50,
        financial_need: 50,
        ethics: 50,
        sociability: 50,
        distortion_rate: 0,
        quit_threshold: 80,
        impulsivity: 50,
        recruiter_contact: false,
        ...traits,
      },
    },
    state: {
      stress: 50,
      workload: 45,
      loyalty: 50,
      trust_mgmt: 50,
      burnout: 20,
      affinity: {},
      source_trust: {},
      ...state,
    },
    status: 'active',
    quitTick: null,
    interviewTicks: [],
    baselineWorkload: 45,
    claims: [],
    ...extra,
  };
}

export function makeClaim(id: string, extra: Partial<EngineClaim> = {}): EngineClaim {
  return {
    id,
    text: `claim ${id}`,
    is_true: true,
    source: 'mgmt',
    created_tick: 0,
    hops: 0,
    scandal: false,
    parentId: null,
    rootId: id,
    event: null,
    onHear: { stress: 0, trust_mgmt: 0, loyalty: 0 },
    ...extra,
  };
}

export function makeWorld(agents: EngineAgent[], claims: EngineClaim[] = [], tick = 5, seed = 1): World {
  return {
    seed,
    tick,
    ids: agents.map((a) => a.id),
    agents: Object.fromEntries(agents.map((a) => [a.id, a])),
    claims: Object.fromEntries(claims.map((c) => [c.id, c])),
    queue: [],
    quits: [],
    leaks: [],
  };
}
