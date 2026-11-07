import { useState } from 'react';
import type { PriceDTO, TickFrame } from '../shared/api';

const amount = (n: number) => n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(4)}`;
const label = (s: string) => s.replaceAll('_', ' ');

export function PriceChart({ history, current, initialPrice, feedback, disabled, onFeedback }: {
  history: TickFrame[]; current: PriceDTO | null; initialPrice: number | null;
  feedback: boolean; disabled: boolean; onFeedback: (enabled: boolean) => void;
}) {
  const [hoverTick, setHoverTick] = useState<number | null>(null);
  const records = history.map(f => f.price);
  const detail = hoverTick === 0 ? null : records.find(p => p.tick === hoverTick) ?? current;
  const points = initialPrice === null ? [] : [{ tick: 0, price: initialPrice }, ...records];
  const low = Math.min(...points.map(p => p.price));
  const high = Math.max(...points.map(p => p.price));
  const padding = Math.max((high - low) * 0.15, high * 0.02, 0.0000001);
  const x = (tick: number) => 55 + tick / Math.max(1, current?.tick ?? 0) * 800;
  const y = (price: number) => 155 - (price - low + padding) / (high - low + 2 * padding) * 130;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.tick)} ${y(p.price)}`).join(' ');
  return <section className="panel price-panel" aria-labelledby="price-title">
    <div className="price-heading"><div><small>THE MARKET VIEW</small><h2 id="price-title">Company share price <strong>{current ? amount(current.price) : '—'}</strong></h2>
      <span className={current && current.ret < 0 ? 'coral' : 'mint'}>{current ? `${signed(100 * current.ret)}% log return · tick ${current.tick}` : 'Waiting for the simulation'}</span></div>
      <label className="price-feedback"><input type="checkbox" checked={feedback} disabled={disabled} onChange={e => onFeedback(e.target.checked)} /> Price feedback
        <small>{disabled ? 'Reset to change for the next run' : 'Applies to the whole run · off by default'}</small></label>
    </div>
    <div className="price-chart" onMouseLeave={() => setHoverTick(null)}>
      <svg viewBox="0 0 900 195" role="group" aria-label={`Company share price from tick zero to tick ${current?.tick ?? 0}. Points show valuation details.`}>
        {points.length > 0 && <>
          {[low, high].filter((v, i, a) => a.indexOf(v) === i).map(v => <g key={v}><path d={`M55 ${y(v)}H855`} stroke="var(--border)" strokeDasharray="3 6" /><text x="2" y={y(v) - 5}>{amount(v)}</text></g>)}
          <path d={path} fill="none" stroke="var(--mint)" strokeWidth="2.5" />
          <text x="55" y="188">TICK 0</text><text x="855" y="188" textAnchor="end">TICK {current?.tick ?? 0}</text>
          {points.map(p => {
            const record = records.find(r => r.tick === p.tick);
            const headlines = record?.markers.filter(m => m.event === 'headline') ?? [];
            const corrections = record?.markers.filter(m => m.event === 'correction') ?? [];
            const description = `Tick ${p.tick}: ${amount(p.price)}${headlines.length ? `; ${headlines.map(m => label(m.kind)).join(', ')}` : ''}${corrections.length ? `; market correction: ${corrections.map(m => label(m.kind)).join(', ')}` : ''}`;
            return <g key={p.tick} tabIndex={0} role="button" aria-label={description} onFocus={() => setHoverTick(p.tick)} onBlur={() => setHoverTick(null)} onMouseEnter={() => setHoverTick(p.tick)} onClick={() => setHoverTick(p.tick)}>
              <title>{description}</title><circle cx={x(p.tick)} cy={y(p.price)} r="10" fill="transparent" />
              <circle cx={x(p.tick)} cy={y(p.price)} r={headlines.length ? 4 : 2.5} fill={headlines.length ? 'var(--gold)' : 'var(--mint)'} />
              {corrections.length > 0 && <path d={`M${x(p.tick)} ${y(p.price) - 12}l5 5l-5 5l-5 -5Z`} fill="var(--coral)" />}
            </g>;
          })}
        </>}
      </svg>
    </div>
    <div className="price-legend"><span className="mint">● Price</span><span className="gold">● Headline / leak</span><span className="coral">◆ Market correction</span><span>Hover or focus a point for details</span></div>
    {hoverTick === 0 && initialPrice !== null && <div className="price-detail"><b>TICK 0 · {amount(initialPrice)}</b><span>Initial valuation · zero return, news and noise. Smoothed output starts at the calibrated reference.</span></div>}
    {detail && <div className="price-detail" aria-live="polite"><b>TICK {detail.tick} · {amount(detail.price)}</b>
      <span>Output <strong>{signed(detail.outputLog)}</strong></span><span>News <strong>{signed(detail.newsLevel)}</strong></span><span>Noise <strong>{signed(detail.noise)}</strong></span>
      <span>Active seats <strong>{detail.headcount}</strong></span><span>Morale <strong>{detail.morale === null ? 'No employees remain' : `${(detail.morale * 100).toFixed(1)} / 100`}</strong></span>
      <span className="price-detail-note">Contributions are log-price levels relative to the initial price. Output {detail.rawOutput.toFixed(3)} · smoothed {detail.oEma.toFixed(3)} · effective {detail.effectiveOutput.toFixed(3)}.</span>
      {detail.markers.length > 0 && <span className="price-detail-note">{detail.markers.map(m => `${m.event === 'correction' ? 'Market correction' : 'Headline'}: ${label(m.kind)}`).join(' · ')}</span>}
      {(detail.guards.outputFloor || detail.guards.priceBound) && <span className="coral">Guard applied: {detail.guards.outputFloor ? 'output floor ' : ''}{detail.guards.priceBound ? `${detail.guards.priceBound} price bound` : ''}. Raw log price {detail.guards.rawLogPrice.toFixed(4)} → {detail.guards.logPrice.toFixed(4)}.</span>}
    </div>}
  </section>;
}
