import { Events } from './Events';
import { BusinessReport } from './BusinessReport';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lookFor, type Person } from './people';
import { OfficeView } from './three/OfficeView';
import { Workday } from './Workday';
import { Controls } from './Controls';
import { EventComposer } from './EventComposer';
import { Company } from './Company';
import { Scorecard } from './Scorecard';
import { Leaderboard } from './leaderboard/Leaderboard';
import { StockPrice, StockChart } from './StockPrice';
import { EmployeePanel, MenuPanel } from './GamePanel';
import { ACTION_LABEL, feedEntries, playerText, timeLabel, type FeedEntry } from './hudModel';
import { quitParams } from '../server/params';
import { RUN_LENGTHS, useSimulation } from './useSimulation';
import { useDialogue } from './useDialogue';
import { usePresentation } from './usePresentation';
import { presentedPresence } from './presentation';
import { isOvertime } from '../shared/workday';
import { DialogueBar, type Speaker } from './DialogueBar';
import './index.css';

type Tool = 'simulation' | 'shake' | 'rumours' | 'company' | 'scorecard' | 'leaderboard';
type Menu = Tool | 'stock' | 'events';
const MENU_LABEL: Record<Menu, string> = { events: 'Business events', shake: 'Shake office', company: 'Wellbeing', rumours: 'Rumour reach', simulation: 'Simulation', stock: 'CHAOS stock', scorecard: 'Scorecard', leaderboard: 'Best Boss' };

