// Short conversations through the normal per-agent turns (no extra LLM calls):
// a targeted action opens one, the target's next turn may reply, the opener may follow up once.
import type { Action, World } from './engine-types';
import type { Emotion, SettledEmotion } from './emotion';

export type ConversationKind = 'confrontation' | 'venting' | 'gossip' | 'task';
export interface ConversationLine { agent: string; text: string; emotion: Emotion; tick: number }
export interface Conversation { id: string; kind: ConversationKind; a: string; b: string; cause: string | null; lines: ConversationLine[] }
/** What an agent sees in their next turn: someone just said something to them. */
export interface Incoming { id: string; from: string; fromName: string; line: string; cause: string | null; kind: ConversationKind }
/** Recorded on the TickRecord so the UI can stage it. */
export interface ConversationRole { id: string; kind: ConversationKind; role: 'open' | 'reply'; with: string }

type ConvWorld = World & { conversations?: Conversation[] };
const MAX_LINES = 3;
/** A line goes unanswered after this many hours. */
const EXPIRY = 2;

export function incomingFor(w: World, id: string): Incoming | null {
  for (const c of (w as ConvWorld).conversations ?? []) {
    const last = c.lines.at(-1);
    if (!last || last.agent === id || (c.a !== id && c.b !== id) || c.lines.length >= MAX_LINES || w.tick - last.tick > EXPIRY) continue;
    return { id: c.id, from: last.agent, fromName: w.agents[last.agent]?.profile.name ?? last.agent, line: last.text, cause: c.cause, kind: c.kind };
  }
  return null;
}

const OPENERS: Partial<Record<Action, true>> = { complain: true, gossip: true, verify: true, support_colleague: true };

/**
 * After decisions: replies attach to the conversation they answer; targeted actions open new ones.
 * Complaining at the person who caused it is a confrontation; complaining to someone who shares it is venting.
 */
export function advanceConversations(
  w: World,
  order: string[],
  decisions: Record<string, { action: Action; target: string | null; public_line: string }>,
  emotions: Record<string, SettledEmotion>,
  incoming: Record<string, Incoming | null>,
  replyTo: Record<string, string | undefined>,
  llmMode: boolean,
): Record<string, ConversationRole> {
  const cw = w as ConvWorld;
  const all = (cw.conversations ?? []).filter(c => c.lines.length < MAX_LINES && w.tick - (c.lines.at(-1)?.tick ?? 0) <= EXPIRY);
  const roles: Record<string, ConversationRole> = {};
  for (const id of order) {
    const d = decisions[id], text = d?.public_line?.trim();
    if (!d || !text) continue;
    const inc = incoming[id];
    const conv = inc && all.find(c => c.id === inc.id);
    // Reply: the LLM names the conversation; without an LLM, any line to the speaker counts.
    if (conv && (replyTo[id] === conv.id || (!llmMode && !replyTo[id]))) {
      conv.lines.push({ agent: id, text, emotion: emotions[id].emotion, tick: w.tick });
      roles[id] = { id: conv.id, kind: conv.kind, role: 'reply', with: inc.from };
      continue;
    }
    if (!OPENERS[d.action] || !d.target || !w.agents[d.target]) continue;
    const cause = emotions[id].cause;
    const kind: ConversationKind = d.action === 'complain' ? (cause?.sourceId === d.target ? 'confrontation' : 'venting')
      : d.action === 'support_colleague' ? 'task' : 'gossip';
    const c: Conversation = { id: `cv-${w.tick}-${id}`, kind, a: id, b: d.target, cause: cause?.text ?? null, lines: [{ agent: id, text, emotion: emotions[id].emotion, tick: w.tick }] };
    all.push(c);
    roles[id] = { id: c.id, kind, role: 'open', with: d.target };
  }
  cw.conversations = all;
  return roles;
}
