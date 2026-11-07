import assert from 'node:assert/strict';

import { placeholderPersonas } from '../personas';
import { ambitionSentence, ethicsSentence, financialNeedSentence, impulsivitySentence,
  sociabilitySentence, sourceTrustSentence } from '../traits';

const cases: [((value: number) => string), string[]][] = [
  [ambitionSentence, ["You're content where you are.",
    "You'd like to move up if the chance came.",
    'You want the next role badly and watch who is in your way.']],
  [financialNeedSentence, ['You could walk away from this job tomorrow.',
    'You need this job but have some cushion.', "You can't afford to lose this income."]],
  [ethicsSentence, ['You bend rules when it suits you.',
    "You try to do the right thing when it's easy.", 'You hate dishonesty and say so.']],
  [sociabilitySentence, ['You keep to yourself.', 'You chat with a few people.',
    'You talk to everyone and hear everything.']],
  [impulsivitySentence, ['You think before you act.', 'You sometimes act before thinking.',
    'You act on the first impulse and regret it later.']],
  [sourceTrustSentence, ["you don't believe much of what they say",
    "you're not sure how far to trust them", 'you generally trust them']],
];

for (const [sentence, expected] of cases) {
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
console.log('Trait/source-trust checks passed (six tables, six boundaries); eight temporary personas.');
