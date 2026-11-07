import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { toLlmOutput } from '../llm-adapter';

describe('llm adapter', () => {
  it('accepts the brief format', () => {
    const r = toLlmOutput({
      proposals: [
        { action: 'complain', weight: 0.5, target: 'priya' },
        { action: 'work_normally', weight: 0.3 },
        { action: 'interview', weight: 0.2 },
      ],
      public_line: "Fine, I'll get it done.",
      inner_monologue: 'Third late night this week.',
      beliefs: { claim_layoffs_q4: 72 },
    });
    assert.equal(r.reason, null);
    assert.deepEqual(r.output?.proposals, [
      { action: 'complain', weight: 0.5, target: 'priya' },
      { action: 'work', weight: 0.3 },
      { action: 'interview', weight: 0.2 },
    ]);
    assert.deepEqual(r.output?.beliefs, { claim_layoffs_q4: 72 });
  });

  it('turns a single-action LlmTurn into one proposal with weight 1 and no beliefs', () => {
    const r = toLlmOutput({ action: 'gossip', target: 'tom', claim_id: 'c1', public_line: 'hey', inner_monologue: 'hm' });
    assert.deepEqual(r.output?.proposals, [{ action: 'gossip', weight: 1, target: 'tom', claim: 'c1' }]);
    assert.deepEqual(r.output?.beliefs, {});
    assert.equal(r.output?.public_line, 'hey');
  });

  it('carries an optional claim per proposal', () => {
    const r = toLlmOutput({
      proposals: [{ action: 'gossip', weight: 0.7, target: 'tom', claim: 'c9' }, { action: 'work', weight: 0.3, claim: null }],
      public_line: 'x', inner_monologue: 'y', beliefs: { c9: 80 },
    });
    assert.deepEqual(r.output?.proposals, [
      { action: 'gossip', weight: 0.7, target: 'tom', claim: 'c9' },
      { action: 'work', weight: 0.3 },
    ]);
  });

  it('parses JSON strings', () => {
    const r = toLlmOutput('{"action":"work_normally","public_line":"ok","inner_monologue":"ok"}');
    assert.deepEqual(r.output?.proposals, [{ action: 'work', weight: 1 }]);
  });

  it('drops unknown actions and keeps the rest', () => {
    const r = toLlmOutput({ proposals: [{ action: 'dance', weight: 0.9 }, { action: 'verify', weight: 0.1 }] });
    assert.deepEqual(r.output?.proposals, [{ action: 'verify', weight: 0.1 }]);
    assert.deepEqual(r.dropped, ['dance']);
  });

  it('keeps at most three proposals, highest weight first', () => {
    const r = toLlmOutput({
      proposals: [
        { action: 'work', weight: 0.1 },
        { action: 'overwork', weight: 0.4 },
        { action: 'gossip', weight: 0.3 },
        { action: 'complain', weight: 0.2 },
      ],
    });
    assert.deepEqual(r.output?.proposals.map((p) => p.action), ['overwork', 'gossip', 'complain']);
  });

  it('clamps beliefs and drops non-numbers', () => {
    const r = toLlmOutput({ proposals: [{ action: 'work', weight: 1 }], beliefs: { a: 150, b: -3, c: 'x' } });
    assert.deepEqual(r.output?.beliefs, { a: 100, b: 0 });
  });

  it('returns null with a reason for unusable output', () => {
    assert.equal(toLlmOutput(null).reason, 'no_output');
    assert.equal(toLlmOutput('{not json').reason, 'invalid_json');
    assert.equal(toLlmOutput({ foo: 1 }).reason, 'schema_mismatch');
    assert.equal(toLlmOutput({ proposals: [{ action: 'dance', weight: 1 }] }).reason, 'no_valid_actions');
    assert.equal(toLlmOutput({ proposals: [{ action: 'work', weight: 0 }] }).reason, 'zero_weights');
    assert.equal(toLlmOutput({ proposals: [] }).reason, 'schema_mismatch');
  });
});
