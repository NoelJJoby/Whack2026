import { WhyButton, type WhyProps } from './Inbox';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TickFrame } from '../shared/api';
import type { CompanyActivity, CompanyTaskDetail, CompanyTaskSummary } from '../shared/companyTasks';
import type { AgentProfile, SimulationState } from '../shared/types';
import {
  ACTIVITY_LABEL, CATEGORY_LABEL, OBJECTIVE_STATUS, WORK_STATE_LABEL, dueIn, isActiveObjective, isSpoken, shortenQuoted, workRows,
} from './companyModel';
import { playerText, timeLabel } from './hudModel';
import { api } from './useSimulation';

const EXAMPLES = [
  'Investigate demand for a new service and plan its launch.',
  'Improve the internal handover process across teams.',
  'Build a prototype for migrating the internal access system.',
];
const DEADLINES = [[16, '2 days'], [32, '4 days'], [48, '6 days'], [64, '8 days']] as const;

function ObjectiveForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (objective: string, deadline: number) => Promise<string | null> }) {
  const [text, setText] = useState('');
  const [deadline, setDeadline] = useState(32);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = text.trim().length >= 10 && !busy && !disabled;
  return <form className="objective-form" onSubmit={async event => {
    event.preventDefault(); if (!ready) return;
    setBusy(true); setError(null);
    const failure = await onSubmit(text.trim(), deadline);
    setBusy(false);
    if (failure) setError(failure); else setText('');
  }}>
    <label htmlFor="objective-text">Give the CEO an objective</label>
    <textarea id="objective-text" rows={3} maxLength={1200} value={text} onChange={e => setText(e.target.value)} placeholder={EXAMPLES[0]}/>
    <div className="objective-examples">{EXAMPLES.map(x => <button type="button" key={x} onClick={() => setText(x)}>{x}</button>)}</div>
    <div className="objective-submit">
      <label>Deadline <select value={deadline} onChange={e => setDeadline(Number(e.target.value))}>{DEADLINES.map(([h, words]) => <option key={h} value={h}>{words} ({h}h)</option>)}</select></label>
      <button type="submit" className="post-event" disabled={!ready}>{busy ? 'Sending…' : 'Brief the CEO'}</button>
    </div>
    <p className="objective-note" role="status">{error ? <span className="coral">{error}</span> : disabled ? 'Connect a running simulation to set an objective.' : 'The CEO briefs the team at the next office hour.'}</p>
  </form>;
}

function useDetail(id: string | undefined, refresh: string) {
  const [detail, setDetail] = useState<CompanyTaskDetail | null>(null);
  useEffect(() => {
    let live = true;
    if (!id) { setDetail(null); return; }
    api<CompanyTaskDetail>(`/sim/company-tasks/${id}`).then(d => { if (live) setDetail(d); }).catch(() => { /* summary only */ });
    return () => { live = false; };
  }, [id, refresh]);
  return detail?.id === id ? detail : null;
}

function Discussion({ activity, name }: { activity: CompanyActivity[]; name: (id: string) => string }) {
  const box = useRef<HTMLOListElement>(null);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [activity.length]);
  if (!activity.length) return <p className="empty-state">No one has talked about it yet.</p>;
  return <ol className="objective-chat" ref={box}>{activity.map(a => <li key={a.id} className={a.kind}>
    <div><strong>{a.actor ? name(a.actor) : 'Company'}</strong>{a.recipients.length > 0 && <span> → {a.recipients.length > 5 ? 'everyone' : a.recipients.map(name).join(', ')}</span>}
      <small>{ACTIVITY_LABEL[a.kind]} · {timeLabel(a.tick)}</small></div>
    <p>{playerText(shortenQuoted(a.dialogue))}</p>
  </li>)}</ol>;
}

