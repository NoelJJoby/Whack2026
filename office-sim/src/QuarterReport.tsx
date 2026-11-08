import { useEffect, useState } from 'react';
import type { BusinessReport as Report, QuarterFacts, QuarterHighlight, QuarterRecap } from '../shared/reports';
import { api } from './useSimulation';
import { money } from './EventDetail';
import { timeLabel } from './hudModel';
import { BusinessReport } from './BusinessReport';

function PriceTimeline({ facts: f, recap }: { facts: QuarterFacts; recap: QuarterRecap }) {
  const min = f.metrics.lowestPrice, span = Math.max(1,f.metrics.highestPrice-min);
  const x = (tick: number) => 30+(tick-f.startTick)/Math.max(1,f.endTick-f.startTick)*600;
  const y = (price: number) => 170-(price-min)/span*140;
  const highlighted = [recap.bestMove,recap.biggestBlunder].flatMap(h => {
    const c = f.candidates.find(c => c.id === h?.candidateId);
    const p = f.prices.find(p => p.tick === c?.tick);
    return c && p ? [{ c,p }] : [];
  });
  return <figure className="quarter-chart"><svg viewBox="0 0 660 210" role="img" aria-label={`Quarter ${f.quarter} recorded stock prices. Peak ${f.peak.price.toFixed(2)} at ${f.peak.label}.`}>
    <path d="M30 175H630" stroke="var(--border)"/>
    <path d={f.prices.map((p,i) => `${i ? 'L' : 'M'}${x(p.tick)} ${y(p.price)}`).join(' ')} fill="none" stroke="var(--mint)" strokeWidth="3"/>
    {highlighted.map(({ c,p }) => <g key={c.id}><path d={`M${x(p.tick)} 20V175`} stroke="var(--muted)" strokeDasharray="3 5"/><circle cx={x(p.tick)} cy={y(p.price)} r="4" fill="var(--muted)"/><title>{c.actor.name}: {c.action} · {timeLabel(c.tick)}</title></g>)}
    <circle cx={x(f.peak.tick)} cy={y(f.peak.price)} r="6" fill="var(--gold)"/><text x="30" y="202">Opening</text><text x="630" y="202" textAnchor="end">Closing</text>
  </svg><figcaption>Gold marks the price peak. Story markers show timing; they do not establish what caused the price.</figcaption></figure>;
}
function Highlight({ label, highlight, facts, pending }: { label: 'Best Move' | 'Biggest Blunder'; highlight: QuarterHighlight | null; facts: QuarterFacts; pending: boolean }) {
  const candidate = facts.candidates.find(c => c.id === highlight?.candidateId);
  const fallback = facts.candidates.find(c => c.outcome === (label === 'Best Move' ? 'positive' : 'negative'));
  return <article className="quarter-headline"><h4>{label}</h4>
    {pending ? <p role="status">AI assessment pending…</p> : highlight && candidate ? <>
      <small>AI assessment</small><h3>{highlight.title}</h3>
      <p><strong>{candidate.actor.role === 'ceo' ? 'Simulated CEO' : candidate.actor.role === 'ops' ? 'Ops' : candidate.actor.role} · {candidate.actor.name}</strong></p>
      <p>{candidate.action} · {timeLabel(candidate.decisionTick)}{candidate.carryForward && ' · Action carried forward from an earlier quarter'}</p>
      <p>{highlight.explanation}</p>
    </> : <p>{label === 'Best Move' ? 'No clear standout move' : 'No clear blunder recorded'}</p>}
    {!highlight && !pending && fallback && <details><summary>Recorded outcome · factual</summary><p>{fallback.actor.name} ({fallback.actor.role}): {fallback.action}</p><blockquote>{fallback.excerpt}</blockquote></details>}
  </article>;
}
/** Shared by the end screen and retained detailed report versions. */
export function QuarterResults({ report }: { report: Report }) {
  if (!report.quarterSummary) return null;
  return <div className="quarter-results">{report.quarterSummary.quarters.map(({ facts: f, recap: r }) => <section key={f.hash} aria-label={`Quarter ${f.quarter} results`}>
    <h3>{f.partial ? 'Run summary · partial quarter' : 'Quarter complete'} · Q{f.quarter}</h3>
    <p className="quarter-verdict" role="status">{r.status === 'pending' ? 'Your results are ready. The AI analyst is preparing a short recap…' : r.status === 'ready' ? r.summary : 'AI recap unavailable. These results use committed simulation evidence.'}</p>
    <div className="quarter-headlines">
      <article className="quarter-headline"><h4>Highest Stock Price</h4><strong className="quarter-peak">${f.peak.price.toFixed(2)}</strong><p>{f.peak.label}</p><p>{f.metrics.peakReturnPercent >= 0 ? '+' : ''}{f.metrics.peakReturnPercent.toFixed(2)}% from quarter opening</p></article>
      <Highlight label="Best Move" highlight={r.bestMove} facts={f} pending={r.status === 'pending'}/>
      <Highlight label="Biggest Blunder" highlight={r.biggestBlunder} facts={f} pending={r.status === 'pending'}/>
    </div>
    <PriceTimeline facts={f} recap={r}/>
    <dl className="score-tiles">{[
      ['Closing stock',`$${f.metrics.closingPrice.toFixed(2)}`,`${f.metrics.returnPercent.toFixed(2)}% return`],
      ['Revenue earned',money(f.metrics.revenue,f.currency),`Target ${money(f.metrics.target,f.currency)}`],
      ['Closing cash',money(f.metrics.cash,f.currency),`Opened at ${money(f.metrics.openingCash,f.currency)}`],
      ['Staff retained',`${f.metrics.retention.toFixed(0)}%`,`${f.metrics.headcount} active staff`],
      ['Morale',f.metrics.morale.toFixed(1),`${f.metrics.moraleChange.toFixed(1)} point change`],
      ['Trust',f.metrics.trust.toFixed(1),`${f.metrics.trustChange.toFixed(1)} point change`],
    ].map(([label,value,detail]) => <div className="score-tile" key={label}><dt>{label}</dt><dd><strong>{value}</strong><small>{detail}</small></dd></div>)}</dl>
    {r.lessons.length > 0 && <section><h4>Next quarter</h4><ul>{r.lessons.map((l,i) => <li key={i}>{l.text}</li>)}</ul></section>}
  </section>)}
  </div>;
}

