import assert from 'node:assert/strict';
import { z } from 'zod';

import { ACTIONS, type TurnContext } from '../../engine-types';
import { fixtureCast } from '../../scripts/fixture';
import { makeAgent } from '../../test/helpers';
import { placeholderPersonas, temporaryPersonaFor } from '../personas';
import { buildTurnPrompt } from '../prompt';

// Desired output schema is a test oracle only; the provider has no schema gate.
const ProposalSchema = z.object({
  action: z.enum(['work', 'overwork', 'slack_off', 'complain', 'gossip', 'verify', 'interview', 'leak', 'review_work', 'report_issue', 'support_colleague']),
  weight: z.number().min(0), target: z.string().nullable().optional(), claim: z.string().nullable().optional(),
});
const LlmOutputSchema = z.object({
  proposals: z.array(ProposalSchema).min(1).max(3), public_line: z.string(),
  inner_monologue: z.string(), beliefs: z.record(z.number().min(0).max(100)),
});
const agent = makeAgent('a1', {}).profile;
const ctx: TurnContext = {
  tick: 8, mode: 'llm_bias', state: makeAgent('a1', { trust_mgmt: 12, source_trust: { a2: 90 } }).state,
  available: [...ACTIONS],
  colleagues: [{ id: 'a2', name: 'Rae', affinity: 80, source_trust: 90 }],
  claims: [
    { id: 'claim-a', text: 'An audit is coming.', from: 'a2', tick_heard: 4, scandal: true },
    { id: 'claim-b', text: 'The office will move.', from: 'mgmt', tick_heard: 8, scandal: false },
    { id: 'claim-c', text: 'There may be a bonus.', from: 'grapevine', tick_heard: 7, scandal: false },
  ],
  events: [{ type: 'new_management', text: 'A new manager arrives.' }],
};
const prompt = buildTurnPrompt(agent, ctx, 'You remember favours and broken promises.');
const sections = [
  'You are a professional employee in a B2B software and services company. Choose how to use your finite work time. Normal work is the baseline; personality, trust and pressure influence effort, care and communication.',
  'Who you are:', 'It is day 1, 23:00. The current hour is overtime.', 'How you feel right now:', "These describe how you feel. Don't reuse their wording.",
  "What you've heard:", 'Just announced:', 'Colleagues still here:', 'What you can do:', 'What you say out loud ("public_line"):',
  'Respond with JSON only, in this shape:',
];
let previous = -1;
for (const section of sections) {
  const index = prompt.indexOf(section);
  assert.ok(index > previous, `Missing or misplaced section: ${section}`);
  previous = index;
}
assert.ok(prompt.includes("Who you are: You're A1. You work in Engineering. You remember favours and broken promises."));
assert.ok(prompt.includes('(key: c1), from Rae, this afternoon. you generally trust them. This is a scandal claim.'));
assert.ok(prompt.includes("(key: c2), from management, just now. you don't believe much of what they say."));
assert.ok(prompt.includes("(key: c3), from the grapevine, a couple of hours ago. you're not sure how far to trust them."));
assert.ok(prompt.includes('A new manager arrives.'));
assert.ok(prompt.includes('Colleagues still here: Rae'));
assert.ok(prompt.includes('Public and inner lines express mood, without claiming an action has already happened'));
assert.ok(prompt.includes("- Don't repeat, quote or name the announcement. Don't open with a question about it."));
assert.ok(prompt.includes('- About 15 words at most.'));
assert.ok(prompt.includes("at most 30 words. Start them from what's on your mind, not with the announcement, and don't copy the facts above."));
assert.ok(prompt.includes('"running on fumes"') && prompt.includes('"Sure."'), 'banned phrases are listed');
assert.ok(prompt.includes('For each claim you\'ve heard, say how likely you think it is to be true, from 0 to 100, in "beliefs", keyed by claim key. Give one integer for every claim key.'));
assert.doesNotMatch(prompt, /\btick|claim-[abc]|\ba2\b|grapevine,? heard/i);
// Without a voice brief there is no style section; with one, it comes after the actions.
assert.ok(!prompt.includes('How you talk:'));

