import assert from 'node:assert/strict';

import { placeholderPersonas } from '../personas';
import { ambitionSentence, ethicsSentence, financialNeedSentence, impulsivitySentence,
  sociabilitySentence, sourceTrustSentence } from '../traits';

// Traits: five bands, the middle three keeping the original wording.
const traitCases: [((value: number) => string), string[]][] = [
  [ambitionSentence, ['You have no interest in promotion and avoid being noticed.', "You're content where you are.",
    "You'd like to move up if the chance came.",
    'You want the next role badly and watch who is in your way.',
    'You would step on anyone to get ahead, and everyone can tell.']],
  [financialNeedSentence, ["You don't need the money at all; this job is a choice.", 'You could walk away from this job tomorrow.',
    'You need this job but have some cushion.', "You can't afford to lose this income.",
    'One missed paycheque and you lose your home.']],
  [ethicsSentence, ['You lie easily and feel nothing about it.', 'You bend rules when it suits you.',
    "You try to do the right thing when it's easy.", 'You hate dishonesty and say so.',
    'You would blow the whistle on anyone, whatever it cost you.']],
  [sociabilitySentence, ['You barely speak to anyone and eat lunch alone.', 'You keep to yourself.', 'You chat with a few people.',
    'You talk to everyone and hear everything.', "You can't keep anything to yourself and know everyone's business."]],
  [impulsivitySentence, ['You plan every move and never act in the heat of the moment.', 'You think before you act.',
    'You sometimes act before thinking.', 'You act on the first impulse and regret it later.',
    'You do whatever you feel like the second you feel it.']],
];
const trustCases: [((value: number) => string), string[]][] = [
  [sourceTrustSentence, ["you don't believe much of what they say",
    "you're not sure how far to trust them", 'you generally trust them']],
];

for (const [sentence, expected] of traitCases) {
  for (const [value, band] of [[0, 0], [14, 0], [15, 1], [39, 1], [40, 2], [69, 2], [70, 3], [89, 3], [90, 4], [100, 4]]) {
    assert.equal(sentence(value), expected[band], `${sentence.name} at ${value}`);
    assert.doesNotMatch(sentence(value), /\d/);
  }
}
for (const [sentence, expected] of trustCases) {
  for (const [value, band] of [[0, 0], [39, 0], [40, 1], [69, 1], [70, 2], [100, 2]]) {
    assert.equal(sentence(value), expected[band], `${sentence.name} at ${value}`);
    assert.doesNotMatch(sentence(value), /\d/);
  }
}
assert.equal(placeholderPersonas.length, 8);
assert.equal(new Set(placeholderPersonas).size, 8);
for (const persona of placeholderPersonas) {
  assert.ok(persona.startsWith('You '));
  assert.doesNotMatch(persona, /archetype|flight risk|gossip hub|climber|loyalist|skeptic|breadwinner|\d/i);
}
console.log('Trait/source-trust checks passed (five trait tables at ten boundaries, source trust at six); eight temporary personas.');
