import type { Business, LedgerEntry } from '../shared/business';
import type { BusinessEvent, EventState } from '../shared/events';
import type { AgentProfile } from '../shared/types';
import { SITUATION_STATUS, dueIn, planLabel, shortTitle } from './companyModel';
import { timeLabel } from './hudModel';
import { WhyButton, type WhyProps } from './Inbox';

export const money = (amount: number, currency = 'GBP') => new Intl.NumberFormat('en-GB',{ style: 'currency', currency, maximumFractionDigits: 0 }).format(amount/100);

const LEDGER_LABEL: Record<LedgerEntry['category'], string> = {
  booking: 'Deal signed', revenue: 'Revenue earned', collection: 'Cash collected', payroll: 'Payroll',
  infrastructure: 'Infrastructure cost', response: 'Cost of the response', saving: 'Saving',
};
const SOURCE: Record<BusinessEvent['origin'], string> = {
  external: 'From outside the company', employee: 'Reported by an employee', management: 'Raised by management', injection: 'Added by you',
};

/** One business situation, told in order: what happened, what the CEO decided, who is on it, how it ended. */
export function EventDetail({ event, events, business, cast, onPerson, tick, whyFor, onWhy }: WhyProps & { event: BusinessEvent; events: EventState; business: Business; cast: AgentProfile[]; onPerson?: (id: string) => void; tick?: number }) {
  const tasks = business.tasks.filter(t => event.tasks.includes(t.id));
  const contract = business.contracts.find(c => c.id === `contract-${event.id}`);
  const name = (id: string | null) => cast.find(a => a.id === id)?.name ?? id ?? 'no one yet';
  const person = (id: string | null) => onPerson && id ? <button className="link" onClick={() => onPerson(id)}>{name(id)}</button> : name(id);
  const evidence = events.evidence.filter(e => e.eventId === event.id);
  const decisions = events.decisions.filter(d => d.choices.some(c => c.eventId === event.id));
  const ledger = business.ledger.filter(l => event.ledger.includes(l.id));
  const status = SITUATION_STATUS[event.status];
  const open = ['open', 'responding', 'monitoring'].includes(event.status);
  return <article className="event-story" id={`story-${event.id}`}>
    <p className="story-status"><span className={`chip ${status.tone}`}>{status.text}</span> {open ? `Due ${timeLabel(event.deadline)}${tick !== undefined ? ` · ${dueIn(event.deadline, tick)}` : ''}` : ''}</p>
    <section><h4>What happened</h4>
      <p>{evidence[0]?.text ?? event.headline}</p>
      <small>{SOURCE[event.origin]}{evidence[0] ? ` · ${evidence[0].certainty === 'observed' ? 'confirmed' : evidence[0].certainty}` : ''} · {timeLabel(event.openedTick)}</small>
      {event.domain === 'security' && <p>{event.detected ? 'Detected' : 'Not yet detected'} · {event.contained ? 'contained' : 'not contained yet'}</p>}
    </section>
    <section><h4>What the CEO decided</h4>
      {decisions.length ? decisions.map(d => d.choices.filter(c => c.eventId === event.id).map(c => <div className="story-decision" key={`${d.id}-${c.optionId}`}>
        <p><strong>{planLabel(c.optionId, id => name(id))}</strong>{c.budget > 0 && ` · budget ${money(c.budget, business.currency)}`} <small>{timeLabel(d.tick)}{d.fallback ? ' · rule-based' : ''}</small></p>
        {d.rationale && <blockquote>{d.rationale}</blockquote>}
        {c.communicate.length > 0 && <small>Told {c.communicate.map(id => id === 'public' ? 'the public' : name(id)).join(', ')}</small>}
      </div>)) : <p>No decision yet.</p>}
    </section>
    {tasks.length > 0 && <section><h4>Who's working on it</h4>{tasks.map(t => <div className="story-task" key={t.id}>
      <p><strong>{shortTitle(t.title).split(':')[0]}</strong> · {person(t.owner)}</p>
      <div className="objective-bar" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(1, 1 - t.remaining / t.effort)) * 100}%` }}/></div>
      <small>{t.status === 'done' ? 'Done' : t.status === 'review' ? 'In review' : t.status === 'active' ? 'In progress' : t.status === 'blocked' ? 'Blocked' : t.status === 'paused' ? 'On hold' : 'Not started'} · due {timeLabel(t.deadline)}{t.reviewRequired ? ` · ${t.reviewed ? 'reviewed' : 'needs review'}` : ''}<WhyButton taskId={t.id} whyFor={whyFor} onWhy={onWhy}/></small>
    </div>)}</section>}
    {contract && <section><h4>The contract</h4><p>Worth {money(contract.value, business.currency)} · earned {money(contract.recognised, business.currency)} · collected {money(contract.collected, business.currency)}</p></section>}
    <section><h4>Result</h4>
      <p>{event.outcome ?? 'Still open.'}</p>
      {ledger.length > 0 && <dl className="story-money">{ledger.map(l => <div key={l.id}><dt>{LEDGER_LABEL[l.category]}</dt><dd>{money(l.amount, business.currency)}</dd></div>)}</dl>}
    </section>
    {(event.milestones.length > 0 || evidence.length > 1) && <details><summary>Full timeline</summary><ol>
      {[...event.milestones.map(m => ({ tick: m.tick, text: m.text })), ...evidence.slice(1).map(e => ({ tick: e.tick, text: `${e.text} (${e.source})` }))]
        .sort((a, b) => a.tick - b.tick).map((m, i) => <li key={i}><time>{timeLabel(m.tick)}</time> {m.text}</li>)}
    </ol></details>}
  </article>;
}
