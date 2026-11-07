// Design-preview data, shaped like the real API. Only used when VITE_USE_MOCKS=true.
import type { CastResponse, SimResponse, TickFrame } from '../shared/api';
import type { Action, AgentProfile, AgentRuntimeState, EventType, SimulationState, TickRecord } from '../shared/types';

interface MockPerson {
  id: string;
  name: string;
  archetype: string;
  stress: number;
  workload: number;
  burnout: number;
  trust: number;
  action: Action;
  says: string;
  thinks: string;
}

const people: MockPerson[] = [
  { id: 'marcus', name: 'Marcus', archetype: 'CEO', stress: 34, workload: 48, burnout: 20, trust: 82, action: 'work', says: 'An exciting new chapter for all of us.', thinks: 'The board needs to see results. Whatever it takes.' },
  { id: 'priya', name: 'Priya', archetype: 'Ops manager', stress: 76, workload: 94, burnout: 62, trust: 39, action: 'overwork', says: 'Let’s just get through this week.', thinks: 'I’m enforcing a policy I wouldn’t survive myself.' },
  { id: 'sam', name: 'Sam', archetype: 'Breadwinner', stress: 81, workload: 91, burnout: 68, trust: 32, action: 'work', says: 'I can pick up the extra shift.', thinks: 'Rent is due Friday. Quitting isn’t an option.' },
  { id: 'dan', name: 'Dan', archetype: 'Gossip hub', stress: 58, workload: 62, burnout: 37, trust: 46, action: 'gossip', says: 'Apparently, Sales is next…', thinks: 'Jess needs to hear this. Well, my version of it.' },
  { id: 'jess', name: 'Jess', archetype: 'Climber', stress: 61, workload: 70, burnout: 42, trust: 51, action: 'work', says: 'I’m sure leadership has a plan.', thinks: 'If Dan leaves, that senior role opens up.' },
  { id: 'tom', name: 'Tom', archetype: 'Loyalist', stress: 72, workload: 88, burnout: 58, trust: 55, action: 'overwork', says: 'They’ve always looked after us.', thinks: 'Twenty hours? This isn’t the company I joined.' },
  { id: 'ravi', name: 'Ravi', archetype: 'Skeptic', stress: 65, workload: 75, burnout: 49, trust: 24, action: 'verify', says: 'Where did that number come from?', thinks: 'Nobody has checked a single word of this.' },
  { id: 'lena', name: 'Lena', archetype: 'Flight risk', stress: 92, workload: 83, burnout: 87, trust: 12, action: 'slack_off', says: 'Just taking a quick break.', thinks: 'I’m done. There has to be more to life than this.' },
];

const TICKS = 7;
const traits = { ambition: 50, financial_need: 50, ethics: 50, sociability: 50, distortion_rate: 0, quit_threshold: 80, impulsivity: 50, recruiter_contact: false };
const profiles: AgentProfile[] = people.map((p) => ({ id: p.id, name: p.name, archetype: p.archetype, role: 'Staff', functionGroup: 'Office', traits }));

const events: Record<number, { type: EventType; is_true: boolean; text: string }> = {
  2: { type: 'merger', is_true: true, text: 'The merger is announced. Everything changes.' },
  5: { type: 'long_hours_policy', is_true: true, text: 'Management introduces a 20-hour workday.' },
};

const summaries: Record<number, Array<Pick<TickRecord, 'agent' | 'action' | 'target' | 'summary'>>> = {
  4: [{ agent: 'tom', action: 'overwork', target: null, summary: 'Tom puts the company first.' }],
  6: [{ agent: 'ravi', action: 'verify', target: 'dan', summary: 'Ravi asks for a source. Nobody has one.' }],
};

// Every value ramps linearly from a calm start to the design's final numbers.
const ramp = (from: number, to: number, t: number) => Math.round(from + ((to - from) * t) / TICKS);

function stateAt(t: number): SimulationState {
  const agents: Record<string, AgentRuntimeState> = {};
  for (const p of people) {
    agents[p.id] = {
      stress: ramp(30, p.stress, t),
      workload: ramp(45, p.workload, t),
      loyalty: 50,
      trust_mgmt: ramp(70, p.trust, t),
      burnout: ramp(15, p.burnout, t),
      affinity: {},
      source_trust: {},
      status: 'active',
      quit_tick: null,
    };
  }
  return {
    tick: t,
    seed: 42,
    started: true,
    running: false,
    event: t >= 5 ? 'long_hours_policy' : t >= 2 ? 'merger' : null,
    queue: [],
    feed: [],
    claims: [],
    agents,
    mode: 'rules',
    metrics: { crack_order: [], first_quit_tick: null, true_reach: t, false_reach: Math.max(0, t - 3) },
  };
}

function recordsAt(t: number): TickRecord[] {
  const state = stateAt(t);
  if (t < TICKS) {
    return (summaries[t] ?? []).map((r) => ({ tick: t, event: events[t]?.type ?? null, ...r }));
  }
  return people.map((p) => ({
    tick: t,
    event: null,
    agent: p.id,
    action: p.action,
    target: p.id === 'dan' ? 'jess' : null,
    summary: p.id === 'dan' ? 'Dan tells Jess that Sales could be next.' : p.id === 'priya' ? 'Priya stays late. Again.' : `${p.name} keeps going.`,
    public_line: p.says,
    inner_monologue: p.thinks,
    quit: false,
    state: state.agents[p.id],
  }));
}

export const mockCast: CastResponse = { agents: profiles };

export const mockHistory: TickFrame[] = Array.from({ length: TICKS }, (_, i) => {
  const t = i + 1;
  return { tick: t, records: recordsAt(t), events: events[t] ? [events[t]] : [], state: stateAt(t) };
});

export const mockResponse: SimResponse = { mode: 'rules', mode_reason: 'configured', max_ticks: 16, state: stateAt(TICKS) };
