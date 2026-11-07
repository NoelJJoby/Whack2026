import { randomUUID } from 'node:crypto';
import type { BusinessReport, ReportFacts, ReportSection } from '../shared/reports';
import { RunStore, digest } from './run-store';
import { createMessageClient } from './llm/client';
import { parseReply } from './llm/parse';
import { reportSchema } from './llm/schemas';
import { buildReportPrompt, RECOMMENDATIONS, REPORT_TITLES } from './llm/report-prompt';
import { llmConfig } from './llm/config';
import type { World } from './engine-types';
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
  const quarterRevenue = b.ledger.filter(l => l.category === 'revenue' && Math.floor((l.tick-1)/150)+1 === currentQuarter.quarter).reduce((n,l) => n+l.amount,0);
  const metrics = { startingCash: first.business.cash, cash: b.cash, bookings: b.bookings, revenue: b.revenue, receivables: b.receivables, costs: b.costs,
    target: currentQuarter.salesTarget, quarterRevenue, targetAttainment: quarterRevenue/currentQuarter.salesTarget*100,
    positiveRoots: roots.filter(e => e.valence === 'positive').length, negativeRoots: roots.filter(e => e.valence === 'negative').length,
    commonRoots: roots.filter(e => e.rarity === 'common').length, rareRoots: roots.filter(e => e.rarity === 'rare').length,
    layoffs: Object.values(w.agents).filter(a => a.status === 'laid_off').length, resignations: w.quits.length,
    avoidedLayoffs: roots.filter(e => e.templateId === 'cost_review' && e.outcome?.includes('avoided')).length,
    headcount: w.ids.filter(id => w.agents[id].status === 'active').length, openCases: roots.filter(e => !['resolved','failed','cancelled','superseded'].includes(e.status)).length,
    completedTasks: b.tasks.filter(t => t.status === 'done').length, remainingTasks: b.tasks.filter(t => !['done','cancelled'].includes(t.status)).length,
    trust: average(w,'trust_mgmt'), burnout: average(w,'burnout'), startingTrust: average(first,'trust_mgmt'), startingBurnout: average(first,'burnout') };
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
    { title: 'Business performance', observations: [{ text: f.evidence[0].text, evidenceIds: ['run-metrics'], metricIds: ['cash','bookings','revenue','receivables','costs','targetAttainment'], assessment: 'observed' }] },
    { title: 'Event outcomes', observations: observations(f.evidence.filter(e => /^event-\d+-\d+$/.test(e.id))) },
    { title: 'Leadership decisions', observations: observations(f.evidence.filter(e => e.id.startsWith('decision-'))) },
    { title: 'Outstanding work', observations: observations(f.evidence.filter(e => f.unresolved.includes(e.id))) },
    { title: 'Recommendations', observations: [{ text: RECOMMENDATIONS[0], evidenceIds: ['run-metrics'], metricIds: ['remainingTasks'], assessment: 'recommendation' }] },
  ];
}
export type ReportProvider = (prompt: string) => Promise<unknown>;
export class Reporting {
  private jobs = new Map<string,Promise<BusinessReport>>();
  constructor(private store: RunStore, private provider?: ReportProvider) {}
  generate(runId: string, regenerate = false): Promise<BusinessReport> {
    const facts = factsFor(this.store,runId);
    const key = `${runId}:${facts.cutoff}:${facts.hash}`;
    if (this.jobs.has(key)) return this.jobs.get(key)!;
    const existing = this.store.reports(runId);
    const current = [...existing].reverse().find(r => r.cutoff === facts.cutoff && r.facts.hash === facts.hash);
    if (current && !regenerate) return Promise.resolve(current);
    const version = Math.max(0,...existing.map(r => r.version))+1;
    const job = this.build(facts,version).then(report => { this.store.saveReport(report); return report; }).finally(() => this.jobs.delete(key));
    this.jobs.set(key,job); return job;
  }
  pending(runId: string) { return [...this.jobs.keys()].some(k => k.startsWith(`${runId}:`)); }
  private async build(facts: ReportFacts, version: number): Promise<BusinessReport> {
    let sections: ReportSection[] | null = null; const telemetry: unknown[] = [];
    let provider = this.provider;
    if (!provider && process.env.ANTHROPIC_API_KEY?.trim()) {
      const request = createMessageClient({ onMetrics: m => telemetry.push(m) });
      provider = async prompt => { const result = await request(prompt,{ purpose: 'report', maxTokens: 4000 }); return result ? parseReply(result.message) : null; };
    }
    if (provider) for (let attempt = 0; attempt < 2; attempt++) {
      try { sections = validateReport(await provider(buildReportPrompt(facts)),facts); break; }
      catch { telemetry.push({ attempt: attempt+1, outcome: 'invalid_or_unavailable' }); }
    }
    return { id: randomUUID(), runId: facts.runId, version, cutoff: facts.cutoff, tick: facts.tick, generatedAt: new Date().toISOString(),
      status: sections ? 'ready' : 'factual_fallback', limitation: sections ? null : 'AI analysis unavailable. This factual report uses committed evidence; retry is available.',
      facts, sections: sections ?? factualSections(facts), schemaVersion: 1, promptVersion: 1, model: sections ? llmConfig.model : null, telemetry };
  }
}
export function reportMarkdown(report: BusinessReport) {
  return [`# Business report · ${report.runId}`, `Cutoff: tick ${report.tick}, sequence ${report.cutoff}. ${report.limitation ?? ''}`,
    ...Object.entries(report.facts.metrics).map(([key,value]) => `- ${key}: ${value}`),
    ...report.sections.flatMap(s => [`\n## ${s.title}`, ...s.observations.map(o => `${o.assessment === 'recommendation' ? 'Recommendation: ' : ''}${o.text} [${o.evidenceIds.join(', ')}]`)])].join('\n\n');
}
