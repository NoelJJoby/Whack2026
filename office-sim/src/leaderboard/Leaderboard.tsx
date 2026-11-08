import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { board, type BoardRow, type LeaderboardFile } from '../../shared/leaderboard';
import { lookFor, Sprite } from '../people';
import results from './leaderboard.json';
import './leaderboard.css';

const data = results as unknown as LeaderboardFile;
const ceoLook = lookFor('CEO', 0);

function Sparkline({ prices }: { prices: number[] }) {
  if (prices.length < 2) return null;
  const min = Math.min(...prices); const max = Math.max(...prices); const span = max - min || 1;
  const d = prices.map((p, i) => `${i ? 'L' : 'M'}${(i / (prices.length - 1) * 96).toFixed(1)},${(22 - (p - min) / span * 20).toFixed(1)}`).join(' ');
  return <svg className={`lb-spark ${prices.at(-1)! >= prices[0] ? 'up' : 'down'}`} viewBox="0 0 96 24" aria-hidden="true"><path d={d}/></svg>;
}

const fmt = (raw: number, digits: number, unit: string) => `${raw.toFixed(digits)}${unit}`;

function Row({ row, open, onToggle }: { row: BoardRow; open: boolean; onToggle: () => void }) {
  const baseline = row.entry.kind === 'baseline';
  return <>
    <button className="lb-row" aria-expanded={open} onClick={onToggle}>
      <span className="lb-rank">{row.rank}</span>
      <span className="lb-portrait" style={{ borderColor: row.entry.color }}><Sprite person={{ ...ceoLook, color: row.entry.color }} crop/></span>
      <span className="lb-name">{row.entry.name}{baseline && <small className="lb-tag">baseline</small>}
        {row.badges.length > 0 && <span className="lb-badges">{row.badges.map(b => <i key={b}>{b}</i>)}</span>}</span>
      <Sparkline prices={row.representative.prices}/>
      <span className="lb-score"><strong>{Math.round(row.score)}</strong><small>{Math.round(row.min)}–{Math.round(row.max)}</small></span>
    </button>
    {open && <dl className="lb-detail">
      {row.metrics.map(m => <div key={m.def.id} className={m.spread ? '' : 'flat'}>
        <dt>{m.def.label}</dt>
        <dd><strong>{fmt(m.raw, m.def.digits, m.def.unit)}</strong><small>{Math.round(m.score)}/100</small></dd>
      </div>)}
      <div><dt>Shareholders · People</dt><dd><strong>{Math.round(row.shareholders)} · {Math.round(row.people)}</strong></dd></div>
      {row.entry.kind === 'model' && <div><dt>Valid CEO decisions</dt><dd><strong>{row.ceo.decisions - row.ceo.fallbacks}/{row.ceo.decisions}</strong></dd></div>}
    </dl>}
  </>;
}

export function Leaderboard({ file = data }: { file?: LeaderboardFile }) {
  const [w, setW] = useState(0.5);
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => board(file, w), [file, w]);
  // FLIP: rows slide from their old position to their new rank (the global reduced-motion rule disables it).
  const items = useRef(new Map<string, HTMLLIElement>());
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    for (const [id, el] of items.current) {
      const top = el.getBoundingClientRect().top; const before = tops.current.get(id);
      tops.current.set(id, top);
      if (before === undefined || Math.abs(before - top) < 1) continue;
      el.style.transition = 'none'; el.style.transform = `translateY(${before - top}px)`;
      requestAnimationFrame(() => { el.style.transition = ''; el.style.transform = ''; });
    }
  });
  if (!file.runs.length) return <p className="empty-state">No results yet: pnpm exec tsx server/scripts/leaderboard.ts</p>;
  return <section className="leaderboard" aria-label="Best Boss leaderboard">
    <label className="lb-weight">
      <span>Shareholders</span>
      <input type="range" min={0} max={1} step={0.05} value={w} onChange={e => setW(Number(e.target.value))}
        aria-label="What best means" aria-valuetext={`${Math.round((1 - w) * 100)}% shareholders, ${Math.round(w * 100)}% people`}/>
      <span>People</span>
    </label>
    <ol className="lb-rows">
      {rows.map(row => <li key={row.entry.id} className={row.entry.kind} ref={el => { if (el) items.current.set(row.entry.id, el); else items.current.delete(row.entry.id); }}>
        <Row row={row} open={open === row.entry.id} onToggle={() => setOpen(open === row.entry.id ? null : row.entry.id)}/>
      </li>)}
    </ol>
  </section>;
}
