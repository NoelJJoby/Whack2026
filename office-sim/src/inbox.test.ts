import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TickFrame } from '../shared/api';
import type { InboxMessage, InboxThread } from '../shared/inbox';
import { Inbox, InboxToastView } from './Inbox';
import { filterThreads, inboxAt, newToasts, openThreadFor, sortThreads, toastText, unreadCount } from './inboxModel';

const message = (id: string, severity: InboxMessage['severity'], headline = id): InboxMessage =>
  ({ id, tick: 1, lastTick: 1, count: 1, stage: 'assignment', code: 'UNASSIGNED', severity, headline, why: ['why'], unblock: 'fix' });
const thread = (id: string, over: Partial<InboxThread> = {}): InboxThread => ({
  id, taskId: id, title: id, ownerId: null, agentIds: [], deadline: 50, contractLinked: false, status: 'blocked', severity: 'warning',
  primary: { stage: 'assignment', code: 'UNASSIGNED' }, also: [], messages: [message(`${id}-m`, over.severity ?? 'warning')], openedTick: 1, updatedTick: 1, ...over,
});
const frame = (tick: number, threads: InboxThread[], toasts: Array<{ threadId: string; messageId: string; headline: string }> = []) =>
  ({ tick, inbox: { threads, toasts } }) as unknown as TickFrame;

test('folds deltas onto the base up to the presented frame', () => {
  const base = [thread('a')];
  const updated = thread('a', { status: 'resolved', resolution: { tick: 3, summary: 'done' } });
  const history = [frame(2, [thread('b')]), frame(3, [updated])];
  assert.deepEqual(inboxAt(base, history).map(t => [t.id, t.status]), [['a', 'resolved'], ['b', 'blocked']]);
  assert.deepEqual(inboxAt(base, history.slice(0, 1)).map(t => [t.id, t.status]), [['a', 'blocked'], ['b', 'blocked']]);
});

test('filters and sorts by severity, then the closest deadline; resolved last', () => {
  const threads = [thread('late', { deadline: 90 }), thread('soon', { deadline: 10 }), thread('crit', { severity: 'critical', deadline: 99 }),
    thread('risk', { status: 'at_risk', deadline: 5 }), thread('done', { status: 'resolved', severity: 'info' })];
  assert.deepEqual(sortThreads(threads).map(t => t.id), ['crit', 'risk', 'soon', 'late', 'done']);
  assert.deepEqual(filterThreads(threads, 'at_risk').map(t => t.id), ['risk']);
  assert.deepEqual(filterThreads(threads, 'resolved').map(t => t.id), ['done']);
});

test('unread counts warnings and criticals only; Why finds the open thread', () => {
  const threads = [thread('a'), thread('b', { severity: 'info' }), thread('c', { status: 'resolved' })];
  assert.equal(unreadCount(threads, new Set()), 2);
  assert.equal(unreadCount(threads, new Set(['a-m'])), 1);
  assert.equal(openThreadFor(threads, 'a')?.id, 'a');
  assert.equal(openThreadFor(threads, 'c'), undefined);
});

test('critical alerts that arrive together merge into one toast', () => {
  const history = [frame(1, [], [{ threadId: 'x', messageId: 'x1', headline: 'old' }]),
    frame(2, [], [{ threadId: 'a', messageId: 'a1', headline: 'A failed' }, { threadId: 'b', messageId: 'b1', headline: 'B lost its owner' }])];
  const fresh = newToasts(history, 1);
  assert.equal(fresh.length, 2);
  assert.equal(toastText(fresh), '2 new critical alerts');
  assert.equal(toastText(fresh.slice(0, 1)), 'A failed');
  assert.match(renderToStaticMarkup(createElement(InboxToastView, { toasts: fresh, onOpen: () => {}, onDismiss: () => {} })), /2 new critical alerts/);
});

test('renders a focused thread with its why chain, fix and timeline', () => {
  const html = renderToStaticMarkup(createElement(Inbox, { threads: [thread('a')], people: [], read: new Set<string>(), focusId: 'a', onRead: () => {}, onJump: () => {}, onFocus: () => {} }));
  assert.match(html, /Unblocks when:/);
  assert.match(html, /Jump to task/);
  assert.match(html, /Timeline/);
});
