import { useMemo, useState } from 'react';
import { Office, Sprite, lookFor, type Person } from './design/Office';
import './index.css';
import { BURNOUT_STRESS_THRESHOLD, BURNOUT_RECOVERY_THRESHOLD } from '../shared/stressThresholds';
import type { TickEvent, TickFrame } from '../shared/api';
import type { Action, EventType, TickRecord } from '../shared/types';
import { Controls } from './Controls';
import { EventComposer } from './EventComposer';
import { USE_MOCKS, useSimulation, type Simulation } from './useSimulation';

const ACTION_LABEL: Record<Action, string> = {
    work: 'Working', overwork: 'Overworking', slack_off: 'Slacking off', complain: 'Complaining',
    gossip: 'Spreading gossip', verify: 'Verifying rumour', interview: 'Interviewing', leak: 'Leaking to the press',
};
// Feed labels. Only OVERWORK, DOUBT, POLICY and EVENT have their own colour in index.css.
const FEED_TYPE: Record<Action, string> = {
    work: 'WORK', overwork: 'OVERWORK', slack_off: 'SLACK', complain: 'COMPLAINT',
    gossip: 'GOSSIP', verify: 'DOUBT', interview: 'INTERVIEW', leak: 'LEAK',
};
const EVENT_SHORT: Record<EventType, string> = {
    merger: 'MERGER', new_management: 'NEW VP', long_hours_policy: 'POLICY', pr_scandal: 'SCANDAL',
    layoffs_rumour: 'RUMOUR', surprise_bonus: 'BONUS', competitor_poaching: 'POACHING',
};
const TICKS_PER_DAY = 8;
const pad = (n: number) => String(n).padStart(2, '0');

