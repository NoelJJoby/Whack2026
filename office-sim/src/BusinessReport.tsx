import { useEffect, useState } from 'react';
import type { BusinessReport as Report, RunMetadata } from '../shared/reports';
import type { World } from '../server/engine-types';
import type { AgentProfile } from '../shared/types';
import { api } from './useSimulation';
import { EventDetail, money } from './EventDetail';
interface Archive { metadata: RunMetadata; world: World; reports: Report[]; pending: boolean; }
/** The scorecard figures from the report's facts; reports made before the scorecard have none. */
function ReportCard({ m }: { m: Record<string, number> }) {
  if (m.scoreProductivity === undefined) return null;
  const f = (v: number | undefined, d = 0) => v === undefined ? '—' : v.toFixed(d);
  const rows: Array<[string, string, string]> = [
    ['Stock price', f(m.scorePrice, 2), `Started at ${f(m.scoreStartPrice, 2)}`],
    ['Retention', m.scoreRetention === undefined ? '—' : `${f(m.scoreRetention)}%`, `${f(m.scoreQuits)} resigned · ${f(m.scoreLayoffs)} laid off`],
    ['Morale', f(m.scoreMorale), `Started at ${f(m.scoreStartMorale)}`],
    ['Trust', f(m.scoreTrust), `Started at ${f(m.scoreStartTrust)}`],
    ['Rumour control', f(m.scorePeakFalseReach), `Peak false-claim reach · ${f(m.scoreLeaks)} press leaks`],
    ['Productivity', `${f(m.scoreProductivity)}%`, 'Staff-hours on sustainable work; overwork counts half'],
  ];
  return <section className="report-card" aria-label="Report card"><h4>Report card</h4>
    <dl className="score-tiles">{rows.map(([label, value, detail]) => <div className="score-tile" key={label}><dt>{label}</dt><dd><strong>{value}</strong><small>{detail}</small></dd></div>)}</dl>
  </section>;
}
export function BusinessReport({ runId, tick, status, cast }: { runId?: string; tick: number; status?: string; cast: AgentProfile[] }) {
  const [runs,setRuns] = useState<RunMetadata[]>([]);
  const [chosen,setChosen] = useState(runId ?? '');
  const [archive,setArchive] = useState<Archive | null>(null);
  const [sourceWorld,setSourceWorld] = useState<World | null>(null);
  const [version,setVersion] = useState<string | null>(null);
  const [source,setSource] = useState<string | null>(null);
  const [error,setError] = useState<string | null>(null);
  const [busy,setBusy] = useState(false);
  useEffect(() => { let active = true; api<RunMetadata[]>('/runs').then(r => { if (active) setRuns(r); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; },[runId,tick,status]);
  useEffect(() => { let active = true; setArchive(null); setVersion(null); setSource(null); if (chosen) api<Archive>(`/runs/${chosen}`).then(r => { if (active) setArchive(r); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; },[chosen,tick,status]);
  const report = archive?.reports.find(r => r.id === version) ?? archive?.reports.at(-1);
  useEffect(() => { let active = true; setSourceWorld(null); if (report) api<Archive>(`/runs/${report.runId}?cutoff=${report.cutoff}`).then(r => { if (active) setSourceWorld(r.world); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; },[report?.id]);
  const event = sourceWorld?.eventState.cases.find(e => e.id === source || e.evidence.includes(source ?? '') || e.tasks.includes(source ?? '') || e.decisions.includes(source ?? '') || e.ledger.includes(source ?? '') || source?.startsWith(`${e.id}-milestone`));
  async function generate() {
    setBusy(true); setError(null);
    try { await api(`/runs/${chosen}/report`,{ method: 'POST', body: { regenerate: true } }); setArchive(await api<Archive>(`/runs/${chosen}`)); setVersion(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Report unavailable.'); } finally { setBusy(false); }
  }
  return <section className="business-report" aria-label="Business report">
    <h3>Business report and archives</h3>
    <label>Run <select value={chosen} onChange={e => setChosen(e.target.value)}>{runs.map(r => <option key={r.id} value={r.id}>{r.id === runId ? 'Current run' : r.createdAt.slice(0,16)} · Seed {r.seed} · Tick {r.tick} · {r.status}</option>)}</select></label>
    {error && <p role="status" className="coral">{error}</p>}
    {archive?.pending && <p role="status">AI analyst preparing the report…</p>}
    {!report && <p>{archive?.metadata.status === 'complete' ? 'The completed run report is being prepared.' : 'This run is still in progress or was archived early. You can request a report at its current cutoff.'}</p>}
    <button className="report-action" onClick={() => void generate()} disabled={busy || !chosen}>{busy ? 'Preparing report…' : report ? 'Regenerate report' : 'Generate report at this cutoff'}</button>
    {report && <>
      <label>Version <select value={report.id} onChange={e => setVersion(e.target.value)}>{archive?.reports.map(r => <option key={r.id} value={r.id}>Version {r.version} · Tick {r.tick} · {r.status === 'ready' ? 'AI analysis' : 'Factual fallback'}</option>)}</select></label>
      <p>Report covers tick {report.tick}. {archive && archive.world.tick > report.tick && 'This report is from an earlier cutoff; the run has continued.'}</p>
      {report.limitation && <p role="status" className="gold">{report.limitation}</p>}
      <div className="report-downloads"><a href={`/api/runs/${report.runId}/reports/${report.id}?format=markdown`} download>Download Markdown</a><a href={`/api/runs/${report.runId}/reports/${report.id}`} download="business-report.json">Download JSON evidence</a></div>
      <ReportCard m={report.facts.metrics}/>
      {report.sections.map((s,i) => <section key={i}><h4>{s.title}</h4>{s.observations.map((o,j) => <div className="report-observation" key={j}><p>{o.assessment === 'recommendation' && <strong>Recommendation: </strong>}{o.text}</p>{o.metricIds.filter(id => !id.startsWith('score') && id in report.facts.metrics).map(id => <p key={id}>{id}: {['cash','bookings','revenue','receivables','costs','target','quarterRevenue','startingCash'].includes(id) ? money(report.facts.metrics[id],report.facts.currency) : report.facts.metrics[id].toFixed(1)}</p>)}<div className="evidence-links">{o.evidenceIds.map(id => <button key={id} onClick={() => setSource(id)}>Source: {id}</button>)}</div></div>)}</section>)}
      {source && <section className="report-source" tabIndex={0}><h4>Source evidence</h4><p>{report.facts.evidence.find(e => e.id === source)?.text}</p>{event && sourceWorld && <EventDetail event={event} events={sourceWorld.eventState} business={sourceWorld.business} cast={Object.values(sourceWorld.agents).map(a => a.profile)}/>}</section>}
    </>}
  </section>;
}
