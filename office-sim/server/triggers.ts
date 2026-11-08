// Concrete, explainable reasons an agent might be upset this hour. Rules only, no LLM.
// Personality amplifies an existing trigger (raises its severity); it never creates one.
import type { EngineAgent, EventType, World } from './engine-types';
import { CATALOG } from './events/catalog';
import { terminal } from './events/lifecycle';
import { chaseTriggers } from './accountability';

export interface Trigger {
  /** Stable key the LLM copies into "cause". */
  id: string;
  kind: 'event' | 'task' | 'state' | 'peer' | 'claim';
  text: string;
  /** The colleague behind a peer or claim trigger. */
  sourceId?: string;
  severity: 1 | 2 | 3;
}

/** Something one colleague did to another, remembered for a few hours. */
export interface PeerEntry { tick: number; from: string; to: string; kind: 'complained' | 'gossiped' | 'slacked' }
export type TriggerWorld = World & { peerLog?: PeerEntry[] };

const PEER_MEMORY = 3;

/** Hard-hitting announcements and how much they sting. Good news is a reaction, not a grievance. */
const EVENT_STING: Partial<Record<EventType, { text: string; severity: 1 | 2 | 3 }>> = {
  long_hours_policy: { text: 'the long-hours policy', severity: 3 },
  layoffs_rumour: { text: 'the layoff rumours', severity: 3 },
  pr_scandal: { text: 'the PR scandal', severity: 2 },
  merger: { text: 'the merger shake-up', severity: 2 },
  new_management: { text: 'the new management', severity: 2 },
  competitor_poaching: { text: 'the competitor poaching staff', severity: 1 },
};

/** Which archetypes feel which kind of trigger harder. */
function amplify(agent: EngineAgent, t: Trigger, eventType?: EventType): Trigger {
  const a = agent.profile.archetype;
  let boost = 0;
  if (a === 'Skeptic' && (eventType === 'new_management' || eventType === 'merger' || eventType === 'long_hours_policy')) boost++;
  if (a === 'Flight risk' && eventType === 'competitor_poaching') boost += 2;
  if (a === 'Breadwinner' && (eventType === 'layoffs_rumour' || t.id.includes('cost_review'))) boost++;
  if (a === 'Gossip hub' && t.kind === 'claim') boost++;
  if ((a === 'Loyalist' || a === 'Ops manager' || a === 'Climber') && t.kind === 'task') boost++;
  if (t.kind === 'peer' && agent.profile.traits.impulsivity >= 65) boost++;
  return boost ? { ...t, severity: Math.min(3, t.severity + boost) as 1 | 2 | 3 } : t;
}

export function computeTriggers(w: World, agent: EngineAgent, events: Array<{ type: EventType; claim: string }>): Trigger[] {
  const out: Trigger[] = [];
  const name = (id: string) => w.agents[id]?.profile.name ?? id;
  const position = w.business?.positions?.[agent.id];
  const department = position?.department;

  // Events that reached this agent this hour (they hold the claim).
  for (const e of events) {
    const sting = EVENT_STING[e.type];
    if (sting && agent.claims.some(h => h.claimId === e.claim)) {
      out.push(amplify(agent, { id: `ev-${e.type}`, kind: 'event', text: `${sting.text} hits ${department ?? 'the team'}`, severity: sting.severity }, e.type));
    }
  }
  // Open bad-news business cases in their department (or company-wide people cases).
  for (const c of w.eventState?.cases ?? []) {
    if (terminal(c) || c.valence !== 'negative' || w.tick - c.openedTick > 6) continue;
    const def = CATALOG.find(d => d.id === c.templateId);
    if (!def || (c.domain !== 'people' && def.department !== department)) continue;
    out.push(amplify(agent, { id: `case-${c.id}`, kind: 'event', text: `${c.headline.toLowerCase()} (${def.department})`, severity: c.severity === 'high' ? 3 : c.severity === 'medium' ? 2 : 1 }));
  }
  // Their own task: deadline close and behind.
  for (const task of w.business?.tasks ?? []) {
    if (task.owner !== agent.id || task.status !== 'active' || task.effort <= 0) continue;
    const left = task.deadline - w.tick;
    if (left <= 4 && task.remaining / task.effort > 0.4) {
      out.push(amplify(agent, { id: `task-${task.id}`, kind: 'task', text: `${task.title} is due soon and behind`, severity: left <= 1 ? 3 : 2 }));
    }
  }
  // Chased by their manager, or warned by the CEO: they know by when, and what is in their control.
  out.push(...chaseTriggers(w, agent));
  // How they feel.
  if (agent.state.stress >= 60) out.push({ id: 'state-stress', kind: 'state', text: 'running on stress', severity: agent.state.stress >= 80 ? 3 : 2 });
  if (agent.state.workload >= 80) out.push({ id: 'state-workload', kind: 'state', text: 'workload far above comfortable', severity: 2 });
  // What colleagues did to them recently.
  for (const p of (w as TriggerWorld).peerLog ?? []) {
    if (p.to !== agent.id || w.tick - p.tick > PEER_MEMORY || !w.agents[p.from]) continue;
    const text = p.kind === 'complained' ? `${name(p.from)} complained at you` : p.kind === 'gossiped' ? `${name(p.from)} spread gossip to you`
      : `${name(p.from)} slacked off while you overworked`;
    const id = `peer-${p.from}-${p.kind}`;
    if (!out.some(t => t.id === id)) out.push(amplify(agent, { id, kind: 'peer', text, sourceId: p.from, severity: 2 }));
  }
  // Rumours they hold (needed before they can gossip).
  for (const h of agent.claims.slice(-3)) {
    const claim = w.claims[h.claimId];
    if (!claim) continue;
    const text = claim.text.length > 60 ? `${claim.text.slice(0, 57)}…` : claim.text;
    out.push(amplify(agent, { id: `claim-${h.claimId}`, kind: 'claim', text: `rumour: ${text}`, sourceId: h.from, severity: claim.scandal ? 2 : 1 }));
  }
  return out;
}

/** Remember who did what to whom this hour (complaints, gossip, and slacking while a teammate overworked). */
export function recordPeers(w: World, decisions: Record<string, { action: string; target: string | null } | undefined>): void {
  const tw = w as TriggerWorld;
  const log = (tw.peerLog ?? []).filter(p => w.tick - p.tick < PEER_MEMORY);
  const dept = (id: string) => w.business?.positions?.[id]?.department;
  for (const [id, d] of Object.entries(decisions)) {
    if (!d) continue;
    if ((d.action === 'complain' || d.action === 'gossip') && d.target) log.push({ tick: w.tick, from: id, to: d.target, kind: d.action === 'complain' ? 'complained' : 'gossiped' });
    if (d.action === 'slack_off') for (const [other, o] of Object.entries(decisions)) {
      if (other !== id && o?.action === 'overwork' && dept(other) && dept(other) === dept(id)) log.push({ tick: w.tick, from: id, to: other, kind: 'slacked' });
    }
  }
  tw.peerLog = log;
}