function Bar({ value, label, inverse = false, threshold }: {
    value: number; label: string; inverse?: boolean; threshold?: number;
}) {
    const severity = inverse ? 100 - value : value;
    const fullLabel = ({ S: 'Stress', B: 'Burnout', T: 'Trust', W: 'Workload' } as Record<string, string>)[label] ?? label;
    return <div className="stat" title={`${fullLabel}: ${value}/100${threshold !== undefined ? ` · Burnout rises above ${threshold} stress` : ''}`}><span>{label}</span><div className="bar" role="meter" aria-label={fullLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><i style={{ width: `${value}%`, background: severity >= 70 ? 'var(--coral)' : severity >= 40 ? 'var(--gold)' : 'var(--mint)' }}/>{threshold !== undefined && <span className="threshold-marker" style={{ left: `${threshold}%` }} />}</div><b>{value}</b></div>;
}

function modeText(sim: Simulation): { label: string; tone: string } {
    if (sim.connection === 'mock') return { label: 'MOCK DATA', tone: '' };
    if (sim.connection === 'connecting') return { label: 'CONNECTING…', tone: '' };
    if (sim.connection === 'reconnecting') return { label: 'RECONNECTING…', tone: 'coral' };
    if (sim.mode === 'llm_bias') return { label: 'LLM + BIAS ENGINE', tone: '' };
    return { label: sim.modeReason === 'llm_failed' ? 'RULES MODE · LLM DOWN' : sim.modeReason === 'no_api_key' ? 'RULES MODE · NO API KEY' : 'RULES MODE', tone: 'gold' };
}

/** Step-line SVG path in the design's 700 x 90 chart box. */
function stepPath(values: number[], max: number): string {
    if (values.length === 0) return '';
    const w = 700 / values.length;
    const y = (v: number) => Math.round(85 - (Math.min(v, max) / (max || 1)) * 80);
    return values.map((v, i) => (i === 0 ? `M0 ${y(v)}H${Math.round(w)}` : `V${y(v)}H${Math.round((i + 1) * w)}`)).join('');
}

function averages(frame: TickFrame) {
    const active = Object.values(frame.state.agents).filter(a => a.status === 'active');
    const avg = (k: 'stress' | 'trust_mgmt' | 'burnout') => active.length ? Math.round(active.reduce((n, a) => n + a[k], 0) / active.length) : 0;
    return { stress: avg('stress'), trust: avg('trust_mgmt'), burnout: avg('burnout') };
}

export default function App() {
    const sim = useSimulation();
    const { state, history, cast, maxTicks } = sim;
    const [selected, setSelected] = useState<string | null>(null);
    const [highlight, setHighlight] = useState<string[]>([]);
    const [truth, setTruth] = useState(false);
    const [chart, setChart] = useState('wellbeing');
    const [inspect, setInspect] = useState(false);

    const latest = useMemo(() => {
        const byAgent: Record<string, TickRecord> = {};
        for (const frame of history) for (const r of frame.records) byAgent[r.agent] = r;
        return byAgent;
    }, [history]);

    const people: Person[] = useMemo(() => cast.map((profile, i) => {
        const s = state?.agents[profile.id];
        const rec = latest[profile.id];
        const quit = s?.status === 'quit';
        return {
            ...lookFor(profile.archetype, i),
            id: profile.id, name: profile.name, role: profile.archetype,
            stress: Math.round(s?.stress ?? 0), workload: Math.round(s?.workload ?? 0),
            burnout: Math.round(s?.burnout ?? 0), trust: Math.round(s?.trust_mgmt ?? 0),
            action: quit ? 'Resigned' : rec ? ACTION_LABEL[rec.action] : 'Waiting',
            says: rec?.public_line ?? '', thinks: rec?.inner_monologue ?? '', quit,
        };
    }), [cast, state, latest]);
    const byId = useMemo(() => Object.fromEntries(people.map(p => [p.id, p])), [people]);
    const nameOf = (id: string) => byId[id]?.name ?? id;

    const allEvents = useMemo(() => history.flatMap(f => f.events.map(e => ({ ...e, tick: f.tick }))), [history]);
    const latestEvent: (TickEvent & { tick: number }) | undefined = allEvents.at(-1);
    const tick = state?.tick ?? 0;
    const complete = tick >= maxTicks;
    const active = people.filter(p => !p.quit).length;
    const quitters = (state?.metrics.crack_order ?? []).map(id => byId[id]).filter((p): p is Person => Boolean(p));
    const firstQuit = state?.metrics.first_quit_tick ?? null;
    const recordCount = history.reduce((n, f) => n + f.records.length + f.events.length, 0);
    const mode = modeText(sim);
    const live = sim.connection === 'live';

    const series = history.map(averages);
    const now = series.at(-1);
    const prev = series.at(-2);
    const trueReach = history.map(f => f.state.metrics.true_reach);
    const falseReach = history.map(f => f.state.metrics.false_reach);
    const reachMax = Math.max(1, ...trueReach, ...falseReach);

    const person = people.find(p => p.id === selected) ?? people[0];
    function select(id: string) { setSelected(id); setInspect(true); }

    const statusLine = sim.error ? <span className="coral">{sim.error}</span>
        : quitters.length ? `${quitters.length === 1 ? 'One empty desk' : `${quitters.length} empty desks`}. A very loud silence.`
        : complete ? 'The workday is over. Reset to run it again.'
        : `${people.length ? `${people.length} minds` : 'Eight minds'}. One very long workday.`;

    return <main className="app-shell">
    <header className="topbar"><a className="brand" href="#" aria-label="Agentic Chaos home"><span className="brand-icon">▥</span><span>AGENTIC<span className="brand-sim">CHAOS</span><small>A SMALL WORLD. A CORPORATE EXPERIMENT.</small></span></a><div className="run-meta"><span className={`demo-pill ${mode.tone}`}><i /> {mode.label}</span><span>TICK <b>{pad(tick)}</b><em>/ {maxTicks}</em></span><span className="time">DAY {pad(Math.floor(tick / TICKS_PER_DAY) + 1)} <b>{pad(9 + (tick % TICKS_PER_DAY))}:00</b></span></div><div className="team-count"><span>♟</span><b>{active}</b> / {people.length} on payroll</div></header>
    <section className="event-bar billboard" aria-label="Company billboard"><span className="event-icon">!</span><div className="billboard-copy"><small>ON THE BILLBOARD · {latestEvent ? `TICK ${pad(latestEvent.tick)}` : 'NOTHING POSTED YET'}</small><strong>{latestEvent?.text ?? 'Business as usual. For now.'}</strong>{truth && latestEvent && <span className={latestEvent.is_true ? "billboard-truth mint" : "billboard-truth coral"}>{latestEvent.is_true ? "TRUE EVENT" : "FALSE RUMOUR"}</span>}</div><label className="truth-toggle"><input type="checkbox" checked={truth} onChange={e => setTruth(e.target.checked)}/><span />Reveal truth</label></section>
    <div className="workspace"><section className="office-panel"><div className="section-heading"><h1>The daily grind<span>OFFICE CROSS-SECTION</span></h1><span className="weather">☀ {pad(9 + (tick % TICKS_PER_DAY))}:00 · CLEAR SKIES, LOW MORALE</span></div><Office people={people} selected={selected} onSelect={select} highlight={highlight}/><div className="office-footer"><span><i className="live-dot"/> {statusLine}</span><Controls running={state?.running} started={state?.started} complete={complete} disabled={!live || sim.busy} onStart={() => void sim.start()} onPlayPause={() => void sim.togglePlay()} onStep={() => void sim.step()} onReset={() => void sim.reset()}/></div></section>
    <aside className="sidebar"><section className="panel feed-panel"><div className="panel-heading"><h2><span>≡</span> Office wire</h2><span className="badge">{recordCount} UPDATES</span></div><div className="feed-scroll" tabIndex={0} aria-label="Office activity feed">
      {(state?.queue ?? []).map((type, i) => <article className="feed-item posted-event" key={`queued-${i}`}><span className="feed-tick">↗</span><div><small>BILLBOARD · QUEUED FOR TICK {pad(tick + 1)}</small><p>{EVENT_SHORT[type]}</p></div></article>)}
      {[...history].reverse().map(frame => <FeedFrame key={frame.tick} frame={frame} truth={truth} nameOf={nameOf} onHighlight={setHighlight} onSelect={select}/>)}
      {history.length === 0 && <div className="no-quits"><span className="empty-flag">≡</span><div><strong>{sim.connection === 'connecting' ? 'Connecting to the office…' : 'Quiet. For now.'}</strong><p>{sim.connection === 'connecting' ? 'Waiting for the simulation server.' : 'Press Start and the first rumours will appear here.'}</p></div></div>}
    </div><div className="feed-footer">Every little action leaves a trace.</div></section><section className="panel cracks"><div className="panel-heading"><h2><span>⚑</span> Who cracks first?</h2></div>{quitters.length ? quitters.map((p, i) => <div className="quit-entry" key={p.id}><span className="rank">{pad(i + 1)}</span><Sprite person={p} small quit/><div><strong>{p.name}</strong><small>{p.role} · LEFT AT TICK {pad(state?.agents[p.id]?.quit_tick ?? 0)}</small></div><span className="quit-mark">OUT</span></div>) : <div className="no-quits"><span className="empty-flag">⚑</span><div><strong>No resignations. Yet.</strong><p>Everyone has a breaking point.</p></div></div>}<div className="crack-footer"><span>FIRST RESIGNATION</span><b>{firstQuit !== null ? `TICK ${pad(firstQuit)}` : '—'}</b></div></section></aside></div>
    <EventComposer onInject={sim.inject} label={USE_MOCKS ? 'MOCK DATA' : live ? 'LIVE' : 'OFFLINE'} error={sim.error} disabled={!live || complete} nextTick={tick + 1} />
    <section className="roster"><div className="roster-heading"><h2>The people <span>BEHIND THE PRODUCTIVITY</span></h2><span>STRESS / BURNOUT / TRUST / WORKLOAD</span></div><p className="roster-rule">High workload builds stress. Above {BURNOUT_STRESS_THRESHOLD} stress, burnout accumulates each tick. Below {BURNOUT_RECOVERY_THRESHOLD}, it slowly recovers.</p><div className="agent-grid">{people.map(p => <button key={p.id} className={`agent-mini ${selected === p.id ? 'active' : ''} ${p.quit ? 'has-quit' : ''}`} onClick={() => select(p.id)}><div className="agent-identity"><div className="portrait" style={{ borderColor: p.color }}><Sprite person={p} small quit={p.quit}/></div><div><strong>{p.name}</strong><small>{p.role}</small></div><span className="status-dot" style={{ background: p.stress >= 75 ? 'var(--coral)' : 'var(--mint)' }}/></div><Bar value={p.stress} label="S" threshold={BURNOUT_STRESS_THRESHOLD}/><Bar value={p.burnout} label="B"/><Bar value={p.trust} label="T" inverse/><Bar value={p.workload} label="W"/>{p.stress > BURNOUT_STRESS_THRESHOLD && !p.quit && <span className="burnout-warning">↑ Burnout risk</span>}<span className="agent-action">{p.quit ? '↗ Resigned' : p.action}</span></button>)}</div></section>
    <section className="panel pulse"><div className="pulse-summary"><small>THE COMPANY PULSE</small><strong>{chart === 'wellbeing' ? (!now ? 'Waiting for the workday.' : prev && now.stress < prev.stress ? 'Things are easing off.' : 'Pressure is building.') : ((falseReach.at(-1) ?? 0) > 0 ? 'Whispers travel fast.' : 'No rumours. Yet.')}</strong><div className="chart-tabs"><button className={chart === 'wellbeing' ? 'chosen' : ''} onClick={() => setChart('wellbeing')}>Wellbeing</button><button className={chart === 'claims' ? 'chosen' : ''} onClick={() => setChart('claims')}>Rumour reach</button></div></div><div className="chart-area"><div className="chart-key">{chart === 'wellbeing' ? <><span className="coral">■ Stress {now?.stress ?? '—'}</span><span className="mint">■ Trust {now?.trust ?? '—'}</span><span className="gold">■ Burnout {now?.burnout ?? '—'}</span></> : <><span className="mint">■ True claims {trueReach.at(-1) ?? '—'}</span><span className="coral">■ False claims {falseReach.at(-1) ?? '—'}</span></>}</div><svg viewBox="0 0 700 90" preserveAspectRatio="none" role="img" aria-label={chart === 'wellbeing' ? `Average stress, trust and burnout over ${history.length} ticks.` : `True and false claim reach over ${history.length} ticks.`}><path d="M0 15H700M0 45H700M0 75H700" stroke="#334340" strokeDasharray="3 6" fill="none"/>{chart === 'wellbeing' ? <><path d={stepPath(series.map(s => s.stress), 100)} stroke="#e8947f"/><path d={stepPath(series.map(s => s.trust), 100)} stroke="#8abca2"/><path d={stepPath(series.map(s => s.burnout), 100)} stroke="#d7b66c"/></> : <><path d={stepPath(trueReach, reachMax)} stroke="#8abca2"/><path d={stepPath(falseReach, reachMax)} stroke="#e8947f"/></>}</svg><div className="chart-axis">{history.map(f => <span key={f.tick}>{pad(f.tick)}{f.events[0] ? ` · ${EVENT_SHORT[f.events[0].type]}` : ''}</span>)}</div></div></section>
    <footer className="page-footer"><span>AGENTIC CHAOS <b> / </b> PEOPLE ARE NOT SPREADSHEETS.</span><span>{USE_MOCKS ? 'MOCK DATA · DEV FLAG' : `LIVE SIMULATION · SEED ${state?.seed ?? '—'}`} <b> / </b> <span className="integration-slot">{mode.label}</span></span></footer>
    {inspect && person && <div className="modal-backdrop" onClick={() => setInspect(false)}><section className="inspector panel" role="dialog" aria-modal="true" aria-labelledby="inspector-name" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape')
        setInspect(false); if (e.key === 'Tab')
        e.preventDefault(); }}><button className="close" autoFocus onClick={() => setInspect(false)} aria-label="Close employee details">✕</button><div className="inspector-person"><div className="portrait"><Sprite person={person} quit={person.quit}/></div><div><small>EMPLOYEE FILE / {person.id.toUpperCase()}</small><h2 id="inspector-name">{person.name}</h2><p>{person.role} · {person.action}</p></div></div><div className="dialogue-grid"><div><small>▰ WHAT THEY SAY</small><blockquote>“{person.says || '…'}”</blockquote></div><div className="inner-voice"><small>☁ WHAT THEY THINK</small><blockquote>“{person.thinks || '…'}”</blockquote></div></div><Bar label="Stress" value={person.stress} threshold={BURNOUT_STRESS_THRESHOLD}/><Bar label="Burnout" value={person.burnout}/><Bar label="Trust" value={person.trust} inverse/><Bar label="Workload" value={person.workload}/><p className="burnout-rule">{person.stress > BURNOUT_STRESS_THRESHOLD ? "High stress: burnout accumulates each simulation tick." : "Stress is below the burnout accumulation threshold."} Burnout rises above {BURNOUT_STRESS_THRESHOLD}/100 stress and recovers below {BURNOUT_RECOVERY_THRESHOLD}/100.</p><p className="inspector-note">A public face. A private breaking point.</p></section></div>}
  </main>;
}

