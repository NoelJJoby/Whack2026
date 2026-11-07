import { Events } from './Events';
import { BusinessReport } from './BusinessReport';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Office, lookFor, type Person } from './design/Office';
import { Workday } from './Workday';
import { Controls } from './Controls';
import { EventComposer, presets } from './EventComposer';
import { Company } from './Company';
import { StockPrice, StockChart } from './StockPrice';
import { EmployeePanel, MenuPanel } from './GamePanel';
import { ACTION_LABEL, feedEntries, playerText, timeLabel, type FeedEntry } from './hudModel';
import { quitParams } from '../server/params';
import { RUN_LENGTHS, useSimulation } from './useSimulation';
import { useDialogue } from './useDialogue';
import { DialogueBar, type Speaker } from './DialogueBar';
import './index.css';

type Tool = 'simulation' | 'shake' | 'rumours' | 'company';
type Menu = Tool | 'stock' | 'events';
const MENU_LABEL: Record<Menu, string> = { events: 'Business events', shake: 'Shake office', company: 'Wellbeing', rumours: 'Rumour reach', simulation: 'Simulation', stock: 'CHAOS stock' };

function ToolIcon({ tool }: { tool: Tool }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {tool === 'simulation' ? <path fill="currentColor" d="M6 7h12v2H6zm0 4h12v2H6zm0 4h12v2H6z"/>
      : tool === 'shake' ? <path fill="currentColor" d="M6 3h2v18H6zm2 1c4-3 6 4 12 1v11c-6 3-8-4-12-1z"/>
      : tool === 'rumours' ? <path d="M5 14c0-8 5-8 7-1s6 6 7-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      : <g fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M7 13a5 5 0 0 0 10 0"/><path d="M9 7v3m6-3v3"/></g>}
  </svg>;
}
export default function App() {
  const sim = useSimulation();
  const { state, history, cast } = sim;
  const [selected, setSelected] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [truth, setTruth] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const latest = useMemo(() => {
    const records: Record<string, (typeof history)[number]['records'][number]> = {};
    for (const frame of history) for (const record of frame.records) records[record.agent] = record;
    return records;
  }, [history]);
  const people: Person[] = useMemo(() => cast.map((profile, index) => {
    const s = state?.agents[profile.id];
    const record = latest[profile.id];
    return { ...lookFor(profile.archetype, index), id: profile.id, name: profile.name, role: profile.archetype,
      stress: (s?.stress ?? 0), workload: (s?.workload ?? 0), burnout: (s?.burnout ?? 0), trust: (s?.trust_mgmt ?? 0),
      action: s?.status === 'laid_off' ? 'Laid off' : s?.status === 'quit' ? 'Resigned' : record ? ACTION_LABEL[record.action] : 'Waiting',
      says: record?.public_line ?? '', thinks: record?.inner_monologue ?? '', quit: s?.status === 'quit' || s?.status === 'laid_off',
    };
  }), [cast, latest, state]);
  const entries = useMemo(() => feedEntries(history), [history]);
  const queued: FeedEntry[] = (state?.queue ?? []).map((type, index) => ({
    key: `queued-${index}`, label: 'Queued', time: timeLabel((state?.tick ?? 0) + 1),
    text: state?.queue_text?.[index] ?? presets.find(p => p.type === type)?.title ?? type, ids: [],
  })).reverse();
  const wireEntries = [...queued, ...entries];
  const person = people.find(p => p.id === selected);
  const hour = state?.tick ?? 0;
  const complete = hour >= sim.maxTicks;
  const live = sim.connection === 'live';
  const disabled = !live || sim.busy;
  const running = state?.running ?? false;
  const dialogue = useDialogue({
    history, paused: menu !== null,
    // Not gated on `busy`: the first hour can arrive while the Start request is still in flight.
    setPlaying: play => {
      if (!live || complete || !state?.started || play === running) return false;
      void sim.togglePlay();
      return true;
    },
    onSpace: () => toggle(),
  });
  function toggle() {
    if (disabled || complete) return;
    dialogue.releaseHold();
    void (state?.started ? sim.togglePlay() : sim.start());
  }
  const speaking = dialogue.line?.agent ?? null;
  const speaker: Speaker | null = useMemo(() => {
    if (!speaking) return null;
    const profile = cast.find(p => p.id === speaking);
    const look = people.find(p => p.id === speaking)
      ?? lookFor('', [...speaking].reduce((sum, c) => sum + c.charCodeAt(0), 0));
    return { name: profile?.name ?? speaking, team: profile?.functionGroup ?? '', look };
  }, [speaking, cast, people]);
  const select = (id: string) => {
    returnFocus.current = document.querySelector<HTMLButtonElement>(`[data-employee="${CSS.escape(id)}"]`);
    setMenu(null); setSelected(id); setHighlight([]);
  };
  const closeEmployee = useCallback(() => { setSelected(null); returnFocus.current?.focus(); }, []);
  function openMenu(next: Menu) { setSelected(null); setHighlight([]); setMenu(next); }
  const connectionText = sim.connection === 'reconnecting' ? 'Connection lost' : sim.connection === 'connecting' ? 'Connecting…' : sim.connection === 'mock' ? 'Preview' : null;
  const diagnostic = sim.mode === 'llm_bias' ? 'LLM + bias engine' : sim.modeReason === 'no_api_key' ? 'Rules mode · No API key' : sim.modeReason === 'llm_failed' ? 'Rules mode · LLM unavailable' : 'Rules mode';
  return <main className="game-window" aria-label="The Daily Grind">
    <Office people={people} selected={selected} onSelect={select} highlight={highlight} speaking={menu === null ? speaking : null}/>
    <StockPrice history={history} current={sim.price} initialPrice={sim.initialPrice} expanded={menu === 'stock'} onOpen={() => openMenu('stock')}/>
    <Workday tick={hour} speed={sim.speed} running={state?.running ?? false} started={state?.started ?? false} complete={complete} disabled={disabled} onSpeed={value => void sim.setSpeed(value)} onToggle={toggle}/>
    {connectionText && <div className={`connection-status ${sim.connection === 'reconnecting' ? 'coral' : ''}`} role="status">{connectionText}</div>}
    {sim.phase && <div className="management-phase" role="status">{sim.phase}…</div>}
    {sim.storageError && <div className="storage-error" role="alert">{sim.storageError}</div>}
    {sim.announcement && <section className="announcement" aria-label="New announcement"><div role="status"><span>Announcement</span><p>{playerText(sim.announcement.event.text)}</p></div><button className="close" onClick={sim.dismissAnnouncement} aria-label="Dismiss announcement">×</button></section>}
    <aside className={`office-wire ${expanded ? 'expanded' : ''}`} aria-label="Office wire">
      <div className="wire-heading"><h2>Office wire</h2><button onClick={() => openMenu('events')}>Business events</button><button aria-label={expanded ? 'Collapse Office wire history' : 'Expand Office wire history'} aria-expanded={expanded} aria-controls="wire-history" onClick={() => { setExpanded(!expanded); setHighlight([]); }}>{expanded ? 'Collapse' : 'History'}<span aria-hidden="true">{expanded ? ' −' : ' +'}</span></button></div>
      {(complete || sim.reportStatus === 'pending') && <button className="report-entry" onClick={() => openMenu('events')}>Business report · {sim.reportStatus === 'pending' ? 'Preparing…' : sim.reportStatus === 'factual_fallback' ? 'Factual report ready' : 'View report'}</button>}
      <div className="wire-history" id="wire-history" tabIndex={expanded ? 0 : undefined} onKeyDown={event => { if (event.key === 'Escape' && expanded) { setExpanded(false); event.currentTarget.parentElement?.querySelector('button')?.focus(); } }}>
        {(expanded ? wireEntries : wireEntries.slice(0, 2)).map(entry => {
          const content = <><div className="feed-meta"><span className={entry.label === 'Resignation' ? 'coral' : ''}>{entry.label}{truth && entry.truth !== undefined && <b className={entry.truth ? 'mint' : 'coral'}> · {entry.truth ? 'True' : 'False'}</b>}</span><time>{entry.time}</time></div><p>{entry.text}</p></>;
          return entry.ids.length ? <button className="feed-entry" key={entry.key} onMouseEnter={() => setHighlight(entry.ids)} onMouseLeave={() => setHighlight([])} onFocus={() => setHighlight(entry.ids)} onBlur={() => setHighlight([])} onClick={() => select(entry.ids[0])}>{content}</button> : <article className="feed-entry" key={entry.key}>{content}</article>;
        })}
        {!entries.length && !state?.queue.length && <p className="empty-state">No events yet</p>}
      </div>
    </aside>
    <DialogueBar state={dialogue.state} line={dialogue.line} speaker={speaker} auto={dialogue.auto} showThoughts={dialogue.showThoughts} hidden={menu !== null}
      onNext={dialogue.next} onSkip={dialogue.skip} onAuto={() => dialogue.setAuto(!dialogue.auto)} onHistory={() => { setSelected(null); setExpanded(true); }}/>
    {person && <EmployeePanel key={person.id} person={person} anchor={returnFocus.current} business={state?.business} employeeId={person.id} cast={cast} threshold={cast.find(p => p.id === person.id)?.traits.quit_threshold || quitParams.defaultBurnoutThreshold} onClose={closeEmployee}/>}
    <nav className="game-tools" aria-label="Office tools">{(['simulation', 'shake', 'rumours', 'company'] as Tool[]).map(id => <button key={id} onClick={() => openMenu(id)} aria-label={MENU_LABEL[id]} title={MENU_LABEL[id]} aria-haspopup="dialog" aria-expanded={menu === id}><ToolIcon tool={id}/></button>)}</nav>
    {sim.error && !menu && <button className="error-notice" onClick={() => openMenu('simulation')}><span role="status">{playerText(sim.error)}</span> <span>Open Simulation</span></button>}
    {menu && <MenuPanel title={MENU_LABEL[menu]} onClose={() => setMenu(null)}>
      {menu === 'events' ? <><Events state={state} cast={cast} onPerson={select}/><BusinessReport runId={sim.runId} tick={hour} status={sim.reportStatus} cast={cast}/></> : menu === 'shake' ? <EventComposer onInject={sim.inject} onInjectCustom={sim.injectCustom} onInjectBusiness={sim.injectBusiness} label={live ? 'Connected' : 'Offline'} error={sim.error} disabled={disabled || complete} nextTick={hour + 1}/> : menu === 'stock' ? <StockChart history={history} current={sim.price} initialPrice={sim.initialPrice}/> : menu === 'company' || menu === 'rumours' ? <Company history={history} view={menu === 'company' ? 'wellbeing' : 'reach'} truth={truth} onTruth={setTruth}/> : <>
        <Controls running={state?.running} complete={complete} disabled={disabled} tick={hour} runLength={sim.maxTicks} runLengths={RUN_LENGTHS} onRunLength={value => void sim.setRunLength(value)} onStep={() => void sim.step()} onReset={() => void sim.reset()} onNewSeed={() => void sim.newSeed()}/>
        <fieldset className="dialogue-settings"><legend>Dialogue</legend>
          <label><input type="checkbox" checked={dialogue.auto} onChange={e => dialogue.setAuto(e.target.checked)}/> Auto advance</label>
          <label><input type="checkbox" checked={dialogue.showThoughts} onChange={e => dialogue.setShowThoughts(e.target.checked)}/> Show inner thoughts</label>
          <label><input type="checkbox" checked={dialogue.hold} onChange={e => dialogue.setHold(e.target.checked)}/> Hold for dialogue <small>Pauses each tick until its lines finish</small></label>
        </fieldset>
        <div className="diagnostics"><h3>Connection & engine</h3><dl><div><dt>Connection</dt><dd>{live ? 'Connected' : connectionText}</dd></div><div><dt>Engine</dt><dd>{diagnostic}</dd></div><div><dt>Seed</dt><dd>{state?.seed ?? '—'}</dd></div></dl>{sim.error && <p role="status" className="coral">{playerText(sim.error)}</p>}</div>
      </>}
    </MenuPanel>}
  </main>;
}
