import assert from 'node:assert/strict';

import { FEELING_TABLES, burnoutSentence, loyaltySentence, managementTrustSentence,
  stateParagraph, stressSentence } from '../bands';

const cases: [((value: number, variants?: readonly number[]) => string), keyof typeof FEELING_TABLES][] = [
  [stressSentence, 'stress'], [burnoutSentence, 'burnout'], [loyaltySentence, 'loyalty'], [managementTrustSentence, 'trust'],
];

for (const [sentence, name] of cases) {
  const table = FEELING_TABLES[name];
  for (const [value, band] of [[0, 0], [39, 0], [40, 1], [69, 1], [70, 2], [100, 2]]) {
    assert.equal(sentence(value), table[band][0], `${name} at ${value}`);
    for (let variant = 0; variant < 3; variant++) {
      const variants = [0, 0, 0];
      variants[band] = variant;
      assert.equal(sentence(value, variants), table[band][variant], `${name} at ${value}, variant ${variant}`);
    }
  }
}

// Facts, not stock phrases, and nine distinct sentences per feeling.
const banned = /running on fumes|close to snapping|dread|stretched|lying to you|on top of things/i;
for (const table of Object.values(FEELING_TABLES)) {
  const all = table.flat();
  assert.equal(new Set(all).size, 9);
  for (const s of all) {
    assert.doesNotMatch(s, banned);
    assert.match(s, /\.$/);
  }
}

const paragraph = stateParagraph({ stress: 73, burnout: 46, loyalty: 28, trust_mgmt: 81 },
  { stress: [0, 0, 1], burnout: [0, 2, 0], loyalty: [1, 0, 0], trust: [0, 0, 2] });
assert.equal(paragraph, 'You jump every time a message comes in. '
  + 'Your weekends go on recovering from the week. You wouldn\'t miss this place much. '
  + "You've seen the company look after people who struggled.");
assert.doesNotMatch(paragraph, /\d|\n|workload|trust_mgmt/);
console.log('State wording checks passed (four tables, three variants, six boundaries each).');
