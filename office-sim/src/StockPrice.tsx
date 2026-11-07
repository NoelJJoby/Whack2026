import { useEffect, useRef, useState } from 'react';
import type { TickFrame } from '../shared/api';

/** A presentation-only index, never fed back into agent decisions. */
export function stockSeries(history: TickFrame[]) {
  return [{ tick: 0, price: 100 }, ...history.map(frame => {
    const agents = Object.values(frame.state.agents);
    const average = (key: 'stress' | 'trust_mgmt' | 'burnout') => agents.length ? agents.reduce((sum, agent) => sum + agent[key], 0) / agents.length : 0;
    const quitShare = agents.length ? agents.filter(a => a.status === 'quit').length / agents.length : 0;
    const price = Math.max(1, 100 + (average('trust_mgmt') - 50) * 0.4 - (average('stress') - 30) * 0.25 - average('burnout') * 0.2 - quitShare * 20);
    return { tick: frame.tick, price: Math.round(price * 100) / 100 };
  })];
}
export function StockPrice({ history }: { history: TickFrame[] }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const points = stockSeries(history);
  const price = points.at(-1)!.price;
  const change = price - 100;
  const min = Math.floor(Math.min(...points.map(p => p.price)) - 5);
  const max = Math.ceil(Math.max(...points.map(p => p.price)) + 5);
  const lastTick = Math.max(1, points.at(-1)!.tick);
  const path = points.map((point, i) => `${i ? 'L' : 'M'}${50 + point.tick / lastTick * 600} ${200 - (point.price - min) / (max - min) * 170}`).join(' ');
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [open]);
  return <><button ref={trigger} className="stock-ticker" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={`Open simulated stock chart, price $${price.toFixed(2)}`}><span>CHAOS <small>SIMULATED STOCK ↗</small></span><strong>${price.toFixed(2)} <em className={change >= 0 ? 'mint' : 'coral'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</em></strong></button>
    <dialog ref={dialog} className="stock-dialog panel" aria-labelledby="stock-title" onCancel={() => setOpen(false)} onClose={() => { setOpen(false); trigger.current?.focus(); }} onClick={event => { if (event.target === dialog.current) { const bounds = dialog.current.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setOpen(false); } }}>
      <button className="close" autoFocus onClick={() => setOpen(false)} aria-label="Close stock chart">✕</button><span className="event-eyebrow">CHAOS / COMPANY PERFORMANCE</span><h2 id="stock-title">The cost of chaos.</h2><div className="stock-value">${price.toFixed(2)} <span className={change >= 0 ? 'mint' : 'coral'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}% since opening</span></div>
      <svg viewBox="0 0 700 240" role="img" aria-label={`Simulated stock price from $100 to $${price.toFixed(2)} across ${lastTick} ticks.`}>{[min, (min + max) / 2, max].map(value => { const y = 200 - (value - min) / (max - min) * 170; return <g key={value}><path d={`M50 ${y}H650`} stroke="#435149" strokeDasharray="4 6"/><text x="0" y={y + 4} fill="#9ca99c" fontSize="12">${value.toFixed(0)}</text></g>; })}<path d={path} stroke={change >= 0 ? '#8abca2' : '#e8947f'} strokeWidth="3" fill="none"/><circle cx={50 + points.at(-1)!.tick / lastTick * 600} cy={200 - (price - min) / (max - min) * 170} r="5" fill="#d7b66c"/><text x="50" y="230" fill="#9ca99c" fontSize="12">Opening</text><text x="650" y="230" textAnchor="end" fill="#9ca99c" fontSize="12">Tick {points.at(-1)!.tick}</text></svg>
      <p>Simulated indicator, starting at $100. Higher trust supports the price; stress, burnout and resignations lower it. This display does not affect simulation rules.</p>{history.length === 0 && <p className="gold">Start the simulation to build the price history.</p>}
    </dialog></>;
}
