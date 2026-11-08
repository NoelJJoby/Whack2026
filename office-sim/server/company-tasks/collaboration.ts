import { z } from 'zod';
import type { Task } from '../../shared/business';
import type { CompanyMessage, CompanySource, CompanyTask, WorkFinding } from '../../shared/companyTasks';
import type { Mode, TurnProvider, World } from '../engine-types';
import { managementOwners } from '../events/lifecycle';
import { isPresent } from '../presence';
import { companyLimits } from './config';
import { activeCompanyTask, addActivity } from './state';

type MessageKind = CompanyMessage['kind'];
type Tone = 'direct' | 'warm' | 'concise';
const messageIntent = z.object({
  tone: z.enum(['direct', 'warm', 'concise']),
  action: z.enum(['send', 'wait']),
}).strict();

interface Exchange {
  kind: MessageKind;
  from: string;
  to: string;
  dependent: Task;
  source: Task;
  threadId: string;
  replyTo?: string;
  finding?: WorkFinding;
  mayWait?: boolean;
}

export function knownInputs(mission: CompanyTask, taskId: string, actor: string) {
  const work = mission.work[taskId];
  return work?.requiredInputs.flatMap(id => mission.findings.filter(f => f.taskId === id && f.knownBy.includes(actor)).slice(-1)) ?? [];
}

export function canUseCompanyWork(w: World, taskId: string, actor: string) {
  const mission = activeCompanyTask(w);
  const meta = mission?.work[taskId];
  return !mission || !meta || meta.requiredInputs.length === knownInputs(mission, taskId, actor).length;
}

export function companyKnowledge(w: World, actor: string) {
  const mission = activeCompanyTask(w);
  if (!mission?.brief) return;
  const tasks = w.business.tasks.filter(t => mission.work[t.id] && (t.status === 'active' && t.owner === actor || t.status === 'review' && t.reviewer === actor));
  if (!tasks.length) return;
  return {
    objective: mission.objective,
    work: tasks.map(t => ({
      title: t.title, acceptance: mission.work[t.id].acceptance,
      receivedFindings: (t.reviewer === actor
        ? mission.findings.filter(f => Object.values(mission.work[t.id].consumedFindings).includes(f.id) && f.knownBy.includes(actor))
        : knownInputs(mission, t.id, actor)).map(f => f.summary),
    })),
  };
}

function qualified(w: World, task: Task) {
  return w.ids.filter(id => isPresent(w, id) && w.business.positions[id].role === 'employee' && w.business.positions[id].capabilities.includes(task.department));
}