function example(text: string): unknown {
  return JSON.parse(text.split('Respond with JSON only, in this shape: ')[1].split('\n')[0]);
}
const desired = LlmOutputSchema.parse(example(prompt));
assert.deepEqual(Object.keys(desired.beliefs), ['c1', 'c2', 'c3']);
for (const action of ACTIONS) {
  const only = buildTurnPrompt(agent, { ...ctx, available: [action] });
  const offered = only.split('What you can do:\n')[1].split('\n\n')[0]
    .split('\n').filter(line => line.startsWith('- ')).map(line => line.split(':')[0].slice(2));
  assert.deepEqual(offered, [action]);
  assert.equal(LlmOutputSchema.parse(example(only)).proposals[0].action, action);
  assert.ok(ProposalSchema.safeParse({ action, weight: 0, target: null, claim: null }).success);
}
assert.ok(LlmOutputSchema.safeParse({ ...desired, beliefs: { 'claim-a': 50.5 } }).success,
  'Integer instruction must not tighten the agreed numeric belief schema');
for (const invalid of [
  { ...desired, proposals: [] }, { ...desired, proposals: Array(4).fill({ action: 'work', weight: 1 }) },
  { ...desired, proposals: [{ action: 'invented', weight: 1 }] },
  { ...desired, proposals: [{ action: 'work', weight: -1 }] },
  { ...desired, beliefs: { 'claim-a': -1 } }, { ...desired, beliefs: { 'claim-a': 101 } },
]) assert.equal(LlmOutputSchema.safeParse(invalid).success, false);

const empty = buildTurnPrompt(agent, { ...ctx, claims: [], colleagues: [], events: [], available: ['work'] });
assert.ok(empty.includes("What you've heard:\nYou haven't heard anything new."));
assert.ok(empty.includes('Nothing new has been announced.'));
assert.ok(empty.includes('Colleagues still here: None.'));
assert.deepEqual(LlmOutputSchema.parse(example(empty)).beliefs, {});
// Each seed deals the placeholder personas out in its own order, one per character.
const dealt = fixtureCast(42).map((member) => member.profile.persona!);
assert.deepEqual([...dealt].sort(), [...placeholderPersonas].sort());
assert.notDeepEqual(dealt, fixtureCast(43).map((member) => member.profile.persona!));
fixtureCast(42).forEach((member, index) => {
  assert.equal(temporaryPersonaFor(member.profile.id), placeholderPersonas[index]);
  const identity = buildTurnPrompt(member.profile, ctx).split('Who you are: ')[1].split('\n')[0];
  assert.ok(identity.startsWith(`You're ${member.profile.name}. `) && identity.endsWith(member.profile.persona!));
});

// The voice brief, examples, colleagues' lines and the nudge render in order.
const voiced = buildTurnPrompt(agent, {
  ...ctx,
  speech: {
    voice: "You're clipped and terse.", manner: 'give a minimal reply, one to four words.', minimal: true,
    feelings: { stress: [0, 0, 0], burnout: [0, 0, 0], loyalty: [0, 0, 0], trust: [0, 0, 0] },
    examples: ['Rain again.'], recent: [{ name: 'Rae', line: 'Busy one.' }],
    nudge: { line: 'Busy one, really.', against: 'Rae', thought: 'Two a.m. again.' },
  },
});
let at = -1;
for (const part of [
  'What you can do:', "How you talk: You're clipped and terse.\nThis time: give a minimal reply, one to four words.",
  "Things you've said at the coffee machine recently", '- "Rain again."',
  "Lines colleagues have already said. Don't reuse their wording or structure:\n- Rae: \"Busy one.\"",
  '- About 15 words at most. This time: one to four words.',
  'You were going to say: "Busy one, really.". That\'s too close to what Rae said',
  'Your thoughts were going to be: "Two a.m. again.". That\'s too close to how others are thinking',
  'Respond with JSON only',
]) {
  const i = voiced.indexOf(part);
  assert.ok(i > at, `Missing or misplaced: ${part}`);
  at = i;
}
console.log('Prompt contract checks passed: context, actions, beliefs, desired schema and seeded persona assignment.');
