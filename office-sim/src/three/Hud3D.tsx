// HUD pieces used only by the 3D view (VITE_VIEW=3d). They render existing data; nothing is computed here.
import { useState } from 'react';
import type { TickFrame } from '../../shared/api';
import type { SimulationState } from '../../shared/types';
import type { Person } from '../design/Office';
import { Company } from '../Company';
import { playerText, timeLabel } from '../hudModel';

export type Tool3D = 'people' | 'shake' | 'company' | 'simulation';
export const TOOLS_3D: Tool3D[] = ['people', 'shake', 'company', 'simulation'];
export const LABEL_3D: Record<Tool3D, string> = { people: 'People', shake: 'Shake office', company: 'Charts', simulation: 'Settings' };

/** People, briefcase, chart and gear icons for the 3D rail. */
export function Icon3D({ tool }: { tool: Tool3D }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">
    {tool === 'people' ? <path d="M6 4h5v5H6zM4 10h9v8H4zM15 6h4v4h-4zM14 11h7v7h-7z"/>
      : tool === 'shake' ? <path d="M9 4h6v3h5v12H4V7h5zm2 2v1h2V6zM6 9v3h12V9zm0 5v3h12v-3zm5-1h2v2h-2z"/>
      : tool === 'company' ? <path d="M4 19h16v2H4zM5 12h3v6H5zm5-5h3v11h-3zm5 3h3v8h-3z"/>
      : <path d="M10 2h4l.5 3 2 1 2.5-1.8 2.8 2.8L20 9.5l1 2v1l-3 .5-1 2 1.8 2.5-2.8 2.8-2.5-1.8-2 1-.5 3h-4l-.5-3-2-1-2.5 1.8-2.8-2.8L5 14.5l-1-2v-1l3-.5 1-2-1.8-2.5 2.8-2.8L9.5 6l2-1zm2 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>}
  </svg>;
}

function Bar({ label, value, tone }: { label: string; value: number; tone: string }) {
  const v = Math.max(0, Math.min(100, value));
  return <div className="o3-bar"><span>{label}</span><i><b className={tone} style={{ width: `${v}%` }}/></i><em>{Math.round(value)}</em></div>;
}

/** All eight agents at a glance; clicking a card opens their full panel. */
export function PeopleDrawer({ people, onSelect }: { people: Person[]; onSelect: (id: string) => void }) {
  return <div className="o3-people">
    {people.map(p => <button key={p.id} className={`o3-card ${p.quit ? 'quit' : ''}`} onClick={() => onSelect(p.id)}>
      <header><strong style={{ borderColor: p.color }}>{p.name}</strong><small>{p.role} · {p.action}</small></header>
      {p.says && <p className="says">“{playerText(p.says)}”</p>}
      {p.thinks && <p className="thinks">{playerText(p.thinks)}</p>}
      <Bar label="Stress" value={p.stress} tone="fill-coral"/>
      <Bar label="Burnout" value={p.burnout} tone="fill-gold"/>
      <Bar label="Trust" value={p.trust} tone="fill-mint"/>
    </button>)}
  </div>;
}

/** Wellbeing / rumour charts plus the order in which people cracked. */
export function ChartDrawer({ history, state, people, truth, onTruth }: {
  history: TickFrame[]; state: SimulationState | null; people: Person[]; truth: boolean; onTruth: (v: boolean) => void;
}) {
  const [view, setView] = useState<'wellbeing' | 'reach'>('wellbeing');
  const order = state?.metrics.crack_order ?? [];
  const first = state?.metrics.first_quit_tick ?? null;
  return <>
    <div className="company-tabs">{(['wellbeing', 'reach'] as const).map(v =>
      <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v === 'wellbeing' ? 'Wellbeing' : 'Rumour reach'}</button>)}</div>
    <Company history={history} view={view} truth={truth} onTruth={onTruth}/>
    <section className="o3-crack">
      <h3>Crack order</h3>
      {order.length ? <ol>{order.map(id => <li key={id}>{people.find(p => p.id === id)?.name ?? id}</li>)}</ol> : <p className="empty-state">Nobody has cracked yet</p>}
      {first !== null && <p className="metric-note">First resignation: {timeLabel(first)}</p>}
    </section>
  </>;
}
