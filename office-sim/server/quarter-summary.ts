import type { QuarterCandidate, QuarterFacts, QuarterRecap } from '../shared/reports';
import { TICKS_PER_QUARTER, workdayTime } from '../shared/workday';
import { moraleOf } from '../shared/scorecard';
import type { World } from './engine-types';
import { digest } from './run-store';

type Snapshot = { sequence: number; tick: number; kind: string; world: World };
export const unavailableRecap = (): QuarterRecap => ({ status: 'unavailable', summary: '', bestMove: null, biggestBlunder: null, lessons: [] });
export function quarterTime(tick: number) {
  const t = workdayTime(tick);
  return `Day ${t.dayOfMonth} (M${t.month}), ${String(t.hour).padStart(2, '0')}:00`;
}
const workforce = (w: World) => {
  const active = Object.values(w.agents).filter(a => a.status === 'active');
  return { headcount: active.length, morale: moraleOf(active.map(a => ({ ...a.state, status: a.status }))) ?? 0,
    trust: active.length ? active.reduce((n,a) => n + a.state.trust_mgmt, 0) / active.length : 0 };
};
/** Opening/tick-zero postings belong to Q1. Every other entry uses the shared calendar. */
export const quarterOf = (tick: number) => workdayTime(tick).quarter;

/** Pure projection of committed snapshots. Earlier quarters never see later outcomes. */
export function buildQuarterSummaries(runId: string, journal: Snapshot[]): QuarterFacts[] {
  const last = journal.at(-1); if (!last) throw new Error('Missing quarter evidence');
  const quarters: QuarterFacts[] = [];
  for (let quarter = 1; quarter <= quarterOf(last.tick); quarter++) {
    const startTick = (quarter - 1) * TICKS_PER_QUARTER;
    const endTick = Math.min(last.tick, quarter * TICKS_PER_QUARTER);
    const opening = journal.find(tx => tx.tick === startTick && (tx.kind === 'tick' || tx.kind === 'start'));
    if (!opening) throw new Error('Missing quarter opening snapshot');
    const ticks = journal.filter(tx => tx.kind === 'tick' && tx.tick > startTick && tx.tick <= endTick);
    // Use the final committed sequence for the last quarter, the boundary tick for previous ones.
    const closing = endTick === last.tick ? last : ticks.at(-1)!;
    if (!closing) throw new Error('Missing quarter closing snapshot');
    const w = closing.world, b = w.business;
    const inQuarter = (tick: number) => (quarter === 1 && tick === 0) || tick > startTick && tick <= endTick;
    const allPrices = [{ tick: startTick, price: opening.world.price.price }, ...ticks.map(t => ({ tick: t.tick, price: t.world.price.price }))];
    const peak = allPrices.reduce((a,p) => p.price > a.price ? p : a);
    const low = allPrices.reduce((a,p) => p.price < a.price ? p : a);
    const ledger = b.ledger.filter(l => inQuarter(l.tick));
    const sum = (category: string) => ledger.filter(l => l.category === category).reduce((n,l) => n+l.amount,0);
    const start = workforce(opening.world), end = workforce(w);
    const openingStaff = Object.values(opening.world.agents).filter(a => a.status === 'active');
    const retained = openingStaff.filter(a => w.agents[a.id]?.status === 'active').length;
    const metrics = { openingPrice: allPrices[0].price, closingPrice: w.price.price, highestPrice: peak.price, lowestPrice: low.price,
      returnPercent: (w.price.price / allPrices[0].price - 1) * 100, peakReturnPercent: (peak.price / allPrices[0].price - 1) * 100,
      revenue: sum('revenue'), bookings: sum('booking'), collections: sum('collection'), savings: sum('saving'),
      costs: ledger.filter(l => ['payroll','infrastructure','response'].includes(l.category)).reduce((n,l) => n+l.amount,0),
      cash: b.cash, openingCash: opening.world.business.cash, target: b.quarters.find(q => q.quarter === quarter)?.salesTarget ?? 0,
      openingHeadcount: start.headcount, headcount: end.headcount, retention: openingStaff.length ? retained/openingStaff.length*100 : 100,
      openingMorale: start.morale, morale: end.morale, moraleChange: end.morale-start.morale,
      openingTrust: start.trust, trust: end.trust, trustChange: end.trust-start.trust };
    const evidence: QuarterFacts['evidence'] = [
      { id: `quarter-${quarter}-price`, tick: peak.tick, text: `Committed price ${peak.price} at ${peak.tick === startTick ? 'Start of quarter' : quarterTime(peak.tick)}; opening ${metrics.openingPrice}; closing ${metrics.closingPrice}.` },
      ...ledger.map(l => ({ id: l.id, tick: l.tick, text: `${l.category}: ${l.amount} minor units; source ${l.source}.` })),
    ];
    const candidates: QuarterCandidate[] = [];
    for (const e of w.eventState.cases) {
      const prior = opening.world.eventState.cases.find(c => c.id === e.id);
      const changed = inQuarter(e.openedTick) || prior?.status !== e.status || prior?.outcome !== e.outcome || e.milestones.some(m => inQuarter(m.tick));
      if (!e.truth || !changed) continue;
      const decisions = w.eventState.decisions.filter(d => e.decisions.includes(d.id) && d.tick <= endTick);
      const decision = decisions.filter(d => d.kind === 'ceo').at(-1) ?? decisions.at(-1);
      const known = w.eventState.evidence.filter(x => x.eventId === e.id && x.certainty === 'observed' && (!decision || x.recipients.includes(decision.author)) && x.deliveryTick <= (decision?.tick ?? e.deadline));
      // A bad external event by itself is never a management blunder.
      if (!decision && !(e.status === 'failed' && known.length && e.outcome?.includes('without a decision'))) continue;
      const tasks = b.tasks.filter(t => e.tasks.includes(t.id));
      const postings = ledger.filter(l => e.ledger.includes(l.id) || tasks.some(t => t.contractId === l.source));
      const layoffs = decision?.choices.some(c => c.eventId === e.id && c.optionId.includes('layoff')) ? 1 : 0;
      const realised = postings.some(l => ['revenue','saving'].includes(l.category)) || tasks.some(t => t.status === 'done' && (!t.reviewRequired || t.reviewed));
      const outcome = e.status === 'failed' || layoffs ? 'negative' : e.status === 'resolved' && realised ? 'positive' : 'unresolved';
      const tick = e.milestones.filter(m => inQuarter(m.tick)).at(-1)?.tick ?? (inQuarter(decision?.tick ?? -1) ? decision!.tick : endTick);
      const eventEvidence = { id: e.id, tick, text: `${e.headline}. Status: ${e.status}. ${e.outcome ?? 'Outcome remains open; no success or failure established.'}` };
      evidence.push(eventEvidence);
      const ids = [e.id];
      for (const d of decisions) { evidence.push({ id: d.id, tick: d.tick, text: `${d.kind.toUpperCase()} ${d.author}: ${d.rationale}. Choices: ${d.choices.map(c => c.optionId).join(', ')}.` }); ids.push(d.id); }
      for (const t of tasks) { evidence.push({ id: t.id, tick: endTick, text: `${t.title}. ${t.status}; owner ${t.owner ?? 'unassigned'}.` }); ids.push(t.id); }
      for (const x of w.eventState.evidence.filter(x => x.eventId === e.id)) { evidence.push({ id: x.id, tick: x.tick, text: `${x.text} Source ${x.source}; delivered at ${x.deliveryTick}.` }); ids.push(x.id); }
      for (const [i,m] of e.milestones.entries()) { const id = `${e.id}-milestone-${i+1}`; evidence.push({ id, tick: m.tick, text: m.text }); ids.push(id); }
      const work = b.work.filter(r => r.taskId && tasks.some(t => t.id === r.taskId) && inQuarter(r.tick));
      for (const r of work.slice(-6)) { evidence.push({ id: r.id, tick: r.tick, text: `${r.agent}: ${r.action}. ${r.outcome}` }); ids.push(r.id); }
      ids.push(...postings.map(l => l.id));
      for (const d of w.eventState.directives.filter(d => d.eventId === e.id)) {
        evidence.push({ id: d.id, tick: d.effectiveTick, text: `Directive by ${d.author}: ${d.acceptance}. Deadline ${d.deadline}; decision ${d.decisionId}.` }); ids.push(d.id);
      }
      const actionLabels: Record<string,string> = { respond: 'Funded required acceptance work', monitor: 'Monitored the situation', reduce_spend: 'Reduced discretionary tooling spend', renegotiate: 'Renegotiated infrastructure costs', postpone: 'Postponed discretionary projects', layoff: 'Approved a layoff, reducing payroll and delivery capacity' };
      const author = decision?.author ?? 'management';
      candidates.push({ id: `story-${quarter}-${e.id}`, tick, decisionTick: decision?.tick ?? e.deadline, carryForward: (decision?.tick ?? e.openedTick) <= startTick,
        actor: { id: author, name: w.agents[author]?.profile.name ?? 'Management', role: decision?.kind ?? 'management' },
        action: decision ? decision.choices.filter(c => c.eventId === e.id).map(c => actionLabels[c.optionId.split(':')[1] ?? c.optionId] ?? 'Commissioned response work').join(', ') || 'Assigned response work' : 'Case lapsed without a decision',
        outcome, excerpt: eventEvidence.text, knownThen: known.slice(-4).map(x => x.text),
        risks: [...(e.status === 'resolved' ? [] : ['Work and obligations remain outstanding.']), ...(postings.some(l => l.category === 'booking') ? ['Signed commitments are bookings, not earned revenue.'] : [])],
        evidenceIds: [...new Set(ids)], metricIds: ['revenue','savings','costs','headcount','moraleChange','trustChange'],
        severity: { low: 1, medium: 2, high: 3 }[e.severity], monetaryImpact: postings.filter(l => ['revenue','saving','response'].includes(l.category)).reduce((n,l) => n+l.amount,0),
        peopleImpact: layoffs, deadline: e.deadline });
    }
    // Retain separate severity, money and people measures; never convert wellbeing to money.
    candidates.sort((a,b) => b.severity-a.severity || b.peopleImpact-a.peopleImpact || b.monetaryImpact-a.monetaryImpact || a.deadline-b.deadline || a.id.localeCompare(b.id));
    const shortlist = (['positive','negative','unresolved'] as const).flatMap(kind => candidates.filter(c => c.outcome === kind).slice(0,4));
    const stride = Math.max(1, Math.ceil(allPrices.length/60));
    const marked = new Set([startTick,endTick,peak.tick,low.tick,...shortlist.map(c => c.tick)]);
    const prices = allPrices.filter((p,i) => i % stride === 0 || marked.has(p.tick));
    const uniqueEvidence = [...new Map(evidence.map(e => [e.id,e])).values()];
    const base = { runId, quarter, startTick, endTick, cutoff: closing.sequence, partial: endTick < quarter*TICKS_PER_QUARTER,
      currency: b.currency, metrics, peak: { ...peak, opening: peak.tick === startTick, label: peak.tick === startTick ? 'Start of quarter' : quarterTime(peak.tick) },
      prices, candidates: shortlist, evidence: uniqueEvidence };
    quarters.push({ ...base, hash: digest(base) });
  }
  return quarters;
}
