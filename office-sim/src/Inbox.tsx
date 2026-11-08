import { useEffect, useMemo, useRef, useState } from 'react';
import type { InboxThread, InboxToast, ReasonCode } from '../shared/inbox';
import { timeLabel } from './hudModel';
import { FILTER_LABEL, filterThreads, isUnread, sortThreads, toastText, type InboxFilter } from './inboxModel';
import { Sprite, type Person } from './people';
import type { WarningPreview } from './meetingPreview';

const CODE_LABEL: Partial<Record<ReasonCode, string>> = {
  UNASSIGNED: 'No owner', ON_HOLD: 'On hold', REJECTED_NO_CAPABILITY: 'Assignment rejected', REJECTED_OVER_CAPACITY: 'Assignment rejected',
  REJECTED_SELF_REVIEW: 'Assignment rejected', REJECTED_DEPS_NOT_DONE: 'Assignment rejected', REJECTED_INVALID: 'Assignment rejected',
  CHOSE_OTHER_ACTION: 'Not working on it', WORK_NOT_OFFERED: 'No active work', STALE_ASSIGNMENT: 'Assignment changed',
  DEPENDENCY_PENDING: 'Waiting on other work', INPUT_NOT_RECEIVED: 'Waiting for an input', SUPPLIER_OUTAGE: 'Supplier outage',
  NO_TIME_AFTER_COORDINATION: 'Out of time', PARTIAL_PROGRESS: 'Moving slowly', AWAITING_REVIEWER: 'Needs a reviewer',
  REWORK_AFTER_REVIEW: 'Sent back by review', AT_RISK: 'At risk', OVERDUE: 'Overdue', CASE_FAILED: 'Case failed',
  OWNER_LEFT: 'Owner left', SAVINGS_TARGET_MISSED: 'Savings missed',
  DEADLINE_INFEASIBLE: 'Deadline impossible', CHASED: 'Chased', CHASE_MISSED: 'Missed a chase', BLOCKER_FIXED_BY_MANAGER: 'Blocker fixed', MEETING_OUTCOME: 'Meeting',
};
const SEVERITY_TONE = { info: 'mint', warning: 'gold', critical: 'coral' } as const;
const SEVERITY_TEXT = { info: 'Info', warning: 'Warning', critical: 'Critical' } as const;

/** The message for the thread's current primary blocker, or its latest message. */
function lead(t: InboxThread) {
  return (t.primary && [...t.messages].reverse().find(m => m.code === t.primary!.code)) || t.messages.at(-1);
}

function Thread({ thread, people, open, unread, onToggle, onJump, onFocus, onReplay, warning, onWarn }: {
  thread: InboxThread; people: Person[]; open: boolean; unread: boolean;
  onToggle: () => void; onJump: () => void; onFocus: (id: string) => void;
  /** Present when the thread's meeting can be replayed. */
  onReplay?: () => void;
  /** "Simulate CEO warning": hidden when null, disabled with a reason when unavailable. */
  warning?: WarningPreview; onWarn?: () => void;
}) {
  const message = lead(thread);
  const owner = people.find(p => p.id === (thread.ownerId ?? thread.agentIds[0]));
  const resolved = thread.status === 'resolved';
  const tone = resolved ? 'mint' : SEVERITY_TONE[thread.severity];
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { if (open) ref.current?.scrollIntoView?.({ block: 'nearest' }); }, [open]);
  return <li ref={ref} className={`inbox-thread tone-${tone}${unread ? ' unread' : ''}`}>
    <button className="inbox-summary" aria-expanded={open} aria-controls={`thread-${thread.id}`} onClick={onToggle}>
      <span className="inbox-portrait" style={{ borderColor: owner?.color }}>{owner ? <Sprite person={owner} crop quit={owner.quit}/> : <span aria-hidden="true">?</span>}</span>
      <span className="inbox-text">
        <span className="feed-meta"><span className={tone}>{resolved ? 'Resolved' : SEVERITY_TEXT[thread.severity]}{thread.primary ? ` · ${CODE_LABEL[thread.primary.code] ?? thread.primary.code}` : ''}</span><time>Due {timeLabel(thread.deadline)}</time></span>
        <strong>{resolved ? thread.resolution?.summary ?? message?.headline : message?.headline}</strong>
        {resolved && <small>{thread.title.split(':')[0]}</small>}
      </span>
    </button>
    {open && <div className="inbox-detail" id={`thread-${thread.id}`}>
      {message && !resolved && <>
        <ul className="inbox-why">{message.why.map((line, i) => <li key={i}>{line}</li>)}</ul>
        {message.unblock && <p className="inbox-unblock"><b>Unblocks when:</b> {message.unblock}</p>}
      </>}
      {thread.also.length > 0 && <p className="inbox-also"><b>Also:</b> {thread.also.join(' · ')}</p>}
      <details open={resolved}><summary>Timeline</summary>
        <ol className="inbox-timeline">{[...thread.messages].reverse().map(m => <li key={m.id} className={SEVERITY_TONE[m.severity]}>
          <time>{timeLabel(m.tick)}</time> {m.headline}{m.count > 1 ? ` · ${m.count} hours` : ''}
          {resolved && m.why.length > 0 && <small>{m.why.join(' ')}</small>}
        </li>)}</ol>
      </details>
      <div className="inbox-actions">
        <button className="link" onClick={onJump}>Jump to task</button>
        {onReplay && <button className="link" onClick={onReplay}>Replay meeting</button>}
        {warning && onWarn && <button className="link" onClick={onWarn} disabled={!warning.ok} title={warning.ok ? 'Play the CEO warning cutscene for this task\'s owner. The simulation is not changed.' : warning.why}>Simulate CEO warning</button>}
        {thread.agentIds.map(id => { const p = people.find(x => x.id === id); return p ? <button key={id} className="link" onClick={() => onFocus(id)}>Focus {p.name}</button> : null; })}
      </div>
    </div>}
  </li>;
}

