import { useState } from 'react';
import type { SimulationState, AgentProfile } from '../shared/types';
import { EventDetail } from './EventDetail';
import { SITUATION_STATUS, dueIn, isOpenSituation } from './companyModel';
import { timeLabel } from './hudModel';

type Filter = 'open' | 'closed' | 'all';

/** Business situations (cases) in plain language: what happened, what the CEO did, who is on it. */
export function Events({ state, cast, onPerson, initialId = null, tick }: { state: SimulationState | null; cast: AgentProfile[]; onPerson?: (id: string) => void; initialId?: string | null; tick: number }) {
  const cases = state?.eventState?.cases ?? [];
  const initial = cases.find(e => e.id === initialId);
  const [selected, setSelected] = useState<string | null>(initialId);
  const [filter, setFilter] = useState<Filter>(initial && !isOpenSituation(initial) ? 'all' : 'open');
  if (!state?.business || !state.eventState) return <p className="empty-state">Situations appear when the simulation connects.</p>;
  const b = state.business; const events = state.eventState;
  const name = (id: string | null) => cast.find(a => a.id === id)?.name ?? null;
  const open = cases.filter(isOpenSituation);
  const failed = cases.filter(e => e.status === 'failed');
  const shown = [...cases].reverse().filter(e => filter === 'all' || (filter === 'open') === isOpenSituation(e));
  return <section className="business-events" aria-label="Business situations">
    <p className="situation-summary"><b>{open.length}</b> open · <b className="mint">{cases.filter(e => e.status === 'resolved').length}</b> resolved · <b className={failed.length ? 'coral' : ''}>{failed.length}</b> missed</p>
    <div className="company-tabs" role="group" aria-label="Show situations">
      {(['open', 'closed', 'all'] as Filter[]).map(f => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'open' ? 'Open' : f === 'closed' ? 'Closed' : 'All'}</button>)}
    </div>
    <div className="case-list">{shown.map(e => {
      const status = SITUATION_STATUS[e.status];
      const handlers = [...new Set(b.tasks.filter(t => e.tasks.includes(t.id) && t.owner).map(t => name(t.owner)).filter(Boolean))];
      return <div key={e.id} className="case-item">
        <button className={`case-card ${e.valence}`} aria-expanded={selected === e.id} onClick={() => setSelected(selected === e.id ? null : e.id)}>
          <span><b className={e.valence === 'positive' ? 'mint' : 'coral'}>{e.valence === 'positive' ? 'Good news' : 'Problem'}</b> · <span className={`chip ${status.tone}`}>{status.text}</span>
            {' · '}{isOpenSituation(e) ? dueIn(e.deadline, tick) : `ended ${timeLabel(e.milestones.at(-1)?.tick ?? e.deadline)}`}</span>
          <strong>{e.headline}</strong>
          {handlers.length > 0 && <small>Handled by {handlers.join(', ')}</small>}
        </button>
        {selected === e.id && <EventDetail event={e} events={events} business={b} cast={cast} onPerson={onPerson} tick={tick}/>}
      </div>;
    })}</div>
    {!shown.length && <p className="empty-state">{filter === 'open' ? 'Nothing needs attention right now.' : 'No situations yet.'}</p>}
  </section>;
}
