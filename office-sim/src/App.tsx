import { QuarterReport } from './QuarterReport';
import { BusinessPage, type Tab as BusinessTab } from './BusinessPage';
import { Inbox, InboxToastView } from './Inbox';
import { inboxAt, loadRead, messageIds, newToasts, openThreadFor, saveRead, unreadCount } from './inboxModel';
import type { InboxThread, InboxToast } from '../shared/inbox';
import { OBJECTIVE_STATUS, dueIn, isActiveObjective, objectiveWorkPrefix } from './companyModel';
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
import { EmployeePanel, MenuPanel, RailPanel } from './GamePanel';
import { ACTION_LABEL, engineLabel, feedEntries, playerText, timeLabel, type FeedEntry } from './hudModel';
import { quitParams } from '../server/params';
import { RUN_LENGTHS, useSimulation } from './useSimulation';
import { useDialogue } from './useDialogue';
import { usePresentation } from './usePresentation';
import { presentedPresence } from './presentation';
import { isOvertime } from '../shared/workday';
import { isFastForward } from '../shared/playback';
import { DialogueBar, type Speaker } from './DialogueBar';
import { EMOTES, FEED_EMOJI } from './emotes';
import { useBackgroundMusic } from './useBackgroundMusic';
import './index.css';
import './inbox.css';

type RailTool = 'events' | 'inbox' | 'rumours' | 'company' | 'scorecard' | 'leaderboard' | 'settings';
type Menu = RailTool | 'stock' | 'business' | 'quarter';
const MENU_LABEL: Record<Menu, string> = { quarter: 'End of Quarter', events: 'Events', inbox: 'Inbox', company: 'Wellbeing', rumours: 'Rumour meter', settings: 'Simulation settings', stock: 'CHAOS stock', scorecard: 'Scorecard', leaderboard: 'Best Boss', business: 'Business' };
const RAIL_GROUPS: Array<{ label: string; tools: RailTool[] }> = [
  { label: 'Act', tools: ['events'] },
  { label: 'Monitor', tools: ['inbox', 'rumours', 'company'] },
  { label: 'Results', tools: ['scorecard', 'leaderboard'] },
];
const RAIL_SHORTCUT: Record<RailTool, string> = { events: 'E', inbox: 'I', rumours: 'R', company: 'W', scorecard: 'C', leaderboard: 'L', settings: 'Shift+S' };

