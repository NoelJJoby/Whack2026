import type { AgentProfile, EventType } from '../shared/types';

export const cast: AgentProfile[] = [
  { id: 'ceo', name: 'CEO', archetype: 'CEO', role: 'Manager', functionGroup: 'Manager', traits: { ambition: 0, financial_need: 0, ethics: 0, sociability: 0, distortion_rate: 0, quit_threshold: 0 } },
  { id: 'ops', name: 'Ops Manager', archetype: 'Ops manager', role: 'Manager', functionGroup: 'Manager', traits: { ambition: 0, financial_need: 0, ethics: 0, sociability: 0, distortion_rate: 0, quit_threshold: 0 } },
  { id: 'gossip', name: 'Gossip Hub', archetype: 'Gossip hub', role: 'Staff', functionGroup: 'Sales', traits: { ambition: 0, financial_need: 0, ethics: 0, sociability: 0, distortion_rate: 0, quit_threshold: 0 } },
  { id: 'climber', name: 'Climber', archetype: 'Climber', role: 'Staff', functionGroup: 'Sales', traits: { ambition: 0, financial_need: 0, ethics: 0, sociability: 0, distortion_rate: 0, quit_threshold: 0 } },
  { id: 'loyalist', name: 'Loyalist', archetype: 'Loyalist', role: 'Staff', functionGroup: 'Engineering', traits: { ambition: 0, financial_need: 0, ethics: 0, sociability: 0, distortion_rate: 0, quit_threshold: 0 } },
  { id: 'skeptic', name: 'Skeptic', archetype: 'Skeptic', role: 'Staff', functionGroup: 'Engineering', traits: { ambition: 0, financial_need: 0, ethics: 0, sociability: 0, distortion_rate: 0, quit_threshold: 0 } },
  { id: 'breadwinner', name: 'Breadwinner', archetype: 'Breadwinner', role: 'Staff', functionGroup: 'Operations', traits: { ambition: 0, financial_need: 0, ethics: 0, sociability: 0, distortion_rate: 0, quit_threshold: 0 } },
  { id: 'flight', name: 'Flight Risk', archetype: 'Flight risk', role: 'Staff', functionGroup: 'Engineering', traits: { ambition: 0, financial_need: 0, ethics: 0, sociability: 0, distortion_rate: 0, quit_threshold: 0 } },
];

export const scenarioEvents: EventType[] = [
  'merger',
  'new_management',
  'long_hours_policy',
  'pr_scandal',
  'layoffs_rumour',
  'surprise_bonus',
  'competitor_poaching',
];