function ObjectiveView({ summary, state, history, tick, cast, onPerson, whyFor, onWhy }: WhyProps & {
  summary: CompanyTaskSummary; state: SimulationState | null; history: TickFrame[]; tick: number; cast: AgentProfile[]; onPerson: (id: string) => void;
}) {
  const detail = useDetail(summary.id, `${summary.status}-${tick}`);
  const name = (id: string) => cast.find(a => a.id === id)?.name ?? id;
  const person = (id: string | null) => id ? <button className="link" onClick={() => onPerson(id)}>{name(id)}</button> : <span className="muted">no one yet</span>;
  // Everything below follows the presented hour, so it never runs ahead of the dialogue.
  const activity = useMemo(() => history.flatMap(f => (f.company_activity ?? []).filter(a => a.companyTaskId === summary.id && (isSpoken(a) || a.kind === 'review' || a.kind === 'deferred_message')))
    .sort((a, b) => a.tick - b.tick || a.round - b.round || a.order - b.order), [history, summary.id]);
  const rows = detail ? workRows(detail, state?.business?.tasks ?? []) : [];
  const done = rows.filter(r => r.state === 'done').length;
  const outcome = summary.outcome && summary.outcome.tick <= tick ? summary.outcome : undefined;
  const findings = (detail?.findings ?? []).filter(f => f.completedTick <= tick);
  const status = OBJECTIVE_STATUS[outcome ? summary.status : isActiveObjective(summary.status) ? summary.status : 'in_progress'];
  return <article className="objective">
    <header>
      <h3>{summary.objective}</h3>
      <p><span className={`chip ${status.tone}`}>{status.text}</span>
        {summary.deadlineTick !== undefined && <span>Due {timeLabel(summary.deadlineTick)}{!outcome && ` · ${dueIn(summary.deadlineTick, tick)}`}</span>}</p>
      {rows.length > 0 && <div className="objective-progress" role="img" aria-label={`${done} of ${rows.length} work items done`}><i style={{ width: `${done / rows.length * 100}%` }}/><span>{done}/{rows.length} done</span></div>}
    </header>
    {summary.status === 'queued' && <p className="objective-note">The CEO briefs the team at the next office hour.</p>}
    {outcome && <section className={`objective-outcome ${outcome.state === 'accepted' ? 'mint' : 'coral'}`}>
      <h4>{outcome.state === 'accepted' ? 'Objective achieved' : outcome.state === 'failed' ? 'Objective failed' : 'Objective abandoned'} · {outcome.timing === 'on_time' ? 'on time' : 'late'}</h4>
      <p>{playerText(outcome.reason)}</p>
      <ul className="criteria">{outcome.criteria.map(c => <li key={c.text} className={c.accepted ? 'met' : 'unmet'}>{c.text}</li>)}</ul>
    </section>}
    {detail?.brief && !outcome && <section><h4>What the CEO asked for</h4>
      <ul className="criteria">{detail.brief.successCriteria.map(c => <li key={c}>{c}</li>)}</ul>
      {(detail.brief.assumptions.length > 0 || detail.brief.constraints.length > 0) && <details><summary>Assumptions and limits</summary>
        <ul>{[...detail.brief.assumptions, ...detail.brief.constraints].map(x => <li key={x}>{x}</li>)}</ul></details>}
    </section>}
    {rows.length > 0 && <section><h4>The work</h4><ol className="objective-work">{rows.map(r => <li key={r.id} className={r.state}>
      <div><span className="chip">{CATEGORY_LABEL[r.category]}</span><strong>{r.title}</strong></div>
      <div className="objective-bar" aria-hidden="true"><i style={{ width: `${r.progress * 100}%` }}/></div>
      <p>{WORK_STATE_LABEL[r.state]}{r.state === 'waiting' && `: ${r.needs.join(', ')}`} · {r.state === 'review' ? <>reviewer {person(r.reviewer)}</> : person(r.owner)}{r.rework > 0 && ` · sent back ${r.rework}×`}<WhyButton taskId={r.id} whyFor={whyFor} onWhy={onWhy}/></p>
      <small>Done when: {r.acceptance}</small>
    </li>)}</ol></section>}
    {findings.length > 0 && <section><h4>What they found</h4>{findings.map(f => <div className="objective-finding" key={f.id}>
      <p><strong>{name(f.producer)}</strong> <small>{timeLabel(f.completedTick)}</small></p>
      <dl>{f.facts.map(x => <div key={x.label}><dt>{x.label}</dt><dd>{x.value}</dd></div>)}</dl>
    </div>)}</section>}
    <section><h4>Team discussion</h4><Discussion activity={activity} name={name}/></section>
  </article>;
}

export function ObjectivePanel({ summaries, state, history, tick, cast, disabled, onPerson, onSubmit, whyFor, onWhy }: WhyProps & {
  summaries: CompanyTaskSummary[]; state: SimulationState | null; history: TickFrame[]; tick: number; cast: AgentProfile[];
  disabled: boolean; onPerson: (id: string) => void; onSubmit: (objective: string, deadline: number) => Promise<string | null>;
}) {
  const active = summaries.find(s => isActiveObjective(s.status));
  const past = summaries.filter(s => s !== active).reverse();
  const [shown, setShown] = useState<string | null>(null);
  if (active) return <ObjectiveView summary={active} state={state} history={history} tick={tick} cast={cast} onPerson={onPerson} whyFor={whyFor} onWhy={onWhy}/>;
  const pick = past.find(s => s.id === shown) ?? past[0];
  return <div className="objective-tab">
    <ObjectiveForm disabled={disabled} onSubmit={onSubmit}/>
    {past.length > 1 && <div className="company-tabs" role="group" aria-label="Earlier objectives">{past.map((s, i) => <button key={s.id} aria-pressed={s === pick} onClick={() => setShown(s.id)}>Objective {past.length - i}</button>)}</div>}
    {pick && <ObjectiveView summary={pick} state={state} history={history} tick={tick} cast={cast} onPerson={onPerson} whyFor={whyFor} onWhy={onWhy}/>}
  </div>;
}
