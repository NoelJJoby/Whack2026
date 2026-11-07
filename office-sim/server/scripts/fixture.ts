// Local cast and scenario fixture: the engine's tuned, seeded test cast.
// Archetypes follow office-sim/agent.md; impulsivity follows the bias brief.
// dataCast() wraps the LLM and Data lane's cast in data.ts for comparison runs.
import { buildAgentState, cast } from '../data';
import type { CastMember, EngineTraits, ScenarioEvent } from '../engine-types';
import { DEFAULT_PARAMS, type Params } from '../params';
import { stream } from '../rng';

type Base = Omit<CastMember, 'profile'> & { profile: Omit<CastMember['profile'], 'traits'> & { traits: EngineTraits } };

const NAME_POOLS: Record<string, readonly string[]> = {
  ceo: ['Ava', 'Daniel', 'Priya', 'Noah', 'Elena', 'Marcus', 'Sofia', 'Ethan'],
  ops: ['Omar', 'Iris', 'Leo', 'Rae', 'Miguel', 'Nadia', 'Sasha', 'Theo'],
  gossip: ['Priya', 'Jules', 'Maya', 'Harper', 'Cora', 'Zoe', 'Rafi', 'Nia'],
  climber: ['Marcus', 'Milo', 'Dante', 'Mina', 'Wren', 'Parker', 'Leah', 'Kai'],
  loyalist: ['Tom', 'Olivia', 'Jin', 'Nora', 'Ari', 'Camila', 'Gavin', 'Elsa'],
  skeptic: ['Sam', 'Val', 'Drew', 'Alicia', 'Iwan', 'Mila', 'Reed', 'Tessa'],
  breadwinner: ['Rosa', 'Anika', 'Leon', 'Carmen', 'Hugo', 'Tessa', 'Nico', 'Lena'],
  flight: ['Lena', 'Maya', 'Ben', 'Sofia', 'Noah', 'Sara', 'Chris', 'Leah'],
};

const TRAIT_BANDS: Record<string, Partial<Record<typeof NUMERIC_TRAITS[number], [number, number]>>> = {
  ceo: { ambition: [80, 96], financial_need: [10, 35], ethics: [40, 75], sociability: [20, 60], distortion_rate: [5, 25], quit_threshold: [80, 95], impulsivity: [25, 55] },
  ops: { ambition: [45, 78], financial_need: [25, 60], ethics: [45, 80], sociability: [20, 65], distortion_rate: [10, 35], quit_threshold: [70, 88], impulsivity: [20, 45] },
  gossip: { ambition: [25, 65], financial_need: [20, 70], ethics: [25, 65], sociability: [75, 98], distortion_rate: [35, 80], quit_threshold: [65, 90], impulsivity: [45, 88] },
  climber: { ambition: [75, 98], financial_need: [20, 60], ethics: [20, 60], sociability: [35, 80], distortion_rate: [20, 60], quit_threshold: [68, 88], impulsivity: [40, 75] },
  loyalist: { ambition: [20, 55], financial_need: [20, 65], ethics: [60, 95], sociability: [20, 65], distortion_rate: [5, 30], quit_threshold: [75, 94], impulsivity: [10, 40] },
  skeptic: { ambition: [25, 65], financial_need: [10, 55], ethics: [70, 96], sociability: [25, 70], distortion_rate: [5, 35], quit_threshold: [65, 86], impulsivity: [25, 60] },
  breadwinner: { ambition: [20, 55], financial_need: [75, 98], ethics: [40, 80], sociability: [25, 70], distortion_rate: [5, 35], quit_threshold: [70, 95], impulsivity: [10, 35] },
  flight: { ambition: [35, 75], financial_need: [20, 85], ethics: [15, 60], sociability: [20, 65], distortion_rate: [10, 60], quit_threshold: [55, 78], impulsivity: [45, 88] },
};

const START_BANDS: Record<string, Partial<Record<'stress' | 'workload' | 'loyalty' | 'trust_mgmt' | 'burnout', [number, number]>>> = {
  ceo: { stress: [25, 42], workload: [35, 62], loyalty: [70, 88], trust_mgmt: [72, 92], burnout: [18, 32] },
  ops: { stress: [30, 52], workload: [38, 62], loyalty: [55, 78], trust_mgmt: [55, 82], burnout: [22, 42] },
  gossip: { stress: [25, 48], workload: [35, 55], loyalty: [45, 72], trust_mgmt: [42, 72], burnout: [18, 40] },
  climber: { stress: [30, 52], workload: [40, 65], loyalty: [40, 68], trust_mgmt: [46, 72], burnout: [20, 40] },
  loyalist: { stress: [22, 42], workload: [35, 58], loyalty: [70, 92], trust_mgmt: [62, 84], burnout: [10, 24] },
  skeptic: { stress: [25, 45], workload: [35, 55], loyalty: [40, 68], trust_mgmt: [22, 55], burnout: [18, 36] },
  breadwinner: { stress: [34, 56], workload: [44, 68], loyalty: [48, 72], trust_mgmt: [42, 66], burnout: [24, 42] },
  flight: { stress: [36, 58], workload: [38, 60], loyalty: [28, 58], trust_mgmt: [28, 62], burnout: [30, 55] },
};

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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function pickFromPool(rng: ReturnType<typeof stream>, pool: readonly string[]) {
  return pool[Math.floor(rng.next() * pool.length)] ?? pool[0];
}

function jitteredValue(rng: ReturnType<typeof stream>, low: number, high: number) {
  return clamp(Math.round(low + rng.next() * (high - low)), 0, 100);
}

/** The cast for one run: every fixed trait is its archetype value +/- traitJitter, drawn from the run seed. */
export function fixtureCast(seed: number, params: Params = DEFAULT_PARAMS, jitter = true): CastMember[] {
  return BASE_CAST.map((c) => {
    const rng = stream(seed, 0, c.profile.id, 'traits');
    const traits = { ...c.profile.traits };
    if (jitter) {
      const j = params.setup.traitJitter;
      const spread = Math.max(6, Math.round(j * 0.8));
      for (const k of NUMERIC_TRAITS) {
        const base = c.profile.traits[k];
        const low = clamp(base - spread, 0, 100);
        const high = clamp(base + spread, 0, 100);
        traits[k] = jitteredValue(rng, low, high);
      }
    }

    const start = structuredClone(c.start);
    for (const key of ['stress', 'workload', 'loyalty', 'trust_mgmt', 'burnout'] as const) {
      const base = c.start[key] ?? start[key];
      const low = clamp((typeof base === 'number' ? base : 50) - 12, 0, 100);
      const high = clamp((typeof base === 'number' ? base : 50) + 12, 0, 100);
      start[key] = jitteredValue(rng, low, high);
    }

    const namePool = NAME_POOLS[c.profile.id] ?? [c.profile.name];
    return {
      profile: { ...c.profile, name: pickFromPool(rng, namePool), traits },
      start,
    };
  });
}

/** The LLM and Data lane's cast (data.ts) as engine cast members. Not jittered. */
export function dataCast(): CastMember[] {
  return cast.map((profile) => {
    const { affinity, source_trust, ...start } = buildAgentState(profile);
    return { profile: structuredClone(profile), start: { ...start, affinity, source_trust } };
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