function candidates(w: World, mission: CompanyTask, round: number): Exchange[] {
  const ops = managementOwners(w).ops;
  const messages = mission.activity.filter(a => a.message && (a.tick < w.tick || a.round < round));
  const tasks = w.business.tasks.filter(t => mission.work[t.id]);
  const exchanges: Exchange[] = [];
  for (const dependent of tasks.filter(t => ['pending', 'paused', 'blocked', 'active'].includes(t.status))) {
    for (const sourceId of mission.work[dependent.id].requiredInputs) {
      const source = tasks.find(t => t.id === sourceId)!;
      const finding = mission.findings.find(f => f.taskId === sourceId);
      // Ask about actionable research first. A later stage that cannot start
      // until its own prerequisite arrives does not need a parallel status thread.
      if (!finding && source.dependencies.some(id => tasks.some(t => t.id === id && t.status !== 'done'))) continue;
      const owner = dependent.owner && isPresent(w, dependent.owner) ? dependent.owner : qualified(w, dependent)[0];
      if (!owner || finding?.knownBy.includes(owner)) continue;

      const known = finding?.knownBy.filter(id => isPresent(w, id));
      // Route unfinished work to the accountable owner when possible. A colleague
      // covering a vacant seat can report status, but cannot invent a result.
      if (finding && !known?.length && round === 1 && dependent.status === 'active') {
        const custodian = qualified(w, source)[0] ?? (ops && isPresent(w, ops) ? ops : null);
        if (custodian) exchanges.push({ kind: 'retrieve', from: custodian, to: custodian, dependent, source, finding, threadId: `${finding.id}-archive` });
        continue;
      }
      const possible = finding ? known! : qualified(w, source);
      const producer = possible.includes(source.owner ?? '') ? source.owner! : [...possible].sort((a, b) =>
        (w.agents[owner].state.affinity[b] ?? 50) - (w.agents[owner].state.affinity[a] ?? 50) || a.localeCompare(b))[0];
      if (!producer || owner === producer) continue;
      const threadId = `${dependent.id}-from-${source.id}-${owner}-${producer}`;
      const thread = messages.filter(a => a.message!.threadId === threadId);
      const request = [...thread].reverse().find(a => a.message!.kind === 'request');
      const answered = thread.some(a => a.message!.replyTo === request?.id && a.message!.kind !== 'escalation');
      const base = { dependent, source, threadId };
      if (round === 1 && (!request || answered && (finding || w.tick - request.tick >= companyLimits.reminderTicks))) {
        const mayWait = Boolean(request && !finding && !mission.activity.some(a => a.kind === 'deferred_message' && a.threadId === threadId));
        exchanges.push({ ...base, kind: 'request', from: owner, to: producer, mayWait });
      }
      if (round === 2 && request && !answered) {
        exchanges.push({ ...base, kind: finding ? 'finding' : 'incomplete', from: producer, to: owner, replyTo: request.id, finding });
      }
      const initial = messages.find(a => a.taskId === dependent.id && a.message!.sourceTaskId === sourceId && a.message!.kind === 'request');
      if (round === 3 && ops && isPresent(w, ops) && initial && !finding && w.tick - initial.tick >= companyLimits.escalationTicks
        && !messages.some(a => a.taskId === dependent.id && a.message!.sourceTaskId === sourceId && a.message!.kind === 'escalation')) {
        exchanges.push({ ...base, kind: 'escalation', from: owner, to: ops, replyTo: request?.id });
      }
    }
  }
  const priority: Record<MessageKind, number> = { retrieve: 0, finding: 0, request: 1, incomplete: 2, escalation: 0 };
  return exchanges.sort((a, b) => (a.kind === 'request' && a.source.status === 'done' ? 0 : priority[a.kind])
    - (b.kind === 'request' && b.source.status === 'done' ? 0 : priority[b.kind]));
}

function line(w: World, exchange: Exchange, tone: Tone) {
  const name = w.agents[exchange.to].profile.name;
  const title = exchange.source.title;
  const address = tone === 'concise' ? '' : `${name}, `;
  const start = (text: string) => address ? `${address}${text}` : text[0].toUpperCase() + text.slice(1);
  switch (exchange.kind) {
    case 'request': return start(`could you share the findings from “${title}”? ${tone === 'warm' ? 'That would help me get started. Thanks.' : 'I need them for my next step.'}`);
    case 'incomplete': return `“${title}” is unfinished. ${tone === 'warm' ? 'Thanks for checking. We’ll share the result when it’s ready.' : 'We haven’t recorded a result to share yet.'}`;
    case 'finding': return tone === 'warm' ? `I have the result for you. ${exchange.finding!.summary}`
      : tone === 'direct' ? `${name}, here's what the work showed. ${exchange.finding!.summary}` : exchange.finding!.summary;
    case 'retrieve': return `I retrieved the verified result for “${title}” from our work records.`;
    case 'escalation': return start(`the handoff from “${title}” is holding up the next step. Can we review its priority?`);
  }
}

