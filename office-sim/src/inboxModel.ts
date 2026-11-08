// Client side of the task inbox: fold the server's per-hour deltas up to the presented hour,
// then filter, sort, count unread and batch critical toasts. Pure functions (tested in inbox.test.ts).
import type { TickFrame } from '../shared/api';
import { SEVERITY_RANK, applyInboxDelta, type InboxThread, type InboxToast } from '../shared/inbox';

export type InboxFilter = 'all' | 'blocked' | 'at_risk' | 'resolved';
export const FILTER_LABEL: Record<InboxFilter, string> = { all: 'All', blocked: 'Blocked', at_risk: 'At risk', resolved: 'Resolved' };

/** Inbox as of the last frame in `history` (the presented hours only, so it never runs ahead of playback). */
export function inboxAt(base: InboxThread[], history: TickFrame[]): InboxThread[] {
  return history.reduce((threads, frame) => applyInboxDelta(threads, frame.inbox), base);
}

export function filterThreads(threads: InboxThread[], filter: InboxFilter): InboxThread[] {
  return filter === 'all' ? threads : threads.filter(t => t.status === filter);
}

/** Open threads first, by severity then the closest deadline; resolved ones last, newest first. */
export function sortThreads(threads: InboxThread[]): InboxThread[] {
  return [...threads].sort((a, b) => Number(a.status === 'resolved') - Number(b.status === 'resolved')
    || (a.status === 'resolved' ? b.updatedTick - a.updatedTick
      : SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.deadline - b.deadline || a.id.localeCompare(b.id)));
}

const alerting = (t: InboxThread) => t.messages.filter(m => m.severity !== 'info');

/** Threads with a warning or critical message the viewer hasn't opened. */
export function unreadCount(threads: InboxThread[], read: ReadonlySet<string>): number {
  return threads.filter(t => alerting(t).some(m => !read.has(m.id))).length;
}
export const isUnread = (t: InboxThread, read: ReadonlySet<string>) => alerting(t).some(m => !read.has(m.id));
export const messageIds = (t: InboxThread) => t.messages.map(m => m.id);

/** The open thread for a task, for "Why isn't this done?". */
export function openThreadFor(threads: InboxThread[], taskId: string): InboxThread | undefined {
  return threads.find(t => t.taskId === taskId && t.status !== 'resolved');
}

/** Critical alerts in frames after `afterTick`, merged into one batch. */
export function newToasts(history: TickFrame[], afterTick: number): InboxToast[] {
  return history.filter(f => f.tick > afterTick).flatMap(f => f.inbox?.toasts ?? []);
}
export function toastText(toasts: InboxToast[]): string {
  return toasts.length === 1 ? toasts[0].headline : `${toasts.length} new critical alerts`;
}

/** Per-viewer read state for one run. Storage can be missing or throw; the inbox still works without it. */
export function loadRead(runId: string | undefined): Set<string> {
  if (!runId) return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(`inbox-read:${runId}`) ?? '[]') as string[]); } catch { return new Set(); }
}
export function saveRead(runId: string | undefined, read: ReadonlySet<string>) {
  if (!runId) return;
  try { localStorage.setItem(`inbox-read:${runId}`, JSON.stringify([...read].slice(-2000))); } catch { /* per-viewer convenience only */ }
}
