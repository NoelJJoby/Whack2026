import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';

import { parseReply } from '../parse';

function reply(text: string, stop_reason: Anthropic.Message['stop_reason'] = 'end_turn') {
  return { content: [{ type: 'text' as const, text, citations: null }], stop_reason };
}

const output = {
  proposals: [{ action: 'work', weight: 1, target: null, claim: null }],
  public_line: 'I feel tired.', inner_monologue: 'I need some space.',
  beliefs: { 'claim-1': 72.5 },
};
const raw = JSON.stringify(output);
for (const text of [raw, ` \n${raw}\n `, `\x60\x60\x60json\n${raw}\n\x60\x60\x60`,
  `\x60\x60\x60\r\n${raw}\r\n\x60\x60\x60`]) {
  assert.deepEqual(parseReply(reply(text)), output);
}

assert.deepEqual(parseReply({
  stop_reason: 'end_turn',
  content: [
    { type: 'tool_use', id: 'tool-1', name: 'unused', input: {}, caller: { type: 'direct' } },
    { type: 'text', text: raw.slice(0, 30), citations: null },
    { type: 'text', text: raw.slice(30), citations: null },
  ],
}), output, 'Only text blocks are extracted');
assert.deepEqual(parseReply(reply(raw, 'stop_sequence')), output);
for (const text of ['', '   ', 'not JSON', '{', `Here is JSON: ${raw}`,
  `\x60\x60\x60json\n${raw}\n\x60\x60\x60\ntrailing prose`]) {
  assert.equal(parseReply(reply(text)), null);
}
assert.equal(parseReply({ content: [], stop_reason: 'end_turn' }), null);
assert.equal(parseReply({
  content: [{ type: 'tool_use', id: 'tool-1', name: 'unused', input: {}, caller: { type: 'direct' } }],
  stop_reason: 'end_turn',
}), null);
for (const reason of ['max_tokens', 'tool_use', 'pause_turn', 'refusal',
  'model_context_window_exceeded', null] as const) {
  assert.equal(parseReply(reply(raw, reason)), null, `Unusable completion: ${reason}`);
}

// The engine must receive these unchanged so it can normalize, retry or fall back.
for (const value of [
  { ...output, proposals: [{ action: 'invalid', weight: 1 }] },
  { ...output, proposals: [{ action: 'work', weight: -1 }] },
  { ...output, proposals: [] },
  { ...output, proposals: Array(4).fill(output.proposals[0]) },
  { ...output, beliefs: { 'claim-1': -1, 'claim-2': 101 } },
  { ...output, proposals: [output.proposals[0], output.proposals[0]] },
  { action: 'work_normally', claim_id: 'claim-1' },
  {}, [], 'legacy response', 42, false,
]) {
  assert.deepEqual(parseReply(reply(JSON.stringify(value))), value);
}
console.log('Reply parsing checks passed; schema-invalid JSON reaches the engine unchanged.');
