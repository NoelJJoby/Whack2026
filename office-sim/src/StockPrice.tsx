import { useEffect, useRef, useState } from 'react';
import type { PriceDTO, TickFrame } from '../shared/api';

/** The server owns valuation; this adapter only projects its recorded prices. */
export function stockSeries(history: TickFrame[], initialPrice = 100) {
  return [{ tick: 0, price: initialPrice }, ...history.map(frame => ({ tick: frame.tick, price: frame.price.price }))];
}
export function StockPrice({ history, current, initialPrice = 100 }: { history: TickFrame[]; current?: PriceDTO | null; initialPrice?: number }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const points = stockSeries(history, initialPrice);
  const price = current?.price ?? points.at(-1)!.price;
  const change = 100 * (price / initialPrice - 1);
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
      <svg viewBox="0 0 700 240" role="img" aria-label={`Simulated stock price from $${initialPrice.toFixed(2)} to $${price.toFixed(2)} across ${lastTick} ticks.`}>{[min, (min + max) / 2, max].map(value => { const y = 200 - (value - min) / (max - min) * 170; return <g key={value}><path d={`M50 ${y}H650`} stroke="#435149" strokeDasharray="4 6"/><text x="0" y={y + 4} fill="#9ca99c" fontSize="12">${value.toFixed(0)}</text></g>; })}<path d={path} stroke={change >= 0 ? '#8abca2' : '#e8947f'} strokeWidth="3" fill="none"/><circle cx={50 + points.at(-1)!.tick / lastTick * 600} cy={200 - (price - min) / (max - min) * 170} r="5" fill="#d7b66c"/><text x="50" y="230" fill="#9ca99c" fontSize="12">Opening</text><text x="650" y="230" textAnchor="end" fill="#9ca99c" fontSize="12">Tick {points.at(-1)!.tick}</text></svg>
      <p>Simulated price, starting at ${initialPrice.toFixed(2)}. The server calculates it from workforce output, public news and seeded market noise. Price feedback is off by default.</p>{history.length === 0 && <p className="gold">Start the simulation to build the price history.</p>}
    </dialog></>;
}
