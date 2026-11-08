import { randomUUID } from 'node:crypto';
import type { BusinessReport, ReportFacts, ReportSection, QuarterSummary } from '../shared/reports';
import { RunStore, digest } from './run-store';
import { createMessageClient } from './llm/client';
import { parseReply } from './llm/parse';
import { reportSchema } from './llm/schemas';
import { buildReportPrompt, RECOMMENDATIONS, REPORT_TITLES } from './llm/report-prompt';
import { llmConfig } from './llm/config';
import type { EngineTickLog, World } from './engine-types';
import { productivity } from '../shared/scorecard';
import { DEFAULT_PARAMS } from './params';
import { buildQuarterSummaries, quarterOf, unavailableRecap } from './quarter-summary';
import { buildQuarterRecapPrompt, validateQuarterRecap } from './llm/quarter-recap-prompt';

/** Report-card metric ids, in display order; shared with the client's report card. */
export function scorecardMetrics(txs: Array<{ kind: string; tick: number; world: World; audit: unknown }>): Record<string, number> {
  const hours = txs.flatMap(tx => {
    const log = tx.kind === 'tick' ? (tx.audit as { log?: EngineTickLog } | null)?.log : undefined;
    return log ? [log.decisions.map(d => d.chosen.action)] : [];
  });
  const live = txs.at(-1)?.world.scorecard;
  const out: Record<string, number> = {};
  if (live) Object.assign(out, {
    scorePrice: live.price, scoreStartPrice: live.startPrice,
    scoreRetention: live.retention * 100, scoreQuits: live.quits, scoreLayoffs: live.layoffs,
    scoreMorale: live.morale, scoreStartMorale: live.startMorale, scoreTrust: live.trust, scoreStartTrust: live.startTrust,
    scorePeakFalseReach: live.peakFalseReach, scoreFalseReach: live.falseReach, scoreLeaks: live.leaks,
    ...(live.firstQuitTick !== null ? { scoreFirstQuitTick: live.firstQuitTick } : {}),
  });
  out.scoreProductivity = productivity(hours, DEFAULT_PARAMS.scorecard, DEFAULT_PARAMS.rules.actions.overwork.burnout) * 100;
  return out;
}
function scorecardText(m: Record<string, number>): string {
  const n = (v: number | undefined, d = 1) => v === undefined ? 'n/a' : v.toFixed(d);
  return [
    m.scorePrice !== undefined ? `Stock price ${n(m.scorePrice, 2)} (start ${n(m.scoreStartPrice, 2)}).` : '',
    m.scoreRetention !== undefined ? `Retention ${n(m.scoreRetention, 0)}% with ${m.scoreQuits} resignations and ${m.scoreLayoffs} layoffs.` : '',
    m.scoreMorale !== undefined ? `Morale ${n(m.scoreMorale)} (start ${n(m.scoreStartMorale)}); trust in management ${n(m.scoreTrust)} (start ${n(m.scoreStartTrust)}).` : '',
    m.scoreLeaks !== undefined ? `False-claim reach peaked at ${m.scorePeakFalseReach}; ${m.scoreLeaks} press leaks.` : '',
    `Productivity ${n(m.scoreProductivity, 0)}% of staff-hours spent on sustainable work.`,
  ].filter(Boolean).join(' ');
}
export function factsFor(store: RunStore, runId: string): ReportFacts {
  const txs = store.read(runId); const last = txs.at(-1); if (!last) throw new Error('Missing run evidence');
  const w = last.world; const b = w.business; const first = txs[0].world;
  const evidence: ReportFacts['evidence'] = [];
  for (const e of w.eventState.cases) {
    evidence.push({ id: e.id, tick: e.openedTick, text: `${e.headline}. Origin: ${e.origin}; ${e.rarity}, ${e.valence}. ${e.truth ? 'Recorded situation' : 'Unconfirmed information'}. Status: ${e.status}. ${e.outcome ?? 'Outcome remains open.'}` });
    evidence.push(...e.milestones.map((m,i) => ({ id: `${e.id}-milestone-${i+1}`, tick: m.tick, text: m.text })));
  }
  for (const e of w.eventState.evidence) evidence.push({ id: e.id, tick: e.tick, text: `${e.text} Source: ${e.source}. Recipients: ${e.recipients.join(', ')}. Certainty: ${e.certainty}.` });
  for (const d of w.eventState.decisions) evidence.push({ id: d.id, tick: d.tick, text: `${d.kind.toUpperCase()} response by ${d.author}: ${d.rationale} ${d.fallback ? `Decision source: ${d.fallback}.` : 'Validated AI decision.'} ${d.choices.map(c => c.optionId).join(', ')}` });
  for (const t of b.tasks) evidence.push({ id: t.id, tick: w.tick, text: `${t.title}. Status: ${t.status}; assigned to ${t.owner ?? 'unallocated'}.` });
  for (const r of b.work) evidence.push({ id: r.id, tick: r.tick, text: `${r.agent}: ${r.action} on ${r.taskId ?? 'no task'}. ${r.outcome}.` });
  for (const l of b.ledger) evidence.push({ id: l.id, tick: l.tick, text: `Ledger posting: ${l.category}; source ${l.source}; exact minor-unit amount ${l.amount}.` });
  const roots = w.eventState.cases.filter(e => e.rootId === e.id);
  const currentQuarter = b.quarters.at(-1)!;
  const quarterRevenue = b.ledger.filter(l => l.category === 'revenue' && quarterOf(l.tick) === currentQuarter.quarter).reduce((n,l) => n+l.amount,0);
  const metrics = { startingCash: first.business.cash, cash: b.cash, bookings: b.bookings, revenue: b.revenue, receivables: b.receivables, costs: b.costs,
    target: currentQuarter.salesTarget, quarterRevenue, targetAttainment: quarterRevenue/currentQuarter.salesTarget*100,
    positiveRoots: roots.filter(e => e.valence === 'positive').length, negativeRoots: roots.filter(e => e.valence === 'negative').length,
    commonRoots: roots.filter(e => e.rarity === 'common').length, rareRoots: roots.filter(e => e.rarity === 'rare').length,
    layoffs: Object.values(w.agents).filter(a => a.status === 'laid_off').length, resignations: w.quits.length,
    avoidedLayoffs: roots.filter(e => e.templateId === 'cost_review' && e.outcome?.includes('avoided')).length,
    headcount: w.ids.filter(id => w.agents[id].status === 'active').length, openCases: roots.filter(e => !['resolved','failed','cancelled','superseded'].includes(e.status)).length,
    completedTasks: b.tasks.filter(t => t.status === 'done').length, remainingTasks: b.tasks.filter(t => !['done','cancelled'].includes(t.status)).length,
    trust: average(w,'trust_mgmt'), burnout: average(w,'burnout'), startingTrust: average(first,'trust_mgmt'), startingBurnout: average(first,'burnout'),
    ...scorecardMetrics(txs) };
  evidence.unshift({ id: 'run-scorecard', tick: w.tick, text: scorecardText(metrics) });
  evidence.unshift({ id: 'run-metrics', tick: w.tick, text: 'Bookings record signed commitments. Revenue is earned by accepted delivery; collections change cash. Outstanding work and receivables remain obligations at this cutoff.' });
  const base = { runId, cutoff: last.sequence, tick: w.tick, currency: b.currency, metrics, evidence, unresolved: roots.filter(e => !['resolved','cancelled','superseded'].includes(e.status)).map(e => e.id) };
  return { ...base, hash: digest(base) };
}
function average(w: World, key: 'trust_mgmt' | 'burnout') { const active = w.ids.filter(id => w.agents[id].status === 'active'); return active.length ? active.reduce((n,id) => n+w.agents[id].state[key],0)/active.length : 0; }
export function validateReport(raw: unknown, facts: ReportFacts): ReportSection[] {
  const parsed = reportSchema.parse(raw);
  for (const section of parsed.sections) {
    if (!REPORT_TITLES.includes(section.title)) throw new Error('Unsupported section title');
    for (const o of section.observations) {
    if (o.evidenceIds.some(id => !facts.evidence.some(e => e.id === id)) || o.metricIds.some(id => !(id in facts.metrics))) throw new Error('Unknown report citation');
    if (o.assessment === 'observed' && !facts.evidence.some(e => o.evidenceIds.includes(e.id) && e.text === o.text)) throw new Error('Unsupported narrative claim');
    if (o.assessment === 'recommendation' && !(RECOMMENDATIONS as readonly string[]).includes(o.text)) throw new Error('Unsupported recommendation');
  }
  }
  return parsed.sections;
}
export function factualSections(f: ReportFacts): ReportSection[] {
  const observations = (items: typeof f.evidence) => items.map(e => ({ text: e.text, evidenceIds: [e.id], metricIds: [] as string[], assessment: 'observed' as const }));
  return [
    { title: 'Business performance', observations: [{ text: f.evidence[0].text, evidenceIds: ['run-metrics'], metricIds: ['cash','bookings','revenue','receivables','costs','targetAttainment'], assessment: 'observed' },
      ...f.evidence.filter(e => e.id === 'run-scorecard').map(e => ({ text: e.text, evidenceIds: [e.id], metricIds: Object.keys(f.metrics).filter(k => k.startsWith('score')), assessment: 'observed' as const }))] },
    { title: 'Event outcomes', observations: observations(f.evidence.filter(e => /^event-\d+-\d+$/.test(e.id))) },
    { title: 'Leadership decisions', observations: observations(f.evidence.filter(e => e.id.startsWith('decision-'))) },
    { title: 'Outstanding work', observations: observations(f.evidence.filter(e => f.unresolved.includes(e.id))) },
    { title: 'Recommendations', observations: [{ text: RECOMMENDATIONS[0], evidenceIds: ['run-metrics'], metricIds: ['remainingTasks'], assessment: 'recommendation' }] },
  ];
}
export type ReportProvider = (prompt: string, signal?: AbortSignal) => Promise<unknown>;
export class Reporting {
  private jobs = new Map<string,Promise<BusinessReport>>();
  private recapJobs = new Map<string, Promise<BusinessReport>>();
  constructor(private store: RunStore, private provider?: ReportProvider, private recapProvider?: ReportProvider, private recapBudgetMs = 10_000) {}
  private summary(runId: string): QuarterSummary | undefined {
    const journal = this.store.read(runId);
    // Legacy archives may have only opening/final snapshots: never invent a price peak.
    if (journal.filter(tx => tx.kind === 'tick').length !== journal.at(-1)!.tick) return undefined;
    return { schemaVersion: 1, promptVersion: 1, quarters: buildQuarterSummaries(runId, journal).map(facts => ({ facts, recap: unavailableRecap() })) };
  }
  private nextVersion(runId: string) { return Math.max(0,...this.store.reports(runId).map(r => r.version))+1; }
  /** Save usable facts before starting any network work. Completion never awaits this job. */
  completeRun(runId: string, onUpdate: () => void = () => {}): Promise<BusinessReport> {
    const facts = factsFor(this.store,runId);
    const existing = [...this.store.reports(runId)].reverse().find(r => r.cutoff === facts.cutoff && r.facts.hash === facts.hash && r.quarterSummary);
    if (existing) return this.recapJobs.get(this.recapKey(existing)) ?? Promise.resolve(existing);
    const report: BusinessReport = { id: randomUUID(), runId, version: this.nextVersion(runId), cutoff: facts.cutoff, tick: facts.tick,
      generatedAt: new Date().toISOString(), status: 'factual_fallback', limitation: 'Detailed report from committed evidence. AI quarter assessments are labelled separately.',
      facts, sections: factualSections(facts), schemaVersion: 1, promptVersion: 1, model: null, telemetry: [], quarterSummary: this.summary(runId) };
    if (!report.quarterSummary) throw new Error('Missing quarter tick evidence');
    const enabled = Boolean(this.recapProvider || process.env.ANTHROPIC_API_KEY?.trim());
    if (enabled) report.quarterSummary!.quarters.forEach(q => { q.recap.status = 'pending'; });
    this.store.saveReport(report);
    return enabled ? this.analyse(report,onUpdate) : Promise.resolve(report);
  }
  private recapKey(report: BusinessReport) {
    return `${report.runId}:${report.quarterSummary!.quarters.map(q => `${q.facts.quarter}:${q.facts.cutoff}:${q.facts.hash}`).join(':')}:recap-v1`;
  }
  retryRecap(runId: string, onUpdate: () => void = () => {}): Promise<BusinessReport> {
    const base = this.store.reports(runId).at(-1);
    if (!base?.quarterSummary) return this.completeRun(runId,onUpdate);
    const key = this.recapKey(base);
    if (this.recapJobs.has(key)) return this.recapJobs.get(key)!;
    const pending = structuredClone(base);
    pending.id = randomUUID(); pending.version = this.nextVersion(runId); pending.generatedAt = new Date().toISOString();
    pending.quarterSummary!.recoveryAttempted = false;
    pending.quarterSummary!.quarters.forEach(q => { q.recap = { ...unavailableRecap(), status: 'pending' }; });
    this.store.saveReport(pending); onUpdate();
    return this.analyse(pending,onUpdate);
  }
  recoverPending(onUpdate: () => void = () => {}) {
    for (const run of this.store.list()) {
      const report = this.store.reports(run.id).at(-1);
      if (!report?.quarterSummary?.quarters.some(q => q.recap.status === 'pending')) continue;
      if (report.quarterSummary.recoveryAttempted) {
        const failed = structuredClone(report);
        failed.id = randomUUID(); failed.version = this.nextVersion(run.id);
        failed.quarterSummary!.quarters.forEach(q => { if (q.recap.status === 'pending') q.recap = unavailableRecap(); });
        this.store.saveReport(failed);
      } else {
        report.quarterSummary.recoveryAttempted = true;
        this.store.saveReport(report);
        void this.analyse(report,onUpdate).catch(onUpdate);
      }
    }
  }
  private analyse(base: BusinessReport, onUpdate: () => void): Promise<BusinessReport> {
    const key = this.recapKey(base);
    if (this.recapJobs.has(key)) return this.recapJobs.get(key)!;
    const job = (async () => {
      const summary = structuredClone(base.quarterSummary!);
      const telemetry: unknown[] = [];
      const controller = new AbortController();
      const deadline = performance.now()+this.recapBudgetMs;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_,reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Recap deadline')); },this.recapBudgetMs); });
      let provider = this.recapProvider;
      if (!provider && process.env.ANTHROPIC_API_KEY?.trim()) {
        const request = createMessageClient({ timeoutMs: this.recapBudgetMs, onMetrics: m => telemetry.push(m) });
        provider = async (prompt,signal) => { const result = await request(prompt,{ purpose: 'quarter_recap', maxTokens: 2400, signal }); return result ? parseReply(result.message) : null; };
      }
      try {
        for (const q of summary.quarters) {
          if (q.recap.status !== 'pending') continue;
          q.recap = unavailableRecap();
          if (!provider) continue;
          for (let attempt = 0; attempt < 2 && performance.now() < deadline; attempt++) {
            try {
              q.recap = validateQuarterRecap(await Promise.race([provider(buildQuarterRecapPrompt(q.facts),controller.signal),timeout]),q.facts);
              break;
            } catch { telemetry.push({ quarter: q.facts.quarter, attempt: attempt+1, outcome: 'invalid_or_unavailable' }); }
          }
        }
      } finally { clearTimeout(timer); controller.abort(); }
      const latest = [...this.store.reports(base.runId)].reverse().find(r => r.cutoff === base.cutoff && r.facts.hash === base.facts.hash) ?? base;
      const report = { ...latest, id: randomUUID(), version: this.nextVersion(base.runId), generatedAt: new Date().toISOString(), quarterSummary: summary,
        model: summary.quarters.some(q => q.recap.status === 'ready') ? llmConfig.model : null, telemetry: [...base.telemetry,...telemetry] };
      this.store.saveReport(report); onUpdate(); return report;
    })().finally(() => this.recapJobs.delete(key));
    this.recapJobs.set(key,job); return job;
  }
  generate(runId: string, regenerate = false, factualOnly = false): Promise<BusinessReport> {
    const facts = factsFor(this.store,runId);
    const key = `${runId}:${facts.cutoff}:${facts.hash}`;
    if (this.jobs.has(key)) return this.jobs.get(key)!;
    const existing = this.store.reports(runId);
    const current = [...existing].reverse().find(r => r.cutoff === facts.cutoff && r.facts.hash === facts.hash);
    if (current && !regenerate) return Promise.resolve(current);
    const version = Math.max(0,...existing.map(r => r.version))+1;
    const quarterSummary = current?.quarterSummary ?? this.summary(runId);
    const job = this.build(facts,version,factualOnly).then(report => { report.quarterSummary = [...this.store.reports(runId)].reverse().find(r => r.cutoff === facts.cutoff && r.facts.hash === facts.hash)?.quarterSummary ?? quarterSummary; report.version = this.nextVersion(runId); this.store.saveReport(report); return report; }).finally(() => this.jobs.delete(key));
    this.jobs.set(key,job); return job;
  }
  pending(runId: string) { return [...this.jobs.keys(),...this.recapJobs.keys()].some(k => k.startsWith(`${runId}:`)); }
  private async build(facts: ReportFacts, version: number, factualOnly: boolean): Promise<BusinessReport> {
    let sections: ReportSection[] | null = null; const telemetry: unknown[] = [];
    let provider = factualOnly ? undefined : this.provider;
    if (!factualOnly && !provider && process.env.ANTHROPIC_API_KEY?.trim()) {
      const request = createMessageClient({ onMetrics: m => telemetry.push(m) });
      provider = async prompt => { const result = await request(prompt,{ purpose: 'report', maxTokens: 4000 }); return result ? parseReply(result.message) : null; };
    }
    if (provider) for (let attempt = 0; attempt < 2; attempt++) {
      try { sections = validateReport(await provider(buildReportPrompt(facts)),facts); break; }
      catch { telemetry.push({ attempt: attempt+1, outcome: 'invalid_or_unavailable' }); }
    }
    return { id: randomUUID(), runId: facts.runId, version, cutoff: facts.cutoff, tick: facts.tick, generatedAt: new Date().toISOString(),
      status: sections ? 'ready' : 'factual_fallback', limitation: sections ? null : factualOnly ? 'Fast-forward factual report from committed evidence. Generate AI analysis with the report retry control.' : 'AI analysis unavailable. This factual report uses committed evidence; retry is available.',
      facts, sections: sections ?? factualSections(facts), schemaVersion: 1, promptVersion: 1, model: sections ? llmConfig.model : null, telemetry };
  }
}
export function reportMarkdown(report: BusinessReport) {
  return [`# Business report · ${report.runId}`, `Cutoff: tick ${report.tick}, sequence ${report.cutoff}. ${report.limitation ?? ''}`,
    ...(report.quarterSummary?.quarters.flatMap(({ facts: f, recap: r }) => [
      `## ${f.partial ? 'Run summary · partial quarter' : 'Quarter complete'} · Q${f.quarter}`,
      `Highest Stock Price: ${f.peak.price} · ${f.peak.label} · ${f.metrics.peakReturnPercent}% from opening. [quarter-${f.quarter}-price]`,
      ...Object.entries(f.metrics).map(([k,v]) => `- ${k}: ${v}`),
      `AI recap: ${r.status}. ${r.summary}`,
      ...([['Best Move',r.bestMove],['Biggest Blunder',r.biggestBlunder]] as const).map(([label,h]) => {
        const c = f.candidates.find(c => c.id === h?.candidateId);
        return h ? `${label} (AI assessment): ${h.title}. ${c?.actor.role}: ${c?.actor.name}. ${c?.action}. ${h.explanation} [${h.evidenceIds.join(', ')}]` : `${label}: ${label === 'Best Move' ? 'No clear standout move' : 'No clear blunder recorded'}`;
      }), ...r.lessons.map(l => `Next quarter: ${l.text} [${l.evidenceIds.join(', ')}]`),
      ...f.evidence.map(e => `[${e.id}] ${e.text}`),
    ]) ?? []),
    ...Object.entries(report.facts.metrics).map(([key,value]) => `- ${key}: ${value}`),
    ...report.sections.flatMap(s => [`\n## ${s.title}`, ...s.observations.map(o => `${o.assessment === 'recommendation' ? 'Recommendation: ' : ''}${o.text} [${o.evidenceIds.join(', ')}]`)])].join('\n\n');
}
