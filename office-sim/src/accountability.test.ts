// Meeting cutscenes and stand-up chases on the dialogue bar.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TickFrame } from '../shared/api';
import type { MeetingScene } from '../shared/accountability';
import { mockHistory } from './mocks';
import { CHASE_LINE_CAP, buildRound, current, meetingLines, playerReducer, type DialogueLine, type PlayerState } from './dialogueQueue';

const base = mockHistory.at(-1)!;
const scene = (id: string, agent: string, outcome: MeetingScene['outcome'], cutscene: boolean): MeetingScene => ({
  id, tick: base.tick, boss: 'dan', agent, taskId: `task-${agent}`, taskTitle: 'Release', outcome, reason: 'slacked', cutscene, source: 'template',
  lines: { boss: 'This is your warning.', reply: 'Understood.', inner: 'I need to fix this.' },
});
const frame = (meetings: MeetingScene[], chases = 0): TickFrame => ({ ...base, records: [], events: [], accountability: {
  meetings, chases: Array.from({ length: chases }, (_, i) => ({ id: `c${i}`, tick: base.tick, taskId: `t${i}`, taskTitle: 'T', chaser: 'omar', owner: 'tom', dueBy: base.tick + 12, expectRemaining: 0, line: `Tom, chase ${i}.` })),
} });
const typeAll = (state: PlayerState, showThoughts: boolean) => {
  while (state.phase === 'public' || state.phase === 'inner') state = playerReducer(state, { type: 'type', showThoughts });
  return state;
};

test('a cutscene meeting plays the boss line, then the reply with the outcome stamp; summarised meetings stay off the bar', () => {
  const round = buildRound(frame([scene('m1', 'tom', 'warning', true), scene('m2', 'sam', 'warning', false)]));
  const lines = round.filter(l => l.meeting);
  assert.deepEqual(lines.map(l => l.agent), ['dan', 'tom']);
  assert.deepEqual(lines.map(l => l.meeting!.last), [false, true]);
  assert.equal(lines[1].meeting!.stamp, 'Warning');
  assert.ok(!round.some(l => l.meeting?.agent === 'sam'));
});

test('a firing reply is marked as leaving and stamped Fired', () => {
  const [, reply] = meetingLines(scene('m1', 'tom', 'fired', true));
  assert.equal(reply.meeting!.stamp, 'Fired');
  assert.equal(reply.quit, true);
});

test('the reply reveals the inner thought even with thoughts off', () => {
  let state = playerReducer({ round: [], index: 0, phase: 'idle', shownPublic: 0, shownInner: 0, tick: null }, { type: 'round', lines: meetingLines(scene('m1', 'tom', 'warning', true)), tick: 1 });
  state = playerReducer(typeAll(state, false), { type: 'next', auto: false });
  state = typeAll(state, false);
  assert.equal(state.shownInner, current(state)!.inner.length);
});

test('skipping a meeting jumps past its lines only', () => {
  const other: DialogueLine = { kind: 'agent', key: 'x', tick: 1, agent: 'jess', publicLine: 'Hi.', inner: '', quit: false, action: 'work', emotion: 'normal', tier: 6, stress: 0, stressDelta: 0 };
  let state = playerReducer({ round: [], index: 0, phase: 'idle', shownPublic: 0, shownInner: 0, tick: null }, { type: 'round', lines: [...meetingLines(scene('m1', 'tom', 'warning', true)), other], tick: 1 });
  state = playerReducer(state, { type: 'skipMeeting' });
  assert.equal(current(state)!.agent, 'jess');
});

test('a replayed meeting plays first, then the rest of the round', () => {
  const other: DialogueLine = { kind: 'agent', key: 'x', tick: 1, agent: 'jess', publicLine: 'Hi.', inner: '', quit: false, action: 'work', emotion: 'normal', tier: 6, stress: 0, stressDelta: 0 };
  let state = playerReducer({ round: [], index: 0, phase: 'idle', shownPublic: 0, shownInner: 0, tick: null }, { type: 'round', lines: [other], tick: 5 });
  state = playerReducer(state, { type: 'insert', lines: meetingLines(scene('m1', 'tom', 'warning', true)), tick: 5 });
  assert.deepEqual(state.round.map(l => l.agent), ['dan', 'tom', 'jess']);
  assert.equal(state.tick, 5);
});

test('stand-up chases are spoken by the manager, capped per round', () => {
  const chases = buildRound(frame([], 5)).filter(l => l.chase);
  assert.equal(chases.length, CHASE_LINE_CAP);
  assert.ok(chases.every(l => l.agent === 'omar'));
});

test('inbox "Simulate CEO warning": plays a warning cutscene for the owner, gated on who is in the office', async () => {
  const { warningPreview } = await import('./meetingPreview');
  const thread = { id: 'th', taskId: 'task-1', title: 'Onboard Cedar: kickoff', ownerId: 'tom', agentIds: ['tom'], deadline: 40, contractLinked: false,
    status: 'blocked', severity: 'warning', primary: null, also: [], messages: [], openedTick: 1, updatedTick: 2 } as unknown as import('../shared/inbox').InboxThread;
  const people = [{ id: 'dan', name: 'Dan', role: 'CEO', quit: false, present: true }, { id: 'tom', name: 'Tom', role: 'Engineer', quit: false, present: true }];
  const ready = warningPreview(thread, people, 9, 'k');
  assert.ok(ready?.ok);
  const lines = meetingLines(ready.scene);
  assert.deepEqual(lines.map(l => l.agent), ['dan', 'tom']);
  assert.equal(lines[1].meeting!.stamp, 'Warning');
  assert.match(lines[0].publicLine, /Onboard Cedar/);
  // Gone home: shown but unavailable, with the reason.
  assert.deepEqual(warningPreview(thread, [people[0], { ...people[1], present: false }], 9), { ok: false, why: 'Tom has left for the day.' });
  // Hidden: resolved, no owner, or the owner has left the company.
  assert.equal(warningPreview({ ...thread, status: 'resolved' }, people, 9), null);
  assert.equal(warningPreview({ ...thread, ownerId: null }, people, 9), null);
  assert.equal(warningPreview(thread, [people[0], { ...people[1], quit: true }], 9), null);
});
