import type { AgentState } from '../../shared/types';

export function stressSentence(value: number): string {
  return value < 40 ? 'You feel on top of things.'
    : value < 70 ? "You're stretched and short-tempered."
      : "You're overwhelmed and close to snapping.";
}

export function burnoutSentence(value: number): string {
  return value < 40 ? 'You have energy for the work.'
    : value < 70 ? "You're running on fumes most days."
      : 'You dread opening your laptop.';
}

export function loyaltySentence(value: number): string {
  return value < 40 ? "You'd happily leave for a better offer."
    : value < 70 ? 'You care about the team but have limits.'
      : 'This place feels like part of who you are.';
}

export function managementTrustSentence(value: number): string {
  return value < 40 ? 'You assume leadership is lying to you.'
    : value < 70 ? 'You doubt what leadership tells you.'
      : 'You think leadership mostly means well.';
}

// Workload has no supplied wording table; do not invent a fifth sentence.
export function stateParagraph(
  state: Pick<AgentState, 'stress' | 'burnout' | 'loyalty' | 'trust_mgmt'>,
): string {
  return [stressSentence(state.stress), burnoutSentence(state.burnout),
    loyaltySentence(state.loyalty), managementTrustSentence(state.trust_mgmt)].join(' ');
}
