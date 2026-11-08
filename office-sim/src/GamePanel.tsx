import type { Business } from '../shared/business';
import type { AgentProfile } from '../shared/types';
import { timeLabel } from './hudModel';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Sprite, type Person } from './people';
import { BURNOUT_RECOVERY_THRESHOLD, BURNOUT_STRESS_THRESHOLD } from '../shared/stressThresholds';
import { CEO_MODEL_OPTIONS, metricState, playerText, type Metric } from './hudModel';

export function MenuPanel({ title, onClose, children, wide = false }: { wide?: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    return () => { element.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className={`tool-panel${wide ? ' quarter-panel' : ''}`} aria-labelledby="tool-title" onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex]:not([tabindex="-1"])')).filter(element => element.getClientRects().length > 0);
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target === dialog.current) {
      const r = dialog.current.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose();
    }
  }}><div className="tool-heading"><h2 id="tool-title">{title}</h2><button className="close" autoFocus onClick={onClose} aria-label={`Close ${title}`}>×</button></div><div className="tool-content">{children}</div></dialog>;
}

export function MetricBar({ label, value, threshold }: { label: Metric; value: number; threshold: number }) {
  const status = metricState(label, value, threshold);
  const displayValue = Number(value.toFixed(1));
  return <div className="metric"><div className="metric-heading"><span>{label}</span><strong>{displayValue}<small>/100</small></strong></div><div className="metric-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={`${value} out of 100, ${status.text}`}><i className={`fill-${status.tone}`} style={{ width: `${value}%` }}/></div><span className={`metric-status ${status.tone}`}>{status.text}</span></div>;
}

/** Mock: the choice is local to this panel and is not sent to the server. */
function CeoModelSelect() {
  const [model, setModel] = useState<string>(CEO_MODEL_OPTIONS[0].id);
  return <section className="employee-assignment ceo-model">
    <label htmlFor="ceo-model" className="ceo-model-label">CEO model</label>
    <select id="ceo-model" className="ceo-model-select" value={model} onChange={e => setModel(e.target.value)}>
      {CEO_MODEL_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  </section>;
}

export function EmployeePanel({ person, threshold, anchor, onClose, business, employeeId, cast = [] }: { business?: Business; employeeId?: string; cast?: AgentProfile[]; person: Person; threshold: number; anchor: HTMLElement | null; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  useLayoutEffect(() => {
    function place() {
      if (!panel.current) return;
      const rect = anchor?.getBoundingClientRect();
      const { width, height } = panel.current.getBoundingClientRect();
      const room = window.innerWidth;
      const preferred = rect ? (rect.right + 16 + width <= room - 12 ? rect.right + 16 : rect.left - width - 16) : room - width - 12;
      // Stay above the dialogue bar's reserved strip.
      const reserve = parseFloat(getComputedStyle(panel.current).getPropertyValue('--dialogue-reserve')) || 0;
      setPosition({ left: Math.max(12, Math.min(room - width - 12, preferred)), top: Math.max(12, Math.min(window.innerHeight - reserve - height - 12, (rect?.top ?? 120) - 100)) });
    }
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); };
  }, [person.id, anchor]);
  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>('.close')?.focus();
    function outside(event: PointerEvent) {
      const target = event.target as Element;
      if (!panel.current?.contains(target) && !target.closest('[data-employee], .feed-entry')) onClose();
    }
    function escape(event: KeyboardEvent) { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [onClose]);
  return <section ref={panel} style={position} className="employee-panel" role="dialog" aria-labelledby="employee-name">
    <div className="employee-heading"><div className="portrait" style={{ borderColor: person.color }}><Sprite person={person} quit={person.quit}/></div><div><h2 id="employee-name">{person.name}</h2><p>{person.role}</p></div><button className="close" onClick={onClose} aria-label="Close employee details">×</button></div>
    <div className="employee-content" tabIndex={0} aria-label="Employee statements and metrics"><p className={`current-action ${person.quit ? 'coral' : 'mint'}`}><span className="status-dot"/>{person.action}</p>
      {person.role === 'CEO' && <CeoModelSelect/>}
      {business && employeeId && <section className="employee-assignment"><h3>Current work</h3><p>Supervisor: {cast.find(p => p.id === business.positions[employeeId]?.supervisor)?.name ?? business.positions[employeeId]?.supervisor ?? 'Executive owner'}</p>{business.tasks.filter(t => t.owner === employeeId && !['done','cancelled'].includes(t.status)).map(t => <p key={t.id}>{t.title} · {t.status} · Due {timeLabel(t.deadline)} · Priority {t.priority}</p>)}</section>}
      <div className="employee-dialogue"><h3>Public statement</h3><blockquote>{person.says ? `“${playerText(person.says)}”` : 'No statement yet'}</blockquote><h3>Private thought</h3><blockquote className="private-thought">{person.thinks ? `“${playerText(person.thinks)}”` : 'No thought recorded'}</blockquote></div>
      <div className="employee-metrics"><MetricBar label="Stress" value={person.stress} threshold={threshold}/><MetricBar label="Burnout" value={person.burnout} threshold={threshold}/><MetricBar label="Trust in management" value={person.trust} threshold={threshold}/><MetricBar label="Workload" value={person.workload} threshold={threshold}/></div>
      <p className="metric-note">Higher stress, burnout and workload mean more pressure. Higher trust is favourable. Burnout rises above {BURNOUT_STRESS_THRESHOLD} stress and recovers below {BURNOUT_RECOVERY_THRESHOLD}. The base burnout exit threshold is {threshold}; recent interviews can lower it.</p>
    </div>
  </section>;
}