function ToolIcon({ tool }: { tool: RailTool }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {tool === 'settings' ? <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 6h14M5 12h14M5 18h14"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="11" cy="18" r="2" fill="currentColor"/></g>
      : tool === 'events' ? <path fill="currentColor" d="m13 2-8 12h6l-1 8 9-13h-6z"/>
      : tool === 'inbox' ? <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" d="M4 13h4l1 3h6l1-3h4M4 13l2-8h12l2 8v6H4z"/>
      : tool === 'rumours' ? <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M4 5h12v9H9l-4 4v-4H4z"/><path d="M9 9h8v7h-3l-3 3v-3H9z"/></g>
      : tool === 'company' ? <path fill="currentColor" d="M12 21S4 16 4 10a4 4 0 0 1 7-2.6A4 4 0 0 1 18 10c0 6-6 11-6 11z"/>
      : tool === 'scorecard' ? <path fill="currentColor" d="M4 19h4v-7H4zm6 0h4V5h-4zm6 0h4v-10h-4z"/>
      : tool === 'leaderboard' ? <path fill="currentColor" d="M6 3h12v2h3v4a4 4 0 0 1-4 4h-.6A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 7.6 13H7a4 4 0 0 1-4-4V5h3zm0 4H5v2a2 2 0 0 0 1 1.7zm12 0v3.7A2 2 0 0 0 19 9V7z"/>
      : null}
  </svg>;
}
export default function App() {
  const sim = useSimulation();
  const { cast } = sim;
  const [selected, setSelected] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [businessTab, setBusinessTab] = useState<BusinessTab | undefined>(undefined);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [read, setRead] = useState<Set<string>>(() => new Set());
  const [toast, setToast] = useState<{ items: InboxToast[]; at: number } | null>(null);
  const toastSeen = useRef({ epoch: -1, tick: 0 });
  const openedCompletions = useRef(new Set<string>());
  const previousRun = useRef(sim.runId);
  const [expanded, setExpanded] = useState(false);
  const [truth, setTruth] = useState(false);
  const [showSyncDebug, setShowSyncDebug] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [playbackPaused, setPlaybackPaused] = useState(false);
  const presentation = usePresentation(sim.history, sim.historyEpoch, sim.state, sim.acknowledge, playbackPaused, isFastForward(sim.speed));
  const { state, history } = presentation;
  const hour = presentation.tick;
  const complete = hour >= sim.maxTicks && !presentation.playing;
  // The End of Quarter report opens once per completed run, unless the player is busy in a panel.
  useEffect(() => {
    if (previousRun.current !== sim.runId) {
      previousRun.current = sim.runId;
      setMenu(current => current === 'quarter' ? null : current);
      return;
    }
    if (!complete) { setMenu(current => current === 'quarter' ? null : current); return; }
    const key = `${sim.runId}:${sim.maxTicks}`;
    if (!sim.runId || menu || selected || openedCompletions.current.has(key)) return;
    openedCompletions.current.add(key); setMenu('quarter');
  }, [complete, sim.runId, sim.maxTicks, menu, selected]);
  const serverComplete = (sim.state?.tick ?? 0) >= sim.maxTicks;
  const live = sim.connection === 'live';
  const disabled = !live || sim.busy;
  const running = sim.state?.running ?? false;
  const music = useBackgroundMusic();
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
  const openMenu = useCallback((next: Menu, businessCase: string | null = null, tab?: BusinessTab) => {
    setSelected(null); setHighlight([]); setCaseId(businessCase); setBusinessTab(tab); setMenu(next);
  }, []);
  const toggleRailMenu = useCallback((next: RailTool) => {
    setSelected(null); setHighlight([]); setCaseId(null); setThreadId(null);
    setMenu(current => current === next ? null : next);
  }, []);
  useEffect(() => {
    const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    const shortcuts: Partial<Record<string, RailTool>> = { KeyE: 'events', KeyI: 'inbox', KeyR: 'rumours', KeyW: 'company', KeyC: 'scorecard', KeyL: 'leaderboard' };
    const down = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      const tool = event.shiftKey && event.code === 'KeyS' ? 'settings' : !event.shiftKey ? shortcuts[event.code] : undefined;
      if (!tool) return;
      event.preventDefault();
      toggleRailMenu(tool);
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [toggleRailMenu]);
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
  const rumourAlert = (state?.metrics.false_reach ?? 0) > 0;
  const wellbeingAlert = people.some(person => !person.quit && person.burnout >= (cast.find(profile => profile.id === person.id)?.traits.quit_threshold ?? quitParams.defaultBurnoutThreshold));
  const railMenu = menu && menu !== 'stock' && menu !== 'business' && menu !== 'quarter' ? menu : null;
  const entries = useMemo(() => feedEntries(history, EMOTES ? { names: Object.fromEntries(cast.map(c => [c.id, c.name])), emoji: FEED_EMOJI } : undefined), [history, cast]);
  const objective = sim.companyTasks.find(t => isActiveObjective(t.status));
  const objectiveWork = objective ? (state?.business?.tasks ?? []).filter(t => t.id.startsWith(objectiveWorkPrefix(objective.id))) : [];
  const queued: FeedEntry[] = (state?.queue ?? []).map((type, index) => ({
    key: `queued-${index}`, label: 'Queued', time: timeLabel((state?.tick ?? 0) + 1),
    text: state?.queue_text?.[index] ?? type, ids: [],
  })).reverse();
  const wireEntries = [...queued, ...entries];
  const person = people.find(p => p.id === selected);
  // Task inbox, as of the presented hour.
  const threads = useMemo(() => inboxAt(sim.inboxBase, history), [sim.inboxBase, history]);
  const unread = unreadCount(threads, read);
  useEffect(() => { setRead(loadRead(sim.runId)); }, [sim.runId]);
  const markRead = useCallback((items: InboxThread[]) => setRead(current => {
    const next = new Set([...current, ...items.flatMap(messageIds)]);
    saveRead(sim.runId, next);
    return next;
  }), [sim.runId]);
  const openThread = useCallback((taskId: string | null) => {
    setSelected(null); setHighlight([]); setCaseId(null); setThreadId(taskId); setMenu('inbox');
  }, []);
  const whyFor = useCallback((taskId: string) => Boolean(openThreadFor(threads, taskId)), [threads]);
  const jumpToTask = (thread: InboxThread) => thread.caseId && !thread.objectiveId ? openMenu('business', thread.caseId)
    : openMenu('business', null, thread.objectiveId ? 'objective' : 'staff');
  // Critical alerts: one toast at a time; alerts arriving while it is fresh merge into it.
  useEffect(() => {
    const seen = toastSeen.current;
    if (seen.epoch !== presentation.epoch) { toastSeen.current = { epoch: presentation.epoch, tick: hour }; return; }
    if (hour <= seen.tick) return;
    const fresh = newToasts(history, seen.tick);
    seen.tick = hour;
    if (fresh.length) setToast(current => current && Date.now() - current.at < 4000 ? { items: [...current.items, ...fresh], at: current.at } : { items: fresh, at: Date.now() });
  }, [hour, history, presentation.epoch]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 9000);
    return () => clearTimeout(timer);
  }, [toast]);
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
  const connectionText = sim.connection === 'reconnecting' ? 'Connection lost' : sim.connection === 'connecting' ? 'Connecting…' : sim.connection === 'mock' ? 'Preview' : null;
  const diagnostic = engineLabel(sim.mode, sim.modeReason);
  return <main className="game-window" aria-label="The Daily Grind">
    <OfficeView key={sim.historyEpoch} people={people} tick={hour} selected={selected} onSelect={select} highlight={highlight}
      ready={Boolean(state) && people.length > 0 && presentation.epoch === sim.historyEpoch}
      line={menu === null && dialogue.line?.kind === 'agent' ? dialogue.line : null}
      showThoughts={dialogue.showThoughts} records={latest} speed={sim.speed} paused={playbackPaused || menu !== null} showDebug={showSyncDebug}
      announcement={presentation.frame?.events.find(e => e.official) ?? null}/>
    <span className="engine-badge" aria-label="Decision engine">{diagnostic}</span>
    <StockPrice history={history} current={price} initialPrice={sim.initialPrice} expanded={menu === 'stock'} onOpen={() => openMenu('stock')}/>
    <Workday tick={hour} calendarDay={dialogue.line?.calendarDay ?? (!presentation.playing ? presentation.frame?.day_report?.fillerDays.at(-1) : undefined)} speed={sim.speed} running={!playbackPaused && (running || serverComplete && presentation.playing)} started={sim.state?.started ?? false} complete={complete} disabled={disabled} onSpeed={value => void sim.setSpeed(value)} onToggle={toggle}/>
    {connectionText && <div className={`connection-status ${sim.connection === 'reconnecting' ? 'coral' : ''}`} role="status">{connectionText}</div>}
    {sim.phase && !presentation.playing && <div className="management-phase" role="status">{sim.phase}…</div>}
    {sim.storageError && <div className="storage-error" role="alert">{sim.storageError}</div>}
    {showSyncDebug && <aside className="sync-debug" aria-label="Time synchronization debug">
      <strong>SYNC DEBUG</strong><span>presented: {presentation.tick} · {timeLabel(presentation.tick)}</span><span>latest: {sim.state?.tick ?? 0}</span><span>line: {dialogue.line?.tick ?? '—'}</span><span>waiting: {sim.history.filter(frame => frame.tick > presentation.tick).length}</span><span>lag: {Math.max(0, (sim.state?.tick ?? 0) - presentation.tick)}</span>
    </aside>}
    {announcement?.announcement && announcement.key !== dismissedAnnouncement && <section className="announcement" aria-label="New announcement"><div role="status"><span>{announcement.announcement.official ? '📢 CEO' : 'Announcement'}</span><p>{playerText(announcement.announcement.text)}</p></div><button className="close" onClick={() => setDismissedAnnouncement(announcement.key)} aria-label="Dismiss announcement">×</button></section>}
    {announcement?.business && announcement.key !== dismissedAnnouncement && <section className={`announcement business tone-${announcement.business.tone}`} aria-label="Business event">
      <div role="status"><span>{announcement.business.label}</span><p>{announcement.business.text}</p>
        <button className="view-case" onClick={() => openMenu('business', announcement.business!.caseId)}>View case</button></div>
      <button className="close" onClick={() => setDismissedAnnouncement(announcement.key)} aria-label="Dismiss business event">×</button></section>}
    <div className="hud-left">
    <aside className={`office-wire ${expanded ? 'expanded' : ''} ${railMenu ? 'collapsed-for-panel' : ''}`} aria-label="Office wire" aria-hidden={Boolean(railMenu)}>
      <div className="wire-heading"><h2>Office wire</h2><button onClick={() => openMenu('business')}>Business</button><button aria-label={expanded ? 'Collapse Office wire history' : 'Expand Office wire history'} aria-expanded={expanded} aria-controls="wire-history" onClick={() => { setExpanded(!expanded); setHighlight([]); }}>{expanded ? 'Collapse' : 'History'}<span aria-hidden="true">{expanded ? ' −' : ' +'}</span></button></div>
      {complete && <button className="report-entry" onClick={() => openMenu('quarter')}>Business report · {sim.reportStatus === 'pending' ? 'Preparing…' : sim.reportStatus === 'factual_fallback' ? 'Factual report ready' : 'View report'}</button>}
      {objective && <button className="objective-strip" onClick={() => openMenu('business')} aria-label={`Objective: ${objective.objective}. Open Business`}>
        <b>Objective</b><span>{objective.objective}</span>
        <small>{objectiveWork.length ? `${objectiveWork.filter(t => t.status === 'done').length}/${objectiveWork.length} · ` : ''}{objective.deadlineTick !== undefined ? dueIn(objective.deadlineTick, hour) : OBJECTIVE_STATUS[objective.status].text}</small>
      </button>}
      <div className="wire-history" id="wire-history" tabIndex={expanded ? 0 : undefined} onKeyDown={event => { if (event.key === 'Escape' && expanded) { setExpanded(false); event.currentTarget.parentElement?.querySelector('button')?.focus(); } }}>
        {(expanded ? wireEntries : wireEntries.slice(0, 2)).map(entry => {
          const content = <><div className="feed-meta"><span className={entry.tone ?? (entry.label === 'Resignation' ? 'coral' : '')}>{entry.label}{truth && entry.truth !== undefined && <b className={entry.truth ? 'mint' : 'coral'}> · {entry.truth ? 'True' : 'False'}</b>}</span><time>{entry.time}</time></div><p>{entry.text}</p></>;
          return entry.ids.length ? <button className={`feed-entry${entry.reply ? ' reply' : ''}`} key={entry.key} onMouseEnter={() => setHighlight(entry.ids)} onMouseLeave={() => setHighlight([])} onFocus={() => setHighlight(entry.ids)} onBlur={() => setHighlight([])} onClick={() => select(entry.ids[0])}>{content}</button> : <article className="feed-entry" key={entry.key}>{content}</article>;
        })}
        {!entries.length && !state?.queue.length && <p className="empty-state">No events yet</p>}
      </div>
    </aside>
    <nav className="game-tools" aria-label="Office tools">
      {RAIL_GROUPS.map(group => <div className="rail-group" key={group.label} aria-label={group.label}>{group.tools.map(id => {
        const alert = id === 'rumours' ? rumourAlert : id === 'company' ? wellbeingAlert : false;
        const count = id === 'inbox' ? unread : 0;
        return <button key={id} onClick={() => toggleRailMenu(id)} aria-label={`${MENU_LABEL[id]} · ${RAIL_SHORTCUT[id]}${alert ? ' · Needs attention' : ''}${count ? ` · ${count} unread alerts` : ''}`} data-tooltip={`${MENU_LABEL[id]} · ${RAIL_SHORTCUT[id]}`} aria-controls="rail-panel" aria-expanded={menu === id}>
          <ToolIcon tool={id}/>{alert && <span className="rail-alert" aria-label="Needs attention"/>}{count > 0 && <span className="rail-count" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
        </button>;
      })}</div>)}
      <div className="rail-system" aria-label="System"><button onClick={() => toggleRailMenu('settings')} aria-label={`${MENU_LABEL.settings} · ${RAIL_SHORTCUT.settings}`} data-tooltip={`${MENU_LABEL.settings} · ${RAIL_SHORTCUT.settings}`} aria-controls="rail-panel" aria-expanded={menu === 'settings'}><ToolIcon tool="settings"/></button></div>
    </nav>
    </div>
    <DialogueBar state={dialogue.state} line={dialogue.line} speaker={speaker} auto={dialogue.auto} voices={dialogue.voices} showThoughts={dialogue.showThoughts} hidden={menu !== null}
      onNext={dialogue.next} onSkip={dialogue.skip} onAuto={() => dialogue.setAuto(!dialogue.auto)} onVoices={() => dialogue.setVoices(!dialogue.voices)} onHistory={() => { setSelected(null); setExpanded(true); }}/>
    {person && <EmployeePanel key={person.id} person={person} anchor={returnFocus.current} business={state?.business} employeeId={person.id} cast={cast} threshold={cast.find(p => p.id === person.id)?.traits.quit_threshold || quitParams.defaultBurnoutThreshold} onClose={closeEmployee} whyFor={whyFor} onWhy={openThread}/>}
    {toast && <InboxToastView toasts={toast.items} onOpen={() => { openThread(toast.items.length === 1 ? toast.items[0].threadId : null); setToast(null); }} onDismiss={() => setToast(null)}/>}
    {sim.error && !menu && <button className="error-notice" onClick={() => toggleRailMenu('settings')}><span role="status">{playerText(sim.error)}</span> <span>Open Simulation settings</span></button>}
    {railMenu && <RailPanel id="rail-panel" title={MENU_LABEL[railMenu]} onClose={() => setMenu(null)}>
      {railMenu === 'inbox' ? <Inbox threads={threads} people={people} read={read} focusId={threadId} onRead={markRead} onJump={jumpToTask} onFocus={select}/> : railMenu === 'events' ? <EventComposer onInject={sim.inject} onInjectCustom={sim.injectCustom} onInjectBusiness={sim.injectBusiness} label={live ? 'Connected' : 'Offline'} error={sim.error} disabled={disabled || complete} nextTick={(sim.state?.tick ?? hour) + (sim.phase ? 2 : 1)}/> : railMenu === 'scorecard' ? <Scorecard scorecard={state?.metrics.scorecard}/> : railMenu === 'leaderboard' ? <Leaderboard/> : railMenu === 'company' || railMenu === 'rumours' ? <Company history={history} view={railMenu === 'company' ? 'wellbeing' : 'reach'} truth={truth} onTruth={setTruth}/> : <>
        <Controls running={running} complete={serverComplete} disabled={disabled} tick={hour} runLength={sim.maxTicks} runLengths={RUN_LENGTHS} onRunLength={value => void sim.setRunLength(value)} onStep={() => { setPlaybackPaused(false); void sim.step(); }} onReset={() => { setPlaybackPaused(false); void sim.reset(); }} onNewSeed={() => { setPlaybackPaused(false); void sim.newSeed(); }}/>
        <fieldset className="dialogue-settings"><legend>Dialogue</legend>
          <label><input type="checkbox" checked={dialogue.auto} onChange={e => dialogue.setAuto(e.target.checked)}/> Auto advance</label>
          <label><input type="checkbox" checked={dialogue.voices} onChange={e => dialogue.setVoices(e.target.checked)}/> Voices</label>
          <label><input type="checkbox" checked={music.enabled} onChange={e => music.setEnabled(e.target.checked)}/> Background music</label>
          <label><input type="checkbox" checked={dialogue.showThoughts} onChange={e => dialogue.setShowThoughts(e.target.checked)}/> Show inner thoughts</label>
        </fieldset>
        <div className="diagnostics"><h3>Connection & engine</h3><dl><div><dt>Connection</dt><dd>{live ? 'Connected' : connectionText}</dd></div><div><dt>Engine</dt><dd>{diagnostic}</dd></div><div><dt>Seed</dt><dd>{state?.seed ?? '—'}</dd></div></dl>{sim.error && <p role="status" className="coral">{playerText(sim.error)}</p>}</div>
      </>}
    </RailPanel>}
    {(menu === 'business' || menu === 'stock' || menu === 'quarter') && <MenuPanel key={menu} wide={menu === 'quarter'} title={MENU_LABEL[menu]} onClose={() => setMenu(null)}>
      {menu === 'quarter' ? (sim.runId ? <QuarterReport key={sim.runId} runId={sim.runId} status={sim.reportStatus} onClose={() => setMenu(null)} onFullReport={() => openMenu('business', null, 'report')} onNewRun={() => { setMenu(null); setPlaybackPaused(false); void sim.newSeed(); }}/> : null)
        : menu === 'business'
        ? <BusinessPage state={state} history={history} tick={hour} cast={cast} onPerson={select} initialCase={caseId} initialTab={businessTab} whyFor={whyFor} onWhy={openThread}
          companyTasks={sim.companyTasks} onSubmitObjective={sim.submitObjective} objectiveDisabled={!live || serverComplete} runId={sim.runId} reportStatus={sim.reportStatus}/>
        : <StockChart history={history} current={price} initialPrice={sim.initialPrice}/>
      }
    </MenuPanel>}
  </main>;
}
