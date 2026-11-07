// Local cast and scenario fixture. data.ts (LLM and Data lane) still has every
// trait at 0, so the engine uses this until it is filled in. Archetypes follow
// office-sim/agent.md; impulsivity follows the bias brief.
import type { CastMember, EngineTraits, ScenarioEvent } from '../engine-types';
import { DEFAULT_PARAMS, type Params } from '../params';
import { stream } from '../rng';

type Base = Omit<CastMember, 'profile'> & { profile: Omit<CastMember['profile'], 'traits'> & { traits: EngineTraits } };

export const BASE_CAST: Base[] = [
  {
    profile: { id: 'ceo', name: 'Dan', archetype: 'CEO', role: 'Manager', functionGroup: 'Exec',
      traits: { ambition: 85, financial_need: 20, ethics: 45, sociability: 40, distortion_rate: 10, quit_threshold: 90, impulsivity: 40, recruiter_contact: false } },
    start: { stress: 35, workload: 55, loyalty: 80, trust_mgmt: 80, burnout: 20 },
  },
  {
    profile: { id: 'ops', name: 'Omar', archetype: 'Ops manager', role: 'Manager', functionGroup: 'Operations',
      traits: { ambition: 55, financial_need: 55, ethics: 55, sociability: 50, distortion_rate: 15, quit_threshold: 80, impulsivity: 30, recruiter_contact: false } },
    start: { stress: 45, workload: 55, loyalty: 65, trust_mgmt: 60, burnout: 35 },
  },
  {
    profile: { id: 'gossip', name: 'Priya', archetype: 'Gossip hub', role: 'Staff', functionGroup: 'Sales',
      traits: { ambition: 45, financial_need: 45, ethics: 40, sociability: 90, distortion_rate: 45, quit_threshold: 80, impulsivity: 70, recruiter_contact: false } },
    start: { stress: 35, workload: 45, loyalty: 55, trust_mgmt: 50, burnout: 25 },
  },
  {
    profile: { id: 'climber', name: 'Marcus', archetype: 'Climber', role: 'Staff', functionGroup: 'Sales',
      traits: { ambition: 90, financial_need: 40, ethics: 30, sociability: 60, distortion_rate: 30, quit_threshold: 80, impulsivity: 55, recruiter_contact: false } },
    start: { stress: 40, workload: 55, loyalty: 50, trust_mgmt: 55, burnout: 30 },
  },
  {
    profile: { id: 'loyalist', name: 'Tom', archetype: 'Loyalist', role: 'Staff', functionGroup: 'Engineering',
      traits: { ambition: 40, financial_need: 40, ethics: 60, sociability: 35, distortion_rate: 5, quit_threshold: 85, impulsivity: 25, recruiter_contact: false } },
    start: { stress: 30, workload: 50, loyalty: 85, trust_mgmt: 75, burnout: 10 },
  },
  {
    profile: { id: 'skeptic', name: 'Sam', archetype: 'Skeptic', role: 'Staff', functionGroup: 'Engineering',
      traits: { ambition: 40, financial_need: 35, ethics: 85, sociability: 45, distortion_rate: 10, quit_threshold: 80, impulsivity: 45, recruiter_contact: false } },
    start: { stress: 40, workload: 45, loyalty: 45, trust_mgmt: 25, burnout: 30, source_trust: { ops: 65 } },
  },
  {
    profile: { id: 'breadwinner', name: 'Rosa', archetype: 'Breadwinner', role: 'Staff', functionGroup: 'Operations',
      traits: { ambition: 35, financial_need: 90, ethics: 55, sociability: 40, distortion_rate: 10, quit_threshold: 95, impulsivity: 20, recruiter_contact: false } },
    start: { stress: 45, workload: 55, loyalty: 60, trust_mgmt: 50, burnout: 35 },
  },
  {
    profile: { id: 'flight', name: 'Lena', archetype: 'Flight risk', role: 'Staff', functionGroup: 'Engineering',
      traits: { ambition: 50, financial_need: 30, ethics: 50, sociability: 40, distortion_rate: 15, quit_threshold: 70, impulsivity: 60, recruiter_contact: true } },
    start: { stress: 50, workload: 50, loyalty: 35, trust_mgmt: 40, burnout: 50 },
  },
];

const NUMERIC_TRAITS = [
  'ambition', 'financial_need', 'ethics', 'sociability', 'distortion_rate', 'quit_threshold', 'impulsivity',
] as const;

/** The cast for one run: every fixed trait is its archetype value +/- traitJitter, drawn from the run seed. */
export function fixtureCast(seed: number, params: Params = DEFAULT_PARAMS, jitter = true): CastMember[] {
  return BASE_CAST.map((c) => {
    const rng = stream(seed, 0, c.profile.id, 'traits');
    const traits = { ...c.profile.traits };
    if (jitter) {
      const j = params.setup.traitJitter;
      for (const k of NUMERIC_TRAITS) traits[k] = Math.min(100, Math.max(0, Math.round(traits[k] + (rng.next() * 2 - 1) * j)));
    }
    return { profile: { ...c.profile, traits }, start: structuredClone(c.start) };
  });
}

/** Scripted shock scenario for the checkpoint and ablations. */
export const SHOCK_SCENARIO: ScenarioEvent[] = [
  { tick: 1, type: 'merger', isTrue: true },
  { tick: 3, type: 'long_hours_policy', isTrue: true },
  { tick: 6, type: 'layoffs_rumour', isTrue: false, hearers: ['gossip'], source: 'grapevine' },
  { tick: 9, type: 'pr_scandal', isTrue: true, hearers: ['skeptic'], source: 'ops' },
  { tick: 12, type: 'surprise_bonus', isTrue: true },
];

/** No billboard events: the calm baseline. */
export const CALM_SCENARIO: ScenarioEvent[] = [];