export async function collaborate(w: World, provider: TurnProvider | null, mode: Mode, assertCurrent: () => void) {
  const mission = activeCompanyTask(w);
  if (!mission?.brief) return;
  const attention: Record<string, number> = {};
  const authored = new Map<string, number>();
  const pairs = new Map<string, string>();
  let sent = 0;
  let inferenceCalls = 0;
  for (const round of [1, 2, 3]) {
    const selected: Exchange[] = [];
    for (const exchange of candidates(w, mission, round)) {
      if (sent >= companyLimits.messagesPerTick) break;
      const { from, to, threadId } = exchange;
      const participants = [...new Set([from, to])];
      const pair = participants.sort().join('|');
      if (pairs.has(pair) && (pairs.get(pair) !== threadId || exchange.kind !== 'finding' && exchange.kind !== 'incomplete')) continue;
      if ((authored.get(from) ?? 0) >= companyLimits.authoredPerTick) continue;
      if (participants.some(id => (attention[id] ?? 0) + companyLimits.messageCost > w.business.positions[id].capacity)) continue;
      pairs.set(pair, threadId);
      authored.set(from, (authored.get(from) ?? 0) + 1);
      for (const id of participants) attention[id] = Number(((attention[id] ?? 0) + companyLimits.messageCost).toFixed(2));
      sent++;
      selected.push(exchange);
    }
    const turns = await Promise.all(selected.map(async exchange => {
      const agent = w.agents[exchange.from];
      const defaultTone: Tone = agent.state.stress > 65 ? 'concise' : agent.profile.traits.sociability >= 60 ? 'warm' : 'direct';
      let tone = defaultTone;
      let wait = false;
      let source: CompanySource = mode.startsWith('llm') && exchange.kind !== 'retrieve' ? 'fallback' : 'rules';
      if (provider && mode.startsWith('llm') && exchange.kind !== 'retrieve' && inferenceCalls < companyLimits.messagesPerTick) {
        inferenceCalls++;
        try {
          const response = await provider(agent.profile, {
            tick: w.tick, mode, state: structuredClone(agent.state), available: [], colleagues: [], claims: [], events: [],
            companyTurn: { kind: 'message', intent: exchange.kind, colleague: w.agents[exchange.to].profile.name,
              task: exchange.source.title, knownFinding: exchange.finding?.summary, mayWait: exchange.mayWait ?? false },
          });
          const intent = messageIntent.parse(response);
          if (intent.action === 'wait' && !exchange.mayWait) throw new Error('This exchange cannot be deferred');
          tone = intent.tone;
          wait = intent.action === 'wait';
          source = 'model';
        } catch {
          // The engine supplies the factual content, including incomplete status.
        }
      }
      return { exchange, tone, source, wait };
    }));
    assertCurrent();
    for (const { exchange, tone, source, wait } of turns) {
      const { from, to, threadId, kind, finding, replyTo } = exchange;
      if (wait) {
        for (const id of new Set([from, to])) attention[id] = Number((attention[id] - companyLimits.messageCost).toFixed(2));
        pairs.delete([from, to].sort().join('|'));
        authored.set(from, authored.get(from)! - 1);
        sent--;
        addActivity(mission, w.tick, {
          round, actor: from, recipients: [], taskId: exchange.dependent.id, kind: 'deferred_message', location: 'desk',
          dialogue: 'I’ll give the prerequisite a little more time before asking again.', threadId, source,
        });
        continue;
      }
      if (finding && !finding.knownBy.includes(to)) finding.knownBy.push(to);
      if (kind === 'escalation') w.eventState.lastOpsInput = undefined;
      addActivity(mission, w.tick, {
        round, actor: from, recipients: from === to ? [] : [to], taskId: exchange.dependent.id, kind: 'message', location: 'desk',
        dialogue: line(w, exchange, tone), source, attention: companyLimits.messageCost,
        message: { threadId, kind, sourceTaskId: exchange.source.id, replyTo, findingId: finding?.id, sentTick: w.tick, deliveredTick: w.tick, round },
      });
    }
  }
  return sent ? attention : undefined;
}
