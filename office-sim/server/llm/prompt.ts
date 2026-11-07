import type { Action, EngineProfile, TurnContext } from '../engine-types';
import { voiceParams } from '../params';
import { stateParagraph } from './bands';
import { clockPhrase, heardWhen } from './clock';
import { temporaryPersonaFor } from './personas';
import {
  ambitionSentence, ethicsSentence, financialNeedSentence, impulsivitySentence,
  sociabilitySentence, sourceTrustSentence,
} from './traits';

const actionMeanings: Record<Action, string> = {
  work: 'Work normally',
  overwork: 'Stay late; take on more',
  slack_off: 'Disengage for the day',
  complain: 'Vent to a colleague',
  gossip: 'Pass a claim to a colleague',
  verify: 'Check a claim with a colleague',
  interview: 'Outside job interview',
  leak: 'Take a scandal claim to the press',
};

// Agents never see ids (they are archetype labels), claim ids (they carry
// tick numbers) or ticks. Colleagues appear by name and claims by short keys;
// restoreIds maps the reply back.

/** Short claim keys in ctx.claims order: c1, c2, ... */
export function claimKeys(ctx: Pick<TurnContext, 'claims'>): Map<string, string> {
  return new Map(ctx.claims.map((c, i) => [c.id, `c${i + 1}`]));
}

function sourceName(from: string, ctx: TurnContext): string {
  if (from === 'mgmt') return 'management';
  return ctx.colleagues.find((c) => c.id === from)?.name ?? 'the grapevine';
}

function roleLine(agent: EngineProfile): string {
  if (agent.role === 'Manager') return agent.functionGroup === 'Exec' ? 'You run the company.' : `You manage ${agent.functionGroup}.`;
  return `You work in ${agent.functionGroup}.`;
}

const quoteList = (items: readonly string[]) => items.map((s) => `"${s}"`).join(', ');

