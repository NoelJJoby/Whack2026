import { useState } from 'react';
import type { TickFrame } from '../shared/api';
import type { CompanyTaskSummary } from '../shared/companyTasks';
import type { AgentProfile, SimulationState } from '../shared/types';
import { BusinessReport } from './BusinessReport';
import { Events } from './Events';
import { money } from './EventDetail';
import { ObjectivePanel } from './ObjectivePanel';
import { isActiveObjective, isObjectiveWork, isOpenSituation, shortTitle } from './companyModel';
import { WhyButton, type WhyProps } from './Inbox';
import './business.css';

export type Tab = 'objective' | 'situations' | 'staff' | 'report';

function Staff({ state, cast, onPerson, whyFor, onWhy }: WhyProps & { state: SimulationState | null; cast: AgentProfile[]; onPerson: (id: string) => void }) {
  const b = state?.business;
  if (!b) return <p className="empty-state">Finances appear when the simulation connects.</p>;
  const people = Object.values(b.positions).filter(p => p.role === 'employee' && state.agents[p.id]?.status === 'active');
  const busy = people.filter(p => b.tasks.some(t => t.owner === p.id && ['active', 'review'].includes(t.status))).length;
  return <div className="staff-tab">
    <dl className="business-numbers">{([['Cash in the bank', b.cash], ['Deals signed', b.bookings], ['Revenue earned', b.revenue], ['Owed to us', b.receivables], ['Costs so far', b.costs]] as const)
      .map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{money(value, b.currency)}</dd></div>)}</dl>
    <h4>Who's working on what <small>{busy} of {people.length} busy</small></h4>
    <ul className="staff-list">{people.map(p => {
      const work = b.tasks.filter(t => t.owner === p.id && ['active', 'review', 'paused', 'blocked'].includes(t.status));
      return <li key={p.id}>
        <button className="link" onClick={() => onPerson(p.id)}>{cast.find(a => a.id === p.id)?.name ?? p.id}</button> <small>{p.department}</small>
        {work.length ? <ul>{work.map(t => <li key={t.id} className={t.status}>
          {isObjectiveWork(t.id) && <span className="chip gold">Objective</span>}{shortTitle(t.title).split(':')[0]}
          <small> · {t.status === 'active' ? 'working' : t.status === 'review' ? 'in review' : t.status === 'paused' ? 'on hold' : 'blocked'}</small><WhyButton taskId={t.id} whyFor={whyFor} onWhy={onWhy}/>
        </li>)}</ul> : <p className="muted">Free</p>}
      </li>;
    })}</ul>
  </div>;
}

/** The Business panel: the CEO's objective, business situations, money and staff, and the run report. */
export function BusinessPage({ state, history, tick, cast, onPerson, initialCase, initialTab, companyTasks, onSubmitObjective, objectiveDisabled, runId, reportStatus, whyFor, onWhy }: WhyProps & {
  initialTab?: Tab;
  state: SimulationState | null; history: TickFrame[]; tick: number; cast: AgentProfile[]; onPerson: (id: string) => void;
  initialCase: string | null; companyTasks: CompanyTaskSummary[]; onSubmitObjective: (objective: string, deadline: number) => Promise<string | null>;
  objectiveDisabled: boolean; runId?: string; reportStatus?: string;
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? (initialCase ? 'situations' : 'objective'));
  const active = companyTasks.find(s => isActiveObjective(s.status));
  const open = (state?.eventState?.cases ?? []).filter(isOpenSituation).length;
  const tabs: Array<[Tab, string]> = [['objective', active ? 'Objective ●' : 'Objective'], ['situations', open ? `Situations (${open})` : 'Situations'], ['staff', 'Finances & staff'], ['report', 'Report']];
  return <div className="business-page">
    <div className="event-panel-tabs" role="tablist" aria-label="Business">{tabs.map(([id, label]) =>
      <button key={id} role="tab" aria-selected={tab === id} className={`event-panel-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>)}</div>
    <div role="tabpanel">
      {tab === 'objective' && <ObjectivePanel summaries={companyTasks} state={state} history={history} tick={tick} cast={cast} disabled={objectiveDisabled} onPerson={onPerson} onSubmit={onSubmitObjective} whyFor={whyFor} onWhy={onWhy}/>}
      {tab === 'situations' && <Events state={state} cast={cast} onPerson={onPerson} initialId={initialCase} tick={tick} whyFor={whyFor} onWhy={onWhy}/>}
      {tab === 'staff' && <Staff state={state} cast={cast} onPerson={onPerson} whyFor={whyFor} onWhy={onWhy}/>}
      {tab === 'report' && <BusinessReport runId={runId} tick={tick} status={reportStatus} cast={cast}/>}
    </div>
  </div>;
}