function ToolIcon({ tool }: { tool: Tool }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {tool === 'simulation' ? <path fill="currentColor" d="M6 7h12v2H6zm0 4h12v2H6zm0 4h12v2H6z"/>
      : tool === 'shake' ? <path fill="currentColor" d="M6 3h2v18H6zm2 1c4-3 6 4 12 1v11c-6 3-8-4-12-1z"/>
      : tool === 'rumours' ? <path d="M5 14c0-8 5-8 7-1s6 6 7-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      : tool === 'scorecard' ? <path fill="currentColor" d="M4 19h4v-7H4zm6 0h4V5h-4zm6 0h4v-10h-4z"/>
      : tool === 'leaderboard' ? <path fill="currentColor" d="M6 3h12v2h3v4a4 4 0 0 1-4 4h-.6A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 7.6 13H7a4 4 0 0 1-4-4V5h3zm0 4H5v2a2 2 0 0 0 1 1.7zm12 0v3.7A2 2 0 0 0 19 9V7z"/>
      : <g fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M7 13a5 5 0 0 0 10 0"/><path d="M9 7v3m6-3v3"/></g>}
  </svg>;
}
export default function App() {
  const sim = useSimulation();
  const { cast } = sim;
  const [selected, setSelected] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [truth, setTruth] = useState(false);
  const [showSyncDebug, setShowSyncDebug] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [playbackPaused, setPlaybackPaused] = useState(false);
  const presentation = usePresentation(sim.history, sim.historyEpoch, sim.state, sim.acknowledge, playbackPaused);
  const { state, history } = presentation;
  const hour = presentation.tick;
  const complete = hour >= sim.maxTicks && !presentation.playing;
  const serverComplete = (sim.state?.tick ?? 0) >= sim.maxTicks;
  const live = sim.connection === 'live';
  const disabled = !live || sim.busy;
  const running = sim.state?.running ?? false;
  const dialogue = useDialogue({
    frame: presentation.frame, previous: presentation.previous, playing: presentation.playing && presentation.epoch === sim.historyEpoch,
    epoch: sim.historyEpoch, speed: sim.speed, onDone: presentation.done, paused: menu !== null || playbackPaused, blocked: menu !== null,
    onSpace: () => toggle(), archetypeOf: id => cast.find(p => p.id === id)?.archetype,
  });
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Backquote' || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      setShowSyncDebug(value => !value);
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);
  function toggle() {
    if (disabled || complete) return;
    if (serverComplete) { setPlaybackPaused(value => !value); return; }
    setPlaybackPaused(running);
    void (sim.state?.started ? sim.togglePlay() : sim.start());
  }
  const latest = useMemo(() => {
    const records: Record<string, (typeof history)[number]['records'][number]> = {};
    for (const frame of history) for (const record of frame.records) records[record.agent] = record;
    return records;
  }, [history]);
  const presenceFinished = !presentation.playing || Boolean(dialogue.line?.report);
  const people: Person[] = useMemo(() => cast.map((profile, index) => {
    const s = state?.agents[profile.id];
    const record = latest[profile.id];
    const present = presentation.frame ? presentedPresence(presentation.frame, presentation.previous, profile.id, presenceFinished) : s?.present !== false;
    const late = present && isOvertime(hour);
    return { ...lookFor(profile.archetype, index), id: profile.id, name: profile.name, role: profile.archetype,
      stress: (s?.stress ?? 0), workload: (s?.workload ?? 0), burnout: (s?.burnout ?? 0), trust: (s?.trust_mgmt ?? 0), present, late,
      action: s?.status === 'laid_off' ? 'Laid off' : s?.status === 'quit' ? 'Resigned' : !present ? 'Left for the day' : late ? 'Working late' : record ? ACTION_LABEL[record.action] : 'Waiting',
      says: record?.public_line ?? '', thinks: record?.inner_monologue ?? '', quit: s?.status === 'quit' || s?.status === 'laid_off',
    };
  }), [cast, latest, state, presentation.frame, presentation.previous, presenceFinished, hour]);
  const entries = useMemo(() => feedEntries(history), [history]);
  const queued: FeedEntry[] = (state?.queue ?? []).map((type, index) => ({
    key: `queued-${index}`, label: 'Queued', time: timeLabel((state?.tick ?? 0) + 1),
    text: state?.queue_text?.[index] ?? type, ids: [],
  })).reverse();
  const wireEntries = [...queued, ...entries];
  const person = people.find(p => p.id === selected);
  const speaking = dialogue.line?.kind === 'agent' ? dialogue.line.agent : null;
  const speaker: Speaker | null = useMemo(() => {
    if (dialogue.line?.kind === 'narrator') return { name: 'Office narrator', team: '', look: lookFor('', 0) };
    if (!speaking) return null;
    const profile = cast.find(p => p.id === speaking);
    const look = people.find(p => p.id === speaking) ?? lookFor('', 0);
    return { name: profile?.name ?? speaking, team: profile?.functionGroup ?? '', look };
  }, [speaking, cast, people, dialogue.line?.kind]);
  const [dismissedAnnouncement, setDismissedAnnouncement] = useState<string | null>(null);
  const announcement = dialogue.state.phase !== 'idle' ? dialogue.state.round.slice(0, dialogue.state.index + 1).filter(l => l.announcement || l.business).at(-1) : undefined;
  const [caseId, setCaseId] = useState<string | null>(null);
  const price = presentation.frame?.price ?? (hour === sim.state?.tick ? sim.price : null);
  const select = (id: string) => {
    returnFocus.current = document.querySelector<HTMLButtonElement>(`[data-employee="${CSS.escape(id)}"]`);
    setMenu(null); setSelected(id); setHighlight([]);
  };
  const closeEmployee = useCallback(() => {
    setSelected(null);
    const previous = returnFocus.current;
    const id = previous?.dataset.employee;
    const target = previous?.isConnected ? previous : id ? document.querySelector<HTMLElement>(`[data-employee="${CSS.escape(id)}"]`) : null;
    target?.focus({ preventScroll: true });
  }, []);
  function openMenu(next: Menu, businessCase: string | null = null) { setSelected(null); setHighlight([]); setCaseId(businessCase); setMenu(next); }
  const connectionText = sim.connection === 'reconnecting' ? 'Connection lost' : sim.connection === 'connecting' ? 'Connecting…' : sim.connection === 'mock' ? 'Preview' : null;
  const diagnostic = sim.mode === 'llm_bias' ? 'LLM + bias engine' : sim.modeReason === 'no_api_key' ? 'Rules mode · No API key' : sim.modeReason === 'llm_failed' ? 'Rules mode · LLM unavailable' : 'Rules mode';
  return <main className="game-window" aria-label="The Daily Grind">
    <OfficeView key={sim.historyEpoch} people={people} selected={selected} onSelect={select} highlight={highlight}
      ready={Boolean(state) && people.length > 0 && presentation.epoch === sim.historyEpoch}
      line={menu === null && dialogue.line?.kind === 'agent' ? dialogue.line : null}
      showThoughts={dialogue.showThoughts} records={latest} speed={sim.speed} paused={playbackPaused || menu !== null}/>
    <StockPrice history={history} current={price} initialPrice={sim.initialPrice} expanded={menu === 'stock'} onOpen={() => openMenu('stock')}/>
    <Workday tick={hour} calendarDay={dialogue.line?.calendarDay ?? (!presentation.playing ? presentation.frame?.day_report?.fillerDays.at(-1) : undefined)} speed={sim.speed} running={!playbackPaused && (running || serverComplete && presentation.playing)} started={sim.state?.started ?? false} complete={complete} disabled={disabled} onSpeed={value => void sim.setSpeed(value)} onToggle={toggle}/>
    {connectionText && <div className={`connection-status ${sim.connection === 'reconnecting' ? 'coral' : ''}`} role="status">{connectionText}</div>}
    {sim.phase && !presentation.playing && <div className="management-phase" role="status">{sim.phase}…</div>}
    {sim.storageError && <div className="storage-error" role="alert">{sim.storageError}</div>}
    {showSyncDebug && <aside className="sync-debug" aria-label="Time synchronization debug">
      <strong>SYNC DEBUG</strong><span>presented: {presentation.tick} · {timeLabel(presentation.tick)}</span><span>latest: {sim.state?.tick ?? 0}</span><span>line: {dialogue.line?.tick ?? '—'}</span><span>waiting: {sim.history.filter(frame => frame.tick > presentation.tick).length}</span><span>lag: {Math.max(0, (sim.state?.tick ?? 0) - presentation.tick)}</span>
    </aside>}
    {announcement?.announcement && announcement.key !== dismissedAnnouncement && <section className="announcement" aria-label="New announcement"><div role="status"><span>Announcement</span><p>{playerText(announcement.announcement.text)}</p></div><button className="close" onClick={() => setDismissedAnnouncement(announcement.key)} aria-label="Dismiss announcement">×</button></section>}
    {announcement?.business && announcement.key !== dismissedAnnouncement && <section className={`announcement business tone-${announcement.business.tone}`} aria-label="Business event">
      <div role="status"><span>{announcement.business.label}</span><p>{announcement.business.text}</p>
        <button className="view-case" onClick={() => openMenu('events', announcement.business!.caseId)}>View case</button></div>
      <button className="close" onClick={() => setDismissedAnnouncement(announcement.key)} aria-label="Dismiss business event">×</button></section>}
    <aside className={`office-wire ${expanded ? 'expanded' : ''}`} aria-label="Office wire">
      <div className="wire-heading"><h2>Office wire</h2><button onClick={() => openMenu('events')}>Business events</button><button aria-label={expanded ? 'Collapse Office wire history' : 'Expand Office wire history'} aria-expanded={expanded} aria-controls="wire-history" onClick={() => { setExpanded(!expanded); setHighlight([]); }}>{expanded ? 'Collapse' : 'History'}<span aria-hidden="true">{expanded ? ' −' : ' +'}</span></button></div>
      {complete && <button className="report-entry" onClick={() => openMenu('events')}>Business report · {sim.reportStatus === 'pending' ? 'Preparing…' : sim.reportStatus === 'factual_fallback' ? 'Factual report ready' : 'View report'}</button>}
      <div className="wire-history" id="wire-history" tabIndex={expanded ? 0 : undefined} onKeyDown={event => { if (event.key === 'Escape' && expanded) { setExpanded(false); event.currentTarget.parentElement?.querySelector('button')?.focus(); } }}>
        {(expanded ? wireEntries : wireEntries.slice(0, 2)).map(entry => {
          const content = <><div className="feed-meta"><span className={entry.tone ?? (entry.label === 'Resignation' ? 'coral' : '')}>{entry.label}{truth && entry.truth !== undefined && <b className={entry.truth ? 'mint' : 'coral'}> · {entry.truth ? 'True' : 'False'}</b>}</span><time>{entry.time}</time></div><p>{entry.text}</p></>;
          return entry.ids.length ? <button className="feed-entry" key={entry.key} onMouseEnter={() => setHighlight(entry.ids)} onMouseLeave={() => setHighlight([])} onFocus={() => setHighlight(entry.ids)} onBlur={() => setHighlight([])} onClick={() => select(entry.ids[0])}>{content}</button> : <article className="feed-entry" key={entry.key}>{content}</article>;
        })}
        {!entries.length && !state?.queue.length && <p className="empty-state">No events yet</p>}
      </div>
    </aside>
    <DialogueBar state={dialogue.state} line={dialogue.line} speaker={speaker} auto={dialogue.auto} voices={dialogue.voices} showThoughts={dialogue.showThoughts} hidden={menu !== null}
      onNext={dialogue.next} onSkip={dialogue.skip} onAuto={() => dialogue.setAuto(!dialogue.auto)} onVoices={() => dialogue.setVoices(!dialogue.voices)} onHistory={() => { setSelected(null); setExpanded(true); }}/>
    {person && <EmployeePanel key={person.id} person={person} anchor={returnFocus.current} business={state?.business} employeeId={person.id} cast={cast} threshold={cast.find(p => p.id === person.id)?.traits.quit_threshold || quitParams.defaultBurnoutThreshold} onClose={closeEmployee}/>}
    <nav className="game-tools" aria-label="Office tools">{(['simulation', 'shake', 'rumours', 'company', 'scorecard', 'leaderboard'] as Tool[]).map(id => <button key={id} onClick={() => openMenu(id)} aria-label={MENU_LABEL[id]} title={MENU_LABEL[id]} aria-haspopup="dialog" aria-expanded={menu === id}><ToolIcon tool={id}/></button>)}</nav>
    {sim.error && !menu && <button className="error-notice" onClick={() => openMenu('simulation')}><span role="status">{playerText(sim.error)}</span> <span>Open Simulation</span></button>}
    {menu && <MenuPanel title={MENU_LABEL[menu]} onClose={() => setMenu(null)}>
      {menu === 'events' ? <><Events state={state} cast={cast} onPerson={select} initialId={caseId}/><BusinessReport runId={sim.runId} tick={hour} status={sim.reportStatus} cast={cast}/></> : menu === 'shake' ? <EventComposer onInject={sim.inject} onInjectCustom={sim.injectCustom} onInjectBusiness={sim.injectBusiness} label={live ? 'Connected' : 'Offline'} error={sim.error} disabled={disabled || complete} nextTick={(sim.state?.tick ?? hour) + (sim.phase ? 2 : 1)}/> : menu === 'scorecard' ? <Scorecard scorecard={state?.metrics.scorecard}/> : menu === 'leaderboard' ? <Leaderboard/> : menu === 'stock' ? <StockChart history={history} current={price} initialPrice={sim.initialPrice}/> : menu === 'company' || menu === 'rumours' ? <Company history={history} view={menu === 'company' ? 'wellbeing' : 'reach'} truth={truth} onTruth={setTruth}/> : <>
        <Controls running={running} complete={serverComplete} disabled={disabled} tick={hour} runLength={sim.maxTicks} runLengths={RUN_LENGTHS} onRunLength={value => void sim.setRunLength(value)} onStep={() => { setPlaybackPaused(false); void sim.step(); }} onReset={() => { setPlaybackPaused(false); void sim.reset(); }} onNewSeed={() => { setPlaybackPaused(false); void sim.newSeed(); }}/>
        <fieldset className="dialogue-settings"><legend>Dialogue</legend>
          <label><input type="checkbox" checked={dialogue.auto} onChange={e => dialogue.setAuto(e.target.checked)}/> Auto advance</label>
          <label><input type="checkbox" checked={dialogue.voices} onChange={e => dialogue.setVoices(e.target.checked)}/> Voices</label>
          <label><input type="checkbox" checked={dialogue.showThoughts} onChange={e => dialogue.setShowThoughts(e.target.checked)}/> Show inner thoughts</label>
        </fieldset>
        <div className="diagnostics"><h3>Connection & engine</h3><dl><div><dt>Connection</dt><dd>{live ? 'Connected' : connectionText}</dd></div><div><dt>Engine</dt><dd>{diagnostic}</dd></div><div><dt>Seed</dt><dd>{state?.seed ?? '—'}</dd></div></dl>{sim.error && <p role="status" className="coral">{playerText(sim.error)}</p>}</div>
      </>}
    </MenuPanel>}
  </main>;
}
