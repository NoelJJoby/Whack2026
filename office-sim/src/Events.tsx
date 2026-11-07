import { useState } from 'react';
import type { SimulationState, AgentProfile } from '../shared/types';
import { EventDetail, money } from './EventDetail';
import { timeLabel } from './hudModel';
export function Events({ state, cast, onPerson, selectedId }: { state: SimulationState | null; cast: AgentProfile[]; onPerson?: (id: string) => void; selectedId?: string | null }) {
  const [selected,setSelected] = useState<string | null>(null);
  const [showCompleted,setShowCompleted] = useState(false);
  if (!state?.business || !state.eventState) return <p>Business history will appear when the simulation connects.</p>;
  const b = state.business; const events = state.eventState;
  const current = events.cases.find(e => e.id === (selectedId ?? selected));
  return <section className="business-events" aria-label="Business events">
    <dl className="business-numbers">{[['Cash',b.cash],['Booked',b.bookings],['Earned revenue',b.revenue],['Receivables',b.receivables],['Costs',b.costs]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{money(Number(value),b.currency)}</dd></div>)}</dl>
    <p className="business-note">Five ticks are one active workday. Each active day includes two routine calendar days. Bookings become revenue through accepted delivery and cash through collection.</p>
    <label className="case-filter"><input type="checkbox" checked={showCompleted} onChange={e => setShowCompleted(e.target.checked)}/> Include completed cases</label>
    <div className="case-list">{[...events.cases].reverse().filter(e => showCompleted || !['resolved','cancelled','superseded'].includes(e.status)).map(e => <button key={e.id} className={`case-card ${e.valence}`} aria-expanded={current?.id === e.id} onClick={() => setSelected(current?.id === e.id ? null : e.id)}><span>{e.rarity} · {e.valence} · {e.status}</span><strong>{e.headline}</strong><small>{e.origin === 'injection' ? 'Scenario override · ' : ''}Owner: {cast.find(a => a.id === e.owner)?.name ?? e.owner ?? 'Emergency procedures'} · Due {timeLabel(e.deadline)}</small></button>)}</div>
    {!events.cases.length && <p className="empty-state">The company is working through its existing clients and pipeline. New common situations arrive every two to four active workdays.</p>}
    {current && <EventDetail event={current} events={events} business={b} cast={cast} onPerson={onPerson}/>}
    <details><summary>Current assignments and capacity</summary><p>{b.available.toFixed(1)} employee units available per tick · {b.used.toFixed(1)} used this tick</p>{b.tasks.filter(t => !['done','cancelled'].includes(t.status)).map(t => <p key={t.id}>{t.title} · {cast.find(a => a.id === t.owner)?.name ?? 'Unallocated'} · {t.status} · Priority {t.priority} · {t.remaining.toFixed(1)} work remaining</p>)}</details>
  </section>;
}
