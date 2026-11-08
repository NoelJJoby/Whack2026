// Business-mode share price audit. No network or live LLM calls (stub provider).
// node --import tsx server/scripts/price-audit.ts [--seeds 10] [--ticks 80] [--feedback] [--json]
//
// Mirrors the live app's tick config (server/index.ts tickConfig): business on,
// billboard on with the seeded buildScenario shock schedule, gossip on.
// Price feedback is off by default, as in the live app; --feedback turns it on.
import type { Mode, RunConfig } from '../engine-types';
import { DEFAULT_PARAMS, type Params } from '../params';
import { createStubProvider } from '../stub-provider';
import { runSimulation } from '../tick';
import { buildScenario, fixtureCast } from './fixture';
import { parseArgs } from './run-sim';
import { isOfficeHour } from '../../shared/workday';

export interface AuditRow {
  mode: Mode;
  runs: number;
  ticks: number;
  ticksAbove100: number;
  totalTicks: number;
  endMean: number;
  endMin: number;
  endMax: number;
  rawOutputOffice: number;
  outputLog: number;
  newsLevel: number;
  fundamentals: number;
  workMaskedPct: number;
  /** Extra diagnostics, not part of the requested table. */
  positiveNews: number;
  negativeNews: number;
  maxDrawdownPct: number;
  quits: number;
  actionMix: Record<string, number>;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export async function auditMode(mode: Mode, opts: { seeds?: number; ticks?: number; feedback?: boolean; params?: Params } = {}): Promise<AuditRow> {
  const seeds = Array.from({ length: opts.seeds ?? 10 }, (_, i) => i + 1);
  const ticks = opts.ticks ?? 80;
  const params = opts.params ?? DEFAULT_PARAMS;
  const ends: number[] = [], raw: number[] = [], outLog: number[] = [], news: number[] = [], fund: number[] = [], drawdowns: number[] = [];
  let above = 0, total = 0, turns = 0, masked = 0, pos = 0, neg = 0, quits = 0;
  const mix: Record<string, number> = {};
  for (const seed of seeds) {
    const cast = fixtureCast(seed);
    const config = { seed, mode, ticks, gossip: true, billboard: true, priceFeedback: opts.feedback ?? false,
      scenario: buildScenario(seed, ticks, cast.map(c => c.profile.id)), business: true } as RunConfig & { business: boolean };
    const run = await runSimulation(cast, config, mode === 'rules' || mode === 'random' ? null : createStubProvider(seed), params);
    let peak = params.price.initialPrice, dd = 0;
    for (const l of run.logs) {
      const p = l.price;
      total++;
      if (p.price > params.price.initialPrice) above++;
      peak = Math.max(peak, p.price); dd = Math.max(dd, 1 - p.price / peak);
      if (isOfficeHour(l.tick)) raw.push(p.rawOutput);
      outLog.push(p.outputLog); news.push(p.newsLevel); fund.push(p.operating?.fundamentals ?? 0);
      for (const c of p.contributions) if (p.bornIds.includes(c.id)) { if (c.value > 0) pos++; else if (c.value < 0) neg++; }
      for (const d of l.decisions) {
        turns++;
        if (d.masked.includes('work')) masked++;
        mix[d.chosen.action] = (mix[d.chosen.action] ?? 0) + 1;
      }
    }
    drawdowns.push(dd);
    quits += run.world.quits.length;
    ends.push(run.world.price.price);
  }
  for (const k of Object.keys(mix)) mix[k] = mix[k] / turns;
  return { mode, runs: seeds.length, ticks, ticksAbove100: above, totalTicks: total,
    endMean: mean(ends), endMin: Math.min(...ends), endMax: Math.max(...ends),
    rawOutputOffice: mean(raw), outputLog: mean(outLog), newsLevel: mean(news), fundamentals: mean(fund),
    workMaskedPct: 100 * masked / turns, positiveNews: pos, negativeNews: neg,
    maxDrawdownPct: 100 * mean(drawdowns), quits, actionMix: mix };
}

export function formatRow(r: AuditRow, oRef = DEFAULT_PARAMS.price.oRef): string {
  const f = (x: number, d = 3) => x.toFixed(d);
  const mix = Object.entries(r.actionMix).sort((a, b) => b[1] - a[1]).map(([a, v]) => `${a} ${(100 * v).toFixed(0)}%`).join(', ');
  return [
    `mode: ${r.mode}  (${r.runs} seeds x ${r.ticks} ticks, business: true)`,
    `  ticks with price > $100      ${r.ticksAbove100}/${r.totalTicks}`,
    `  ending price mean/min/max    $${f(r.endMean, 2)} / $${f(r.endMin, 2)} / $${f(r.endMax, 2)}`,
    `  mean office-hour rawOutput  ${f(r.rawOutputOffice)}  (oRef ${oRef})`,
    `  mean outputLog               ${f(r.outputLog)}`,
    `  mean newsLevel               ${f(r.newsLevel)}`,
    `  mean fundamentals            ${f(r.fundamentals, 4)}`,
    `  employee turns, work masked  ${f(r.workMaskedPct, 1)}%`,
    `  -- extra: news born +/-      ${r.positiveNews} / ${r.negativeNews}`,
    `  -- extra: mean max drawdown  ${f(r.maxDrawdownPct, 1)}%   quits ${r.quits}`,
    `  -- extra: action mix         ${mix}`,
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const opts = { seeds: Number(args.seeds ?? 10), ticks: Number(args.ticks ?? 80), feedback: args.feedback === true };
  const rows = [await auditMode('rules', opts), await auditMode('llm_bias', opts)];
  if (args.json) console.log(JSON.stringify(rows, null, 2));
  else console.log(`price feedback: ${opts.feedback ? 'on' : 'off'}\n\n${rows.map(r => formatRow(r)).join('\n\n')}`);
}
