import type { Action, EngineProfile, TurnContext } from '../engine-types';
import { stateParagraph } from './bands';
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

export function buildTurnPrompt(
  agent: EngineProfile, ctx: TurnContext, persona = temporaryPersonaFor(agent.id),
): string {
  const traits = agent.traits;
  const claims = ctx.claims.map(claim => {
    // Management uses management trust; unknown sources use the neutral band.
    const trust = claim.from === 'mgmt' ? ctx.state.trust_mgmt
      : ctx.state.source_trust[claim.from]
        ?? ctx.colleagues.find(colleague => colleague.id === claim.from)?.source_trust ?? 50;
    return `- ${JSON.stringify(claim.text)} (id: ${claim.id}), from ${claim.from}, heard ${Math.max(0, ctx.tick - claim.tick_heard)} ticks ago. ${sourceTrustSentence(trust)}.${claim.scandal ? ' This is a scandal claim.' : ''}`;
  });
  const example = {
    proposals: ctx.available.slice(0, 1).map(action => ({ action, weight: 1 })),
    public_line: "I'm feeling stretched today.",
    inner_monologue: 'I need some breathing room.',
    beliefs: Object.fromEntries(ctx.claims.map(claim => [claim.id, 50])),
  };

  return [
    'You are not an assistant and you are not giving good advice. You are a tired person at work making a choice in the moment. People under pressure act on impulse, hold grudges and avoid confrontation.',
    `Who you are: ${persona}\n${[
      ambitionSentence(traits.ambition), financialNeedSentence(traits.financial_need),
      ethicsSentence(traits.ethics), sociabilitySentence(traits.sociability),
      impulsivitySentence(traits.impulsivity),
    ].join(' ')}`,
    `How you feel right now: ${stateParagraph(ctx.state)}`,
    `What you've heard:\n${claims.length ? claims.join('\n') : "You haven't heard anything new."}`,
    `This tick's announcements:\n${ctx.events.length
      ? ctx.events.map(event => `- ${JSON.stringify(event.text)}`).join('\n') : 'No new announcements.'}`,
    `Colleagues still here: ${ctx.colleagues.map(colleague => colleague.id).join(', ') || 'None.'}`,
    `What you can do:\n${ctx.available.map(action => `- ${action}: ${actionMeanings[action]}`).join('\n')}\nComplain, gossip and verify need a colleague id as target. When proposing gossip, verify or leak, you may include a heard claim id in "claim".`,
    `Respond with JSON only, in this shape: ${JSON.stringify(example)}\nGive 1 to 3 proposals, one per action, using only the available actions above. Weights are relative, non-negative and need not sum to one. Target and claim are optional or null; use only ids shown above. Public and inner lines express mood, without claiming an action has already happened, because the engine may select a different action. Keep "public_line" and "inner_monologue" to 30 words or fewer each; write complete sentences that fit, never cut off mid-thought. For each claim you've heard, say how likely you think it is to be true, from 0 to 100, in "beliefs". Give one integer for every claim id.`,
  ].join('\n\n');
}
