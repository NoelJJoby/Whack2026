import type { Action, AgentState, EventType } from '../shared/types';

export function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

export function passiveUpdate(state: AgentState, eventType?: EventType): AgentState {
  const nextStress = state.workload > 45 ? clamp(state.stress + 4) : clamp(state.stress - 2);
  const nextBurnout = state.stress > 60 ? clamp(state.burnout + 6) : clamp(state.burnout - 2);

  const nextState: AgentState = {
    ...state,
    stress: nextStress,
    workload: clamp(state.workload),
    loyalty: clamp(state.loyalty),
    trust_mgmt: clamp(state.trust_mgmt),
    burnout: nextBurnout,
  };

  if (eventType === 'long_hours_policy') {
    nextState.workload = clamp(nextState.workload + 8);
    nextState.stress = clamp(nextState.stress + 10);
    nextState.burnout = clamp(nextState.burnout + 8);
  }

  if (eventType === 'new_management' || eventType === 'merger') {
    nextState.trust_mgmt = clamp(nextState.trust_mgmt - 5);
  }

  return nextState;
}

export function resolveAction(state: AgentState, action: Action): AgentState {
  switch (action) {
    case 'work':
      return { ...state, workload: clamp(state.workload + 3), stress: clamp(state.stress - 2) };
    case 'overwork':
      return { ...state, workload: clamp(state.workload + 12), stress: clamp(state.stress + 10), burnout: clamp(state.burnout + 8) };
    case 'slack_off':
      return { ...state, workload: clamp(state.workload - 8), stress: clamp(state.stress - 6), trust_mgmt: clamp(state.trust_mgmt - 3) };
    case 'complain':
      return { ...state, stress: clamp(state.stress + 3), trust_mgmt: clamp(state.trust_mgmt - 2) };
    case 'gossip':
      return { ...state, stress: clamp(state.stress + 2), burnout: clamp(state.burnout + 2) };
    case 'verify':
      return { ...state, trust_mgmt: clamp(state.trust_mgmt + 2), stress: clamp(state.stress - 1) };
    case 'interview':
      return { ...state, burnout: clamp(state.burnout + 7), loyalty: clamp(state.loyalty - 3) };
    case 'leak':
      return { ...state, stress: clamp(state.stress + 8), trust_mgmt: clamp(state.trust_mgmt - 10), loyalty: clamp(state.loyalty - 6) };
    default:
      return { ...state };
  }
}

export function checkQuit(state: AgentState, burnoutThreshold = 80, loyaltyThreshold = 30, trustThreshold = 35): boolean {
  return state.burnout >= burnoutThreshold && (state.loyalty <= loyaltyThreshold || state.trust_mgmt <= trustThreshold);
}
