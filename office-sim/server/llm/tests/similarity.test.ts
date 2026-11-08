import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { voiceParams as V } from '../../params';
import {
  bannedHits, eventTerms, isEchoOpener, openerMatch, patternHits, tokens, trigramSimilarity,
} from '../similarity';

describe('similarity', () => {
  it('tokenises without punctuation, splitting hyphens', () => {
    assert.deepEqual(tokens('Twenty-hour days? Sure, it’s fine.'), ['twenty', 'hour', 'days', 'sure', "it's", 'fine']);
  });

  it('scores word-trigram Jaccard similarity', () => {
    const a = "A surprise bonus? Huh. Let's see it in my paycheck first.";
    assert.equal(trigramSimilarity(a, a), 1);
    assert.ok(trigramSimilarity(a, "A surprise bonus? Huh. Let's see it in my bank first.") > 0.5);
    assert.ok(trigramSimilarity(a, 'The gym was packed this morning, no chance of a bench.') < 0.1);
    assert.equal(trigramSimilarity('Fine.', 'fine'), 1);
    assert.equal(trigramSimilarity('Fine.', 'Okay.'), 0);
  });

  it('matches openers on the first n words', () => {
    assert.ok(openerMatch('Two in the morning? No.', 'Two in the morning, really?', 3));
    assert.ok(!openerMatch('Two in the morning? No.', 'Two a.m. until launch?', 3));
    assert.ok(openerMatch('Fine.', 'fine', 3));
    assert.ok(!openerMatch('Fine.', 'Fine by me then.', 3));
  });

  it('finds banned phrases anywhere and banned sentences whole', () => {
    assert.deepEqual(bannedHits("Honestly I'm running on fumes.", V), ['running on fumes']);
    assert.deepEqual(bannedHits('Twenty-hour days? Sure.', V), ['Sure.']);
    assert.deepEqual(bannedHits("I'm not sure about that.", V), []);
    assert.deepEqual(bannedHits("It's not a plan, it's a threat.", V), ["it's not a plan, it's a threat"]);
  });

  it('finds label and tick leaks', () => {
    assert.equal(patternHits('The climber will love this.', V.labelPatterns).length, 1);
    assert.equal(patternHits("The skeptic won't sugarcoat it.", V.labelPatterns).length, 1);
    assert.equal(patternHits("Ops would know.", V.labelPatterns).length, 1);
    assert.equal(patternHits("I'm sceptical of all of it.", V.labelPatterns).length, 0);
    assert.equal(patternHits('Nine ticks and still nothing.', V.tickPatterns).length, 1);
  });

  it('detects echo openers about the event', () => {
    const long = eventTerms({ type: 'long_hours_policy', text: 'New policy: everyone stays until 2am until the launch date.' }, V.eventKeyTerms);
    assert.ok(isEchoOpener('Two in the morning? Sure.', long, 5));
    assert.ok(isEchoOpener('Staying until 2am every night? Nope.', long, 5));
    assert.ok(!isEchoOpener('Rosa, can you cover the school run tomorrow?', long, 5));
    const bonus = eventTerms({ type: 'surprise_bonus', text: 'Everyone gets a surprise bonus this month.' }, V.eventKeyTerms);
    assert.ok(isEchoOpener("A surprise bonus? Huh. Let's see it in my paycheck first.", bonus, 5));
    const custom = eventTerms({ type: 'merger', text: 'The canteen is closing for renovation.', custom: true }, V.eventKeyTerms);
    assert.ok(isEchoOpener('The canteen closing? Great.', custom, 5));
    assert.ok(!isEchoOpener('How does the canteen closure affect the evening shift?', custom));
    assert.ok(!isEchoOpener('Rae, does the bonus change our tax paperwork?', bonus));
  });
});
