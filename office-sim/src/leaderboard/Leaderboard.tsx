import { useMemo, useState } from 'react';
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
const endPrice = (row: BoardRow) => row.metrics.find(m => m.def.id === 'endPrice')!.raw;

function Row({ row, initialPrice, open, onToggle }: { row: BoardRow; initialPrice: number; open: boolean; onToggle: () => void }) {
  const baseline = row.entry.kind === 'baseline';
  const change = (endPrice(row) / initialPrice - 1) * 100;
  return <>
    <button className="lb-row" aria-expanded={open} onClick={onToggle}>
      <span className="lb-rank">{row.rank}</span>
      <span className="lb-portrait" style={{ borderColor: row.entry.color }}><Sprite person={{ ...ceoLook, color: row.entry.color }} crop/></span>
      <span className="lb-name">{row.entry.name}{baseline && <small className="lb-tag">baseline</small>}
        {row.badges.length > 0 && <span className="lb-badges">{row.badges.map(b => <i key={b}>{b}</i>)}</span>}</span>
      <Sparkline prices={row.representative.prices}/>
      <span className={`lb-return ${change >= 0 ? 'up' : 'down'}`}><strong>{change >= 0 ? '+' : ''}{change.toFixed(1)}%</strong><small>stock return</small></span>
    </button>
    {open && <dl className="lb-detail">
      {row.metrics.map(m => <div key={m.def.id} className={m.spread ? '' : 'flat'}>
        <dt>{m.def.label}</dt>
        <dd><strong>{fmt(m.raw, m.def.digits, m.def.unit)}</strong><small>{Math.round(m.score)}/100</small></dd>
      </div>)}
      {row.entry.kind === 'model' && <div><dt>Valid CEO decisions</dt><dd><strong>{row.ceo.decisions - row.ceo.fallbacks}/{row.ceo.decisions}</strong></dd></div>}
    </dl>}
  </>;
}

export function Leaderboard({ file = data }: { file?: LeaderboardFile }) {
  const [open, setOpen] = useState<string | null>(null);
  // Every boss starts at the same price, so mean end price orders mean stock return.
  const rows = useMemo(() => board(file, 0)
    .sort((a, b) => endPrice(b) - endPrice(a) || a.entry.name.localeCompare(b.entry.name))
    .map((row, i) => ({ ...row, rank: i + 1 })), [file]);
  if (!file.runs.length) return <p className="empty-state">No results yet: pnpm exec tsx server/scripts/leaderboard.ts</p>;
  return <section className="leaderboard" aria-label="Best Boss leaderboard">
    {file.demo && <p className="lb-demo">Demo leaderboard · Fictional results, not model benchmarks.</p>}
    <p className="lb-order">Ranked by highest stock return</p>
    <ol className="lb-rows">
      {rows.map(row => <li key={row.entry.id} className={row.entry.kind}>
        <Row row={row} initialPrice={file.initialPrice ?? 100} open={open === row.entry.id} onToggle={() => setOpen(open === row.entry.id ? null : row.entry.id)}/>
      </li>)}
    </ol>
  </section>;
}