/** One tick in the feed, newest line first: resignations, actions, then the event that opened the tick. */
function FeedFrame({ frame, truth, nameOf, onHighlight, onSelect }: {
    frame: TickFrame; truth: boolean; nameOf: (id: string) => string;
    onHighlight: (ids: string[]) => void; onSelect: (id: string) => void;
}) {
    const t = pad(frame.tick);
    const ids = (r: TickRecord) => (r.target ? [r.agent, r.target] : [r.agent]);
    return <>
      {frame.records.filter(r => r.quit).map(r => <article className="feed-item quit-feed" key={`quit-${r.agent}`}><span className="feed-tick">{t}</span><div><small>RESIGNATION</small><p>{r.summary}</p><span className="feed-tag">{nameOf(r.agent)} has left the company</span></div></article>)}
      {[...frame.records].reverse().filter(r => !r.quit).map(r => <button className="feed-item" key={r.agent} onMouseEnter={() => onHighlight(ids(r))} onMouseLeave={() => onHighlight([])} onFocus={() => onHighlight(ids(r))} onBlur={() => onHighlight([])} onClick={() => onSelect(r.agent)}><span className="feed-tick">{t}</span><div><small className={`type-${FEED_TYPE[r.action].toLowerCase()}`}>{FEED_TYPE[r.action]}</small><p>{r.summary}</p></div></button>)}
      {frame.events.map((e, i) => <article className="feed-item" key={`event-${i}`}><span className="feed-tick">{t}</span><div><small className={e.type === 'long_hours_policy' ? 'type-policy' : 'type-event'}>{e.type === 'long_hours_policy' ? 'POLICY' : 'EVENT'}{truth && <b className={e.is_true ? 'mint' : 'coral'}> {e.is_true ? 'TRUE' : 'FALSE'}</b>}</small><p>{e.text}</p></div></article>)}
    </>;
}
