import type { AgentProfile, AgentState, EventType } from '../shared/types';

export const cast: AgentProfile[] = [
  { id: 'ceo', name: 'CEO', archetype: 'CEO', role: 'Manager', functionGroup: 'Exec', traits: { ambition: 90, financial_need: 20, ethics: 65, sociability: 25, distortion_rate: 10, quit_threshold: 72, impulsivity: 40, recruiter_contact: false } },
  { id: 'ops', name: 'Ops Manager', archetype: 'Ops manager', role: 'Manager', functionGroup: 'Operations', traits: { ambition: 60, financial_need: 35, ethics: 55, sociability: 40, distortion_rate: 15, quit_threshold: 74, impulsivity: 30, recruiter_contact: false } },
  { id: 'gossip', name: 'Gossip Hub', archetype: 'Gossip hub', role: 'Staff', functionGroup: 'Sales', traits: { ambition: 35, financial_need: 30, ethics: 50, sociability: 95, distortion_rate: 65, quit_threshold: 78, impulsivity: 70, recruiter_contact: false } },
  { id: 'climber', name: 'Climber', archetype: 'Climber', role: 'Staff', functionGroup: 'Sales', traits: { ambition: 88, financial_need: 40, ethics: 45, sociability: 50, distortion_rate: 50, quit_threshold: 76, impulsivity: 55, recruiter_contact: false } },
  { id: 'loyalist', name: 'Loyalist', archetype: 'Loyalist', role: 'Staff', functionGroup: 'Engineering', traits: { ambition: 30, financial_need: 55, ethics: 80, sociability: 45, distortion_rate: 20, quit_threshold: 82, impulsivity: 25, recruiter_contact: false } },
  { id: 'skeptic', name: 'Skeptic', archetype: 'Skeptic', role: 'Staff', functionGroup: 'Engineering', traits: { ambition: 50, financial_need: 25, ethics: 90, sociability: 35, distortion_rate: 30, quit_threshold: 70, impulsivity: 45, recruiter_contact: false } },
  { id: 'breadwinner', name: 'Breadwinner', archetype: 'Breadwinner', role: 'Staff', functionGroup: 'Operations', traits: { ambition: 40, financial_need: 90, ethics: 60, sociability: 50, distortion_rate: 25, quit_threshold: 68, impulsivity: 20, recruiter_contact: false } },
  { id: 'flight', name: 'Flight Risk', archetype: 'Flight risk', role: 'Staff', functionGroup: 'Engineering', traits: { ambition: 65, financial_need: 80, ethics: 35, sociability: 45, distortion_rate: 40, quit_threshold: 65, impulsivity: 60, recruiter_contact: true } },
];

const baseStates: Record<string, AgentState> = {
  ceo: { stress: 28, workload: 42, loyalty: 72, trust_mgmt: 78, burnout: 24, affinity: {}, source_trust: {} },
  ops: { stress: 36, workload: 48, loyalty: 68, trust_mgmt: 70, burnout: 31, affinity: {}, source_trust: {} },
  gossip: { stress: 40, workload: 45, loyalty: 62, trust_mgmt: 68, burnout: 28, affinity: {}, source_trust: {} },
  climber: { stress: 42, workload: 50, loyalty: 58, trust_mgmt: 63, burnout: 32, affinity: {}, source_trust: {} },
  loyalist: { stress: 30, workload: 44, loyalty: 82, trust_mgmt: 74, burnout: 20, affinity: {}, source_trust: {} },
  skeptic: { stress: 34, workload: 43, loyalty: 60, trust_mgmt: 52, burnout: 29, affinity: {}, source_trust: {} },
  breadwinner: { stress: 46, workload: 52, loyalty: 66, trust_mgmt: 58, burnout: 33, affinity: {}, source_trust: {} },
  flight: { stress: 44, workload: 49, loyalty: 54, trust_mgmt: 55, burnout: 35, affinity: {}, source_trust: {} },
};

export function buildAgentState(profile: AgentProfile): AgentState {
  const base = baseStates[profile.id] ?? {
    stress: 35,
    workload: 45,
    loyalty: 60,
    trust_mgmt: 60,
    burnout: 25,
    affinity: {},
    source_trust: {},
  };

  return {
    stress: base.stress,
    workload: base.workload,
    loyalty: base.loyalty,
    trust_mgmt: base.trust_mgmt,
    burnout: base.burnout,
    affinity: Object.fromEntries(cast.map((agent) => [agent.id, agent.id === profile.id ? 60 : 50])),
    source_trust: Object.fromEntries(cast.map((agent) => [agent.id, agent.id === profile.id ? 60 : 50])),
  };
}

export const scenarioEvents: EventType[] = [
  'merger',
  'new_management',
  'long_hours_policy',
  'pr_scandal',
  'layoffs_rumour',
  'surprise_bonus',
  'competitor_poaching',
];
