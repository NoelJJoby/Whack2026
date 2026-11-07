import type { Business } from '../shared/business';
import type { BusinessEvent, EventState } from '../shared/events';
import type { AgentProfile } from '../shared/types';
import { timeLabel } from './hudModel';
export const money = (amount: number, currency = 'GBP') => new Intl.NumberFormat('en-GB',{ style: 'currency', currency, maximumFractionDigits: 0 }).format(amount/100);
export function EventDetail({ event, events, business, cast, onPerson }: { event: BusinessEvent; events: EventState; business: Business; cast: AgentProfile[]; onPerson?: (id: string) => void }) {
  const tasks = business.tasks.filter(t => event.tasks.includes(t.id));
  const contract = business.contracts.find(c => c.id === `contract-${event.id}`);
  const name = (id: string | null) => cast.find(a => a.id === id)?.name ?? id ?? 'Unallocated';
  return <article className="event-story" id={`story-${event.id}`}>
    <h3>{event.headline}</h3>
    <p className={event.valence === 'positive' ? 'mint' : 'coral'}>{event.valence === 'positive' ? 'Opportunity / success' : 'Problem / risk'} · {event.rarity} · {event.status}</p>
    <p>{event.origin === 'injection' ? 'Scenario override' : event.origin === 'employee' ? 'Employee outcome' : 'External development'} · Owner: {name(event.owner)} · Due {timeLabel(event.deadline)}</p>
    {contract && <div className="contract-position"><p>Contract signed: {money(contract.value,business.currency)} · {(contract.value/event.target*100).toFixed(1)}% of Sales’ Q{event.quarter} target</p><p>Frozen target: {money(event.target,business.currency)}</p><p>Earned: {money(contract.recognised,business.currency)} · Collected: {money(contract.collected,business.currency)}</p><p>Remaining contract value is a forecast until delivery passes acceptance.</p></div>}
    {event.domain === 'security' && <p>Exposure: {event.detected ? 'Detected' : 'Awaiting detection'} · {event.contained ? 'Contained' : 'Containment outstanding'} · Recovery: {event.status === 'resolved' ? 'Verified' : 'Outstanding'}</p>}
    <section><h4>Known evidence</h4>{events.evidence.filter(e => e.eventId === event.id).map(e => <p key={e.id}><time>{timeLabel(e.tick)}</time> {e.text} <small>{e.certainty}; source: {e.source}; delivered to {e.recipients.map(name).join(', ')}</small></p>)}</section>
    <section><h4>CEO decision</h4>{events.decisions.filter(d => d.choices.some(c => c.eventId === event.id)).map(d => <div key={d.id}><p>{timeLabel(d.tick)} · {d.fallback ? `Rules / fallback: ${d.fallback}` : 'AI decision'}</p><p>{d.rationale}</p>{d.choices.filter(c => c.eventId === event.id).map(c => <p key={c.optionId}>Plan: {c.optionId.split(':').slice(1).join(' ')}. Budget {money(c.budget,business.currency)}. Priority {c.priority}. Acceptance: {c.acceptance}</p>)}</div>)}{!event.decisions.length && <p>Awaiting management decision.</p>}</section>
    <section><h4>Ops assignments</h4>{tasks.map(t => <div className="story-task" key={t.id}><strong>{t.title}</strong><p>{onPerson && t.owner ? <button onClick={() => onPerson(t.owner!)}>{name(t.owner)}</button> : name(t.owner)} · {t.status} · Due {timeLabel(t.deadline)}</p><p>Progress {(t.effort-t.remaining).toFixed(1)} / {t.effort} · {t.reviewRequired ? t.reviewed ? 'Reviewed' : 'Review required' : 'Standard acceptance'}</p></div>)}</section>
    <section><h4>Employee work and reports</h4>{business.work.filter(r => tasks.some(t => t.id === r.taskId)).map(r => <p key={r.id}>{timeLabel(r.tick)} · {name(r.agent)}: {r.outcome}. Progress {r.progress.toFixed(1)}.</p>)}</section>
    <section><h4>Business outcome</h4><p>{event.outcome ?? 'Unresolved. Future benefits and obligations remain forecasts.'}</p><ol>{event.milestones.map((m,i) => <li key={i}>{timeLabel(m.tick)} · {m.text}</li>)}</ol>{business.ledger.filter(l => event.ledger.includes(l.id)).map(l => <p key={l.id}>{l.category}: {money(l.amount,business.currency)} · {timeLabel(l.tick)}</p>)}</section>
  </article>;
}
