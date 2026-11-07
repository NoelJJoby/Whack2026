import assert from 'node:assert/strict';

import { burnoutSentence, loyaltySentence, managementTrustSentence,
  stateParagraph, stressSentence } from '../bands';

const cases: [((value: number) => string), string[]][] = [
  [stressSentence, ['You feel on top of things.', "You're stretched and short-tempered.",
    "You're overwhelmed and close to snapping."]],
  [burnoutSentence, ['You have energy for the work.', "You're running on fumes most days.",
    'You dread opening your laptop.']],
  [loyaltySentence, ["You'd happily leave for a better offer.",
    'You care about the team but have limits.', 'This place feels like part of who you are.']],
  [managementTrustSentence, ['You assume leadership is lying to you.',
    'You doubt what leadership tells you.', 'You think leadership mostly means well.']],
];

for (const [sentence, expected] of cases) {
  for (const [value, band] of [[0, 0], [39, 0], [40, 1], [69, 1], [70, 2], [100, 2]]) {
    assert.equal(sentence(value), expected[band], `${sentence.name} at ${value}`);
  }
}
const paragraph = stateParagraph({ stress: 73, burnout: 46, loyalty: 28, trust_mgmt: 81 });
assert.equal(paragraph, "You're overwhelmed and close to snapping. "
  + "You're running on fumes most days. You'd happily leave for a better offer. "
  + 'You think leadership mostly means well.');
assert.doesNotMatch(paragraph, /\d|\n|workload|trust_mgmt/);
console.log('State wording checks passed (all four tables and six boundaries each).');