export function QuarterReport({ runId, status, onFullReport, onClose, onNewRun }: { runId: string; status?: string; onFullReport: () => void; onClose: () => void; onNewRun: () => void }) {
  const [report,setReport] = useState<Report | null>(null);
  const [error,setError] = useState<string | null>(null);
  const [busy,setBusy] = useState(false);
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const archive = await api<{ reports: Report[]; pending: boolean }>(`/runs/${runId}`);
        if (!active) return;
        setReport(archive.reports.at(-1) ?? null); setError(null);
        if (archive.pending || !archive.reports.length) timer = setTimeout(() => void refresh(),1000);
      } catch { if (active) { setError('Could not load the saved report. Reconnecting…'); timer = setTimeout(() => void refresh(),2000); } }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  },[runId,status,busy]);
  const pending = report?.quarterSummary?.quarters.some(q => q.recap.status === 'pending');
  const unavailable = report?.quarterSummary?.quarters.some(q => q.recap.status === 'unavailable');
  async function retry() {
    setBusy(true); setError(null);
    try { const next = await api<Report>(`/runs/${runId}/recap`,{ method: 'POST',body: {} }); setReport(next); }
    catch { setError('AI recap unavailable. Your saved results remain available.'); }
    finally { setBusy(false); }
  }
  return <section className="quarter-report" aria-label="End of Quarter">
    <p className="metric-note">CHAOS · Run {runId}</p>
    {error && <p role="status" className="coral">{error}</p>}
    {!report && <p role="status">Loading committed results…</p>}
    {report && <QuarterResults key={report.id} report={report}/>}
    {report && !report.quarterSummary && <BusinessReport runId={runId} tick={report.tick} status={status} cast={[]}/>}
    <div className="quarter-actions">
      <button onClick={onFullReport}>View full report</button><button onClick={onClose}>Back to office</button>
      {report && <a href={`/api/runs/${runId}/reports/${report.id}?format=markdown`} download>Download report</a>}
      {unavailable && <button disabled={busy || pending} onClick={() => void retry()}>{busy ? 'Preparing AI recap…' : 'Retry AI recap'}</button>}
      <button onClick={onNewRun}>New run</button>
    </div>
  </section>;
}
