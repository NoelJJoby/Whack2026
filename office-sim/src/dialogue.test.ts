import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TickFrame } from '../shared/api';
import type { Action, TickRecord } from '../shared/types';
import { mockHistory } from './mocks';
import {
  AUTO_BASE_MS, AUTO_PER_WORD_MS, CHARS_PER_SECOND, DIALOGUE_CAP, PUNCTUATION_PAUSE_MS,
  buildRound, current, idle, playerReducer, readingDelay, typeDelay, type DialogueLine, type PlayerAction, type PlayerState,
} from './dialogueQueue';

const base = mockHistory.at(-1)!;
function frame(tick: number, records: Array<Partial<TickRecord> & { agent: string }>, stress: Record<string, number> = {}, events = false): TickFrame {
  const agents = structuredClone(base.state.agents);
  for (const id of Object.keys(agents)) agents[id].stress = stress[id] ?? 50;
  return {
    ...base, tick, events: events ? [{ type: 'merger', is_true: true, text: 'Merger.' }] : [],
    state: { ...base.state, tick, agents },
    records: records.map(r => ({ tick, event: null, action: 'work' as Action, target: null, summary: '', public_line: `${r.agent} says.`, inner_monologue: `${r.agent} thinks.`, ...r })),
  };
}
const run = (state: PlayerState, ...actions: PlayerAction[]) => actions.reduce(playerReducer, state);
const typeAll = (state: PlayerState, showThoughts = true) => {
  while (state.phase === 'public' || state.phase === 'inner') state = playerReducer(state, { type: 'type', showThoughts });
  return state;
};
const line = (agent: string, publicLine = 'Hi.', inner = 'Hm.'): DialogueLine =>
  ({ key: agent, tick: 1, agent, publicLine, inner, quit: false, action: 'work', emotion: 'normal', tier: 6, stress: 50, stressDelta: 0 });

test('round skips empty lines and orders quit > leak > gossip > stress jump > other', () => {
  const prev = frame(1, []);
  const round = buildRound(frame(2, [
    { agent: 'marcus' }, { agent: 'priya', public_line: '   ' }, { agent: 'sam' },
    { agent: 'dan', action: 'gossip' }, { agent: 'jess', action: 'leak' }, { agent: 'tom', quit: true },
  ], { sam: 70, marcus: 52 }), prev);
  assert.deepEqual(round.map(l => l.agent), ['tom', 'jess', 'dan', 'sam', 'marcus']);
  assert.deepEqual(round.map(l => l.tier), [1, 2, 4, 5, 6]);
  assert.equal(round[3].stressDelta, 20);
  assert.ok(round.every(l => l.publicLine));
});
test('event ticks rank every speaker as a reaction, ordered by stress change', () => {
  const round = buildRound(frame(2, [{ agent: 'marcus' }, { agent: 'sam' }, { agent: 'tom', action: 'leak' }], { sam: 65, marcus: 55 }, true), frame(1, []));
  assert.deepEqual(round.map(l => [l.agent, l.tier]), [['tom', 2], ['sam', 3], ['marcus', 3]]);
});
test('round is capped and keeps the most dramatic lines', () => {
  const ids = Object.keys(base.state.agents);
  const round = buildRound(frame(2, ids.map((agent, i) => ({ agent, quit: i === ids.length - 1 }))), frame(1, []));
  assert.equal(round.length, DIALOGUE_CAP);
  assert.equal(round[0].agent, ids.at(-1));
});
test('typing speed, punctuation pause and reading delay', () => {
  assert.equal(typeDelay('Hi, you', 1), 1000 / CHARS_PER_SECOND);
  assert.equal(typeDelay('Hi, you', 3), 1000 / CHARS_PER_SECOND + PUNCTUATION_PAUSE_MS);
  assert.equal(readingDelay(line('a', 'One two three.', 'Four.'), true), AUTO_BASE_MS + 4 * AUTO_PER_WORD_MS);
  assert.equal(readingDelay(line('a', 'One two three.', 'Four.'), false), AUTO_BASE_MS + 3 * AUTO_PER_WORD_MS);
  const thirty = Array.from({ length: 30 }, () => 'word').join(' ');
  const ms = Array.from(thirty, (_, i) => typeDelay(thirty, i)).reduce((a, b) => a + b, 0);
  assert.ok(ms > 2000 && ms < 3000, `30 words type in ${ms}ms`);
});
test('public line types, then inner; Next completes, then advances', () => {
  let s = run(idle, { type: 'round', lines: [line('a'), line('b')] });
  assert.equal(s.phase, 'public');
  s = run(s, { type: 'type', showThoughts: true }, { type: 'type', showThoughts: true });
  assert.equal(s.shownPublic, 2);
  s = run(s, { type: 'type', showThoughts: true });
  assert.equal(s.phase, 'inner');
  s = run(s, { type: 'next', auto: false });
  assert.equal(s.phase, 'reading');
  assert.equal(s.shownInner, 3);
  s = run(s, { type: 'next', auto: false });
  assert.equal(current(s)?.agent, 'b');
  assert.equal(s.phase, 'public');
  s = run(typeAll(s), { type: 'next', auto: false });
  assert.equal(s.phase, 'idle');
});
test('hidden thoughts skip the inner phase; auto fires only while reading', () => {
  let s = run(idle, { type: 'round', lines: [line('a'), line('b')] });
  assert.equal(run(s, { type: 'auto' }), s);
  s = typeAll(s, false);
  assert.equal(s.shownInner, 0);
  assert.equal(current(run(s, { type: 'auto' }))?.agent, 'b');
});
test('new round mid-queue: auto jumps after the current line, manual waits for the end', () => {
  const first = run(idle, { type: 'round', lines: [line('a'), line('b'), line('c')] });
  const queued = run(first, { type: 'round', lines: [line('x')] }, { type: 'round', lines: [line('y')] });
  assert.equal(current(queued)?.agent, 'a');
  assert.equal(queued.pending?.[0].agent, 'y');
  assert.equal(current(run(typeAll(queued), { type: 'auto' }))?.agent, 'y');
  let manual = run(typeAll(queued), { type: 'next', auto: false });
  assert.equal(current(manual)?.agent, 'b');
  manual = run(typeAll(manual), { type: 'next', auto: false }, { type: 'complete' }, { type: 'next', auto: false });
  assert.equal(current(manual)?.agent, 'y');
  assert.equal(current(run(queued, { type: 'skip' }))?.agent, 'y');
  assert.equal(run(first, { type: 'skip' }).phase, 'idle');
  assert.equal(run(queued, { type: 'round', lines: [] }), queued);
  assert.equal(run(queued, { type: 'clear' }), idle);
});
