import type { Action, AgentState, EventType } from '../shared/types';

export function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

export function passiveUpdate(state: AgentState, _eventType?: EventType): AgentState {
  return {
    ...state,
    stress: clamp(state.stress),
    workload: clamp(state.workload),
    loyalty: clamp(state.loyalty),
    trust_mgmt: clamp(state.trust_mgmt),
    burnout: clamp(state.burnout),
  };
}

export function resolveAction(state: AgentState, action: Action): AgentState {
  switch (action) {
    case 'work':
      return { ...state, workload: clamp(state.workload + 5) };
    case 'overwork':
      return { ...state, workload: clamp(state.workload + 10), stress: clamp(state.stress + 10) };
    case 'slack_off':
      return { ...state, workload: clamp(state.workload - 5), stress: clamp(state.stress - 5) };
    default:
      return { ...state };
  }
}

export function checkQuit(state: AgentState): boolean {
  return state.burnout >= 80 && (state.loyalty <= 30 || state.trust_mgmt <= 35);
}
