import type { TickFrame } from '../shared/api';
import { timeLabel } from './hudModel';

function averages(frame: TickFrame) {
  const active = Object.values(frame.state.agents).filter(a => a.status === 'active');
  const avg = (key: 'stress' | 'trust_mgmt' | 'burnout') => active.length ? Math.round(active.reduce((n, a) => n + a[key], 0) / active.length) : 0;
  return { stress: avg('stress'), trust: avg('trust_mgmt'), burnout: avg('burnout') };
}
function chartPath(values: number[], max: number) {
  if (!values.length) return '';
  return values.map((value, i) => `${i ? 'L' : 'M'}${40 + i / Math.max(1, values.length - 1) * 500},${150 - value / Math.max(1, max) * 130}`).join(' ');
}
export function Company({ history, view: tab, truth, onTruth }: { history: TickFrame[]; view: 'wellbeing' | 'reach'; truth: boolean; onTruth: (value: boolean) => void }) {
  const series = history.map(averages);
  const current = series.at(-1);
  const trueReach = history.map(f => f.state.metrics.true_reach);
  const falseReach = history.map(f => f.state.metrics.false_reach);
  const traces = tab === 'wellbeing' ? [
    { name: 'Stress', value: current?.stress, color: '#e8947f', values: series.map(s => s.stress), dash: '' },
    { name: 'Trust in management', value: current?.trust, color: '#8abca2', values: series.map(s => s.trust), dash: '7 3' },
    { name: 'Burnout', value: current?.burnout, color: '#d7b66c', values: series.map(s => s.burnout), dash: '2 3' },
  ] : [
    { name: 'True claims', value: trueReach.at(-1), color: '#8abca2', values: trueReach, dash: '' },
    { name: 'False claims', value: falseReach.at(-1), color: '#e8947f', values: falseReach, dash: '5 4' },
  ];
  const max = tab === 'wellbeing' ? 100 : Math.max(1, ...trueReach, ...falseReach);
  return <div className="company-view">
      <h3>{tab === 'wellbeing' ? 'Active employee averages' : 'Employees reached by claims'}</h3>
      <div className="chart-key">{traces.map(t => <span key={t.name}><i style={{ borderColor: t.color, borderStyle: t.dash ? 'dashed' : 'solid' }}/>{t.name} <b>{t.value ?? '—'}{tab === 'wellbeing' && t.value !== undefined ? '/100' : ''}</b></span>)}</div>
      {history.length ? <><svg className="company-chart" viewBox="0 0 560 180" role="img" aria-label={`${tab === 'wellbeing' ? 'Average stress, trust in management and burnout' : 'True and false claim reach'} over ${history.length} hours. ${traces.map(t => `${t.name}: ${t.value}`).join('. ')}`}>
        {[0, max / 2, max].map(v => <g key={v}><path d={`M40 ${150 - v / max * 130}H540`} stroke="#435149" strokeDasharray="3 5"/><text x="30" y={154 - v / max * 130} textAnchor="end">{Number(v.toFixed(1))}</text></g>)}
        {traces.map(t => <path key={t.name} d={chartPath(t.values, max)} fill="none" stroke={t.color} strokeWidth="3" strokeDasharray={t.dash}/>)}
      </svg><div className="chart-axis"><span>{timeLabel(history[0].tick)}</span><span>{timeLabel(history.at(-1)!.tick)}</span></div></> : <p className="empty-state">No history yet</p>}
      <details className="data-history"><summary>View recorded hours</summary><div className="data-table-scroll"><table><thead><tr><th>Time</th>{traces.map(t => <th key={t.name}>{t.name}</th>)}</tr></thead><tbody>{history.map((f, i) => <tr key={f.tick}><th>{timeLabel(f.tick)}</th>{traces.map(t => <td key={t.name}>{t.values[i]}</td>)}</tr>)}</tbody></table></div></details>
    <label className="truth-toggle"><input type="checkbox" checked={truth} onChange={e => onTruth(e.target.checked)}/> Reveal truth in Office wire</label>
  </div>;
}