/** Task inbox: one thread per task explaining why it isn't progressing, who it's on, and what unblocks it. */
export function Inbox({ threads, people, read, focusId, onRead, onJump, onFocus, canReplay, onReplay, warningFor, onWarn }: {
  threads: InboxThread[]; people: Person[]; read: ReadonlySet<string>; focusId: string | null;
  onRead: (thread: InboxThread[]) => void; onJump: (thread: InboxThread) => void; onFocus: (agentId: string) => void;
  canReplay?: (thread: InboxThread) => boolean; onReplay?: (thread: InboxThread) => void;
  warningFor?: (thread: InboxThread) => WarningPreview; onWarn?: (thread: InboxThread) => void;
}) {
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [open, setOpen] = useState<string | null>(focusId);
  useEffect(() => { if (focusId) { setOpen(focusId); setFilter('all'); } }, [focusId]);
  const opened = threads.find(t => t.id === open);
  useEffect(() => { if (opened && isUnread(opened, read)) onRead([opened]); }, [opened, read, onRead]);
  const shown = useMemo(() => sortThreads(filterThreads(threads, filter)), [threads, filter]);
  const counts = useMemo(() => Object.fromEntries((Object.keys(FILTER_LABEL) as InboxFilter[]).map(f => [f, filterThreads(threads, f).length])), [threads]);
  const unread = threads.filter(t => isUnread(t, read));
  return <div className="inbox">
    <div className="event-panel-tabs" role="tablist" aria-label="Inbox filter">{(Object.keys(FILTER_LABEL) as InboxFilter[]).map(f =>
      <button key={f} role="tab" aria-selected={filter === f} className={`event-panel-tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{FILTER_LABEL[f]} {counts[f]}</button>)}</div>
    {unread.length > 0 && <button className="link inbox-mark" onClick={() => onRead(unread)}>Mark all read</button>}
    {shown.length ? <ul className="inbox-list">{shown.map(t => <Thread key={t.id} thread={t} people={people} open={open === t.id} unread={isUnread(t, read)}
      onToggle={() => setOpen(open === t.id ? null : t.id)} onJump={() => onJump(t)} onFocus={onFocus}
      onReplay={onReplay && canReplay?.(t) ? () => onReplay(t) : undefined}
      warning={open === t.id ? warningFor?.(t) : null} onWarn={onWarn ? () => onWarn(t) : undefined}/>)}</ul>
      : <p className="empty-state">{filter === 'all' ? 'Nothing is stuck. Tasks that stop progressing show up here with the reason.' : `No ${FILTER_LABEL[filter].toLowerCase()} tasks.`}</p>}
  </div>;
}

/** One toast at a time; critical alerts that arrive together merge into it. */
export function InboxToastView({ toasts, onOpen, onDismiss }: { toasts: InboxToast[]; onOpen: () => void; onDismiss: () => void }) {
  return <section className="inbox-toast" aria-label="Critical alert">
    <div role="alert"><span>⚠ Critical</span><p>{toastText(toasts)}</p></div>
    <button className="link" onClick={onOpen}>Open</button>
    <button className="close" onClick={onDismiss} aria-label="Dismiss alert">×</button>
  </section>;
}

/** "Why isn't this done?" for a task with an open inbox thread. */
export interface WhyProps { whyFor?: (taskId: string) => boolean; onWhy?: (taskId: string) => void }
export function WhyButton({ taskId, whyFor, onWhy }: WhyProps & { taskId: string }) {
  return whyFor?.(taskId) && onWhy ? <button className="link why-done" onClick={() => onWhy(taskId)}>Why isn't this done?</button> : null;
}
