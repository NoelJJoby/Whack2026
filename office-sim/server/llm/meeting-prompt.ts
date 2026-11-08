// Lines for a meeting with the boss. The rules have already decided the outcome; the model only writes
// three short lines in the two people's voices. Anything invalid falls back to the templates below.
import type { MeetingOutcome } from '../../shared/accountability';

export interface MeetingBrief {
  outcome: MeetingOutcome;
  boss: { name: string; voice: string };
  agent: { name: string; voice: string };
  /** Short task title. */
  task: string;
  /** Why they were called in, as a sentence fragment ("spent most of the last two days on breaks"). */
  reason: string;
  /** Word limits from voiceParams.words. */
  limits: { publicMax: number; innerMax: number };
}

export interface MeetingLines { boss: string; reply: string; inner: string }

const OUTCOME_TEXT: Record<MeetingOutcome, string> = {
  warning: 'a direct, formal warning: one more miss of their own making and they are fired',
  fired: 'they are fired, effective today',
};

export function buildMeetingPrompt(b: MeetingBrief): string {
  return [
    `Write three lines for a short meeting in the boss's office. ${b.boss.name} called in ${b.agent.name} about "${b.task}".`,
    `What happened: ${b.agent.name} ${b.reason}.`,
    `The decision is already made and must not change: ${OUTCOME_TEXT[b.outcome]}.`,
    `How ${b.boss.name} talks: ${b.boss.voice || 'plainly.'}`,
    `How ${b.agent.name} talks: ${b.agent.voice || 'plainly.'}`,
    'Rules:',
    `- boss_line: ${b.boss.name} to ${b.agent.name}, out loud, at most ${b.limits.publicMax} words. It must make the decision clear.`,
    `- reply_line: ${b.agent.name}'s answer out loud, at most ${b.limits.publicMax} words.`,
    `- inner_line: what ${b.agent.name} privately thinks, at most ${b.limits.innerMax} words. It may contradict the reply.`,
    '- Plain speech. No stage directions, no quotation marks, no names of game mechanics, no numbers of hours or ticks.',
    'Reply with JSON only: {"boss_line": "...", "reply_line": "...", "inner_line": "..."}',
  ].join('\n');
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const clean = (s: unknown) => typeof s === 'string' ? s.trim().replace(/^["“']+|["”']+$/g, '').trim() : '';

/** The model's lines if every one is present and within its limit; otherwise null (use the templates). */
export function validMeetingLines(raw: unknown, b: MeetingBrief): MeetingLines | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const lines = { boss: clean(r.boss_line), reply: clean(r.reply_line), inner: clean(r.inner_line) };
  if (!lines.boss || !lines.reply || !lines.inner) return null;
  if (words(lines.boss) > b.limits.publicMax || words(lines.reply) > b.limits.publicMax || words(lines.inner) > b.limits.innerMax) return null;
  return lines;
}

/** Fallback lines, so the cutscene always plays. */
export function templateMeetingLines(b: MeetingBrief): MeetingLines {
  return b.outcome === 'fired'
    ? { boss: `${b.agent.name}, we warned you. We're letting you go, effective today.`, reply: "…Right. I'll get my things.", inner: `I knew "${b.task}" would be the end of me.` }
    : { boss: `${b.agent.name}, "${b.task}" slipped and that's on you. Consider this your warning.`, reply: "Understood. It won't happen again.", inner: 'One more slip and I am out. Head down.' };
}
