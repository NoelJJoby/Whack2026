import { useState } from 'react';
import type { PriceDTO, TickFrame } from '../shared/api';
import { MenuPanel } from './GamePanel';
import { timeLabel } from './hudModel';

interface StockProps {
  history: TickFrame[];
  current?: PriceDTO | null;
  initialPrice?: number;
}

/** The server owns valuation; this adapter only projects its recorded prices. */
export function stockSeries(history: TickFrame[], initialPrice = 100, current?: PriceDTO | null) {
  const points = [{ tick: 0, price: initialPrice }, ...history.map(frame => ({ tick: frame.tick, price: frame.price.price }))];
  // A current snapshot can arrive before its history frame. Keep the line joined
  // to the price shown in the HUD without changing the recorded history.
  if (current && current.tick >= points.at(-1)!.tick) {
    const point = { tick: current.tick, price: current.price };
    if (current.tick === points.at(-1)!.tick) points[points.length - 1] = point;
    else points.push(point);
  }
  return points;
}

export function StockChart({ history, current, initialPrice = 100 }: StockProps) {
  const points = stockSeries(history, initialPrice, current);
  const price = current?.price ?? points.at(-1)!.price;
  const change = 100 * (price / initialPrice - 1);
  const min = Math.floor(Math.min(price, ...points.map(p => p.price)) - 5);
  const max = Math.ceil(Math.max(price, ...points.map(p => p.price)) + 5);
  const lastTick = Math.max(1, points.at(-1)!.tick);
  const path = points.map((point, i) => `${i ? 'L' : 'M'}${50 + point.tick / lastTick * 600} ${200 - (point.price - min) / (max - min) * 170}`).join(' ');
  return <section className="stock-information" aria-label="Stock performance">
    <div className="stock-value">${price.toFixed(2)} <span className={change >= 0 ? 'mint' : 'coral'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}% since opening</span></div>
    <svg className="stock-chart" viewBox="0 0 700 240" role="img" aria-label={`Simulated stock price $${price.toFixed(2)}, from $${initialPrice.toFixed(2)} over ${points.at(-1)!.tick} hours.`}>{[min, (min + max) / 2, max].map(value => { const y = 200 - (value - min) / (max - min) * 170; return <g key={value}><path d={`M50 ${y}H650`} stroke="#435149" strokeDasharray="4 6"/><text x="0" y={y + 4}>${value.toFixed(0)}</text></g>; })}<path d={path} stroke={change >= 0 ? '#8abca2' : '#e8947f'} strokeWidth="3" fill="none"/><circle cx={50 + points.at(-1)!.tick / lastTick * 600} cy={200 - (price - min) / (max - min) * 170} r="5" fill="#d7b66c"/></svg>
    <div className="chart-axis"><span>Opening</span><span>{timeLabel(points.at(-1)!.tick)}</span></div>
    <p className="metric-note">Price reflects workforce output, public news and market movement.</p>{history.length === 0 && <p className="empty-state">No price history yet</p>}
  </section>;
}

/** The HUD can share the game's exclusive menu state, or own its chart when used alone. */
/** Last ~20 recorded prices as a tiny polyline; green when the latest move is up, red when down. */
function Sparkline({ history, current, initialPrice }: StockProps) {
  const prices = stockSeries(history, initialPrice, current).slice(-20).map(p => p.price);
  if (prices.length < 2) return null;
  const min = Math.min(...prices), max = Math.max(...prices), span = max - min || 1;
  const points = prices.map((p, i) => `${(i / (prices.length - 1)) * 96 + 2},${30 - ((p - min) / span) * 26}`).join(' ');
  const up = prices.at(-1)! >= prices.at(-2)!;
  return <svg className={`sparkline ${up ? 'up' : 'down'}`} viewBox="0 0 100 32" aria-hidden="true"><polyline points={points} fill="none" strokeWidth="2.5" strokeLinejoin="round"/></svg>;
}

export function StockPrice({ history, current, initialPrice = 100, onOpen, expanded = false, sparkline = false }: StockProps & { onOpen?: () => void; expanded?: boolean; sparkline?: boolean }) {
  const [open, setOpen] = useState(false);
  const price = current?.price ?? history.at(-1)?.price.price ?? initialPrice;
  const change = 100 * (price / initialPrice - 1);
  return <>
    <button className="stock-ticker" onClick={() => onOpen ? onOpen() : setOpen(true)} aria-haspopup="dialog" aria-expanded={onOpen ? expanded : open} aria-label={`Open CHAOS stock chart, price $${price.toFixed(2)}`} title="Open stock chart">
      <span>CHAOS</span>
      <strong>${price.toFixed(2)} <em className={change >= 0 ? 'mint' : 'coral'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</em></strong>
      {sparkline && <Sparkline history={history} current={current} initialPrice={initialPrice}/>}
    </button>
    {!onOpen && open && <MenuPanel title="CHAOS stock" onClose={() => setOpen(false)}><StockChart history={history} current={current} initialPrice={initialPrice}/></MenuPanel>}
  </>;
}