export function buildTurnPrompt(
  agent: EngineProfile, ctx: TurnContext, persona = agent.persona ?? temporaryPersonaFor(agent.id),
): string {
  const v = voiceParams;
  const traits = agent.traits;
  const keys = claimKeys(ctx);
  const speech = ctx.speech;
  const now = clockPhrase(ctx.tick, v.clock);
  const claims = ctx.claims.map(claim => {
    // Management uses management trust; unknown sources use the neutral band.
    const trust = claim.from === 'mgmt' ? ctx.state.trust_mgmt
      : ctx.state.source_trust[claim.from]
        ?? ctx.colleagues.find(colleague => colleague.id === claim.from)?.source_trust ?? 50;
    return `- ${JSON.stringify(claim.text)} (key: ${keys.get(claim.id)}), from ${sourceName(claim.from, ctx)}, ${heardWhen(ctx.tick, claim.tick_heard, v.clock)}. ${sourceTrustSentence(trust)}.${claim.scandal ? ' This is a scandal claim.' : ''}`;
  });
  const example = {
    proposals: ctx.available.slice(0, 1).map(action => ({ action, weight: 1 })),
    public_line: '<what you say out loud>',
    inner_monologue: '<what you honestly think>',
    beliefs: Object.fromEntries(ctx.claims.map(claim => [keys.get(claim.id), 50])),
  };
  const limit = speech?.minimal ? `This time: one to ${v.words.minimalMax === 4 ? 'four' : v.words.minimalMax} words.` : '';

  return [
    "You're not an assistant, and you're not here to give good advice. You're a person at work, reacting in the moment the way you really would.",
    `Who you are: You're ${agent.name}. ${roleLine(agent)} ${persona}\n${[
      ambitionSentence(traits.ambition), financialNeedSentence(traits.financial_need),
      ethicsSentence(traits.ethics), sociabilitySentence(traits.sociability),
      impulsivitySentence(traits.impulsivity),
    ].join(' ')}`,
    `How you feel right now: ${stateParagraph(ctx.state, speech?.feelings)}\nThese describe how you feel. Don't reuse their wording.`,
    `What you've heard:\n${claims.length ? claims.join('\n') : "You haven't heard anything new."}`,
    ctx.events.length
      ? `Just announced (it's ${now}):\n${ctx.events.map(event => `- ${JSON.stringify(event.text)}`).join('\n')}`
      : `Nothing new has been announced. It's ${now}.`,
    `Colleagues still here: ${ctx.colleagues.map(c => (c.group ? `${c.name} (${c.group})` : c.name)).join(', ') || 'None.'}`,
    `What you can do:\n${ctx.available.map(action => `- ${action}: ${actionMeanings[action]}`).join('\n')}\nComplain, gossip and verify need a colleague's name as "target". When proposing gossip, verify or leak, you may give a claim key from above (such as c1) as "claim".`,
    speech ? `How you talk: ${speech.voice}\nThis time: ${speech.manner}` : '',
    speech?.examples.length
      ? `Things you've said at the coffee machine recently, to show how you sound (don't repeat them):\n${speech.examples.map(l => `- ${JSON.stringify(l)}`).join('\n')}`
      : '',
    speech?.recent.length
      ? `Lines colleagues have already said. Don't reuse their wording or structure:\n${speech.recent.map(r => `- ${r.name}: ${JSON.stringify(r.line)}`).join('\n')}`
      : '',
    [
      'What you say out loud ("public_line"):',
      "- Don't repeat, quote or name the announcement. Don't open with a question about it.",
      '- React out loud the way you really would: through what it means for your day, your work, your life or the people around you. Your honest reaction goes in your thoughts.',
      '- Sound like yourself, not like your colleagues.',
      `- Never use these: ${quoteList([...v.bannedSentences, ...v.bannedPhrases])}.`,
      '- Call colleagues by their name only.',
      `- About ${v.words.publicMax} words at most.${limit ? ` ${limit}` : ''}`,
      `Your thoughts ("inner_monologue") are honest and direct, in the same voice, at most ${v.words.innerMax} words.`,
    ].join('\n'),
    speech?.nudge
      ? `You were going to say: ${JSON.stringify(speech.nudge.line)}. That's too close to what ${speech.nudge.against ?? 'a colleague'} said, or breaks the rules above. Say it completely differently, in your own style.`
      : '',
    `Respond with JSON only, in this shape: ${JSON.stringify(example)}\nGive 1 to 3 proposals, one per action, using only the available actions above. Weights are relative, non-negative and need not sum to one. Target and claim are optional or null; use only names and keys shown above. Public and inner lines express mood, without claiming an action has already happened, because the engine may select a different action. Write complete sentences that fit the limits; never cut off mid-thought. For each claim you've heard, say how likely you think it is to be true, from 0 to 100, in "beliefs", keyed by claim key. Give one integer for every claim key.`,
  ].filter(Boolean).join('\n\n');
}

/**
 * Map a parsed reply back from prompt names and keys to engine ids: proposal
 * targets (by colleague name, case-insensitive), proposal claims and belief
 * keys. Unknown values pass through for the engine to validate.
 */
export function restoreIds(raw: unknown, ctx: TurnContext): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const byName = new Map(ctx.colleagues.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const byKey = new Map([...claimKeys(ctx)].map(([id, key]) => [key, id]));
  const target = (t: unknown) => (typeof t === 'string' ? byName.get(t.trim().toLowerCase()) ?? t : t);
  const claim = (c: unknown) => (typeof c === 'string' ? byKey.get(c.trim().toLowerCase()) ?? c : c);
  const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  if (Array.isArray(out.proposals)) {
    out.proposals = out.proposals.map((p) => (p && typeof p === 'object'
      ? { ...p, ...('target' in p ? { target: target((p as { target: unknown }).target) } : {}), ...('claim' in p ? { claim: claim((p as { claim: unknown }).claim) } : {}) }
      : p));
  }
  if ('target' in out) out.target = target(out.target);
  if ('claim_id' in out) out.claim_id = claim(out.claim_id);
  if (out.beliefs && typeof out.beliefs === 'object' && !Array.isArray(out.beliefs)) {
    out.beliefs = Object.fromEntries(Object.entries(out.beliefs as Record<string, unknown>).map(([k, b]) => [byKey.get(k.trim().toLowerCase()) ?? k, b]));
  }
  return out;
}
