// Ablation runner: the same scenario across all four policy modes and N seeds,
// with the stub LLM. Writes JSON and CSV summaries and prints the brief's
// behaviour checks.
//   pnpm exec tsx server/scripts/ablate.ts --seeds 10 --ticks 16 --out runs/ablation [--calm] [--price-feedback] [--no-gossip]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ACTIONS, MODES, type Action, type Mode, type RunConfig } from '../engine-types';
import { DEFAULT_PARAMS, type Params } from '../params';
import { createStubProvider } from '../stub-provider';
import { runSimulation, type RunResult } from '../tick';
import { CALM_SCENARIO, buildScenario, fixtureCast } from './fixture';
import { parseArgs } from './run-sim';

export const BANDS = ['0-39', '40-69', '70-100'] as const;
export type Band = (typeof BANDS)[number];
export const band = (stress: number): Band => (stress < 40 ? '0-39' : stress < 70 ? '40-69' : '70-100');

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const r3 = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 1000);

/** Least-squares slope of y on x. */
function slope(points: Array<[number, number]>): number | null {
  if (points.length < 2) return null;
  const mx = mean(points.map((p) => p[0]))!;
  const my = mean(points.map((p) => p[1]))!;
  let num = 0;
  let den = 0;
  for (const [x, y] of points) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return den === 0 ? null : num / den;
}

export interface AblationOptions {
  seeds: number;
  ticks: number;
  calm: boolean;
  priceFeedback?: boolean;
  gossip?: boolean;
  params?: Params;
}

export async function runAblation(opts: AblationOptions) {
  const params = opts.params ?? DEFAULT_PARAMS;
  const seeds = Array.from({ length: opts.seeds }, (_, i) => i + 1);
  const scenario = (seed: number) => (opts.calm ? CALM_SCENARIO : buildScenario(seed, opts.ticks));
  const runs: Record<Mode, RunResult[]> = { llm_bias: [], llm_raw: [], rules: [], random: [] };

  for (const mode of MODES) {
    for (const seed of seeds) {
      const config: RunConfig = { seed, mode, ticks: opts.ticks, scenario: scenario(seed), gossip: opts.gossip ?? true, billboard: true, priceFeedback: opts.priceFeedback ?? false };
      runs[mode].push(await runSimulation(fixtureCast(seed, params), config, createStubProvider(seed), params));
    }
  }

  // --- Action mix by stress band per mode (counts and mean probabilities).
  type Cell = { count: number; prob: number };
  const mix: Record<Mode, Record<Band, { n: number; actions: Record<Action, Cell> }>> = {} as never;
  for (const mode of MODES) {
    mix[mode] = {} as never;
    for (const b of BANDS) {
      mix[mode][b] = { n: 0, actions: Object.fromEntries(ACTIONS.map((a) => [a, { count: 0, prob: 0 }])) as Record<Action, Cell> };
    }
    for (const run of runs[mode]) {
      for (const log of run.logs) {
        for (const d of log.decisions) {
          const cell = mix[mode][band(d.state.stress)];
          cell.n++;
          cell.actions[d.chosen.action].count++;
          for (const a of ACTIONS) cell.actions[a].prob += d.probs[a] ?? 0;
        }
      }
    }
  }
  const actionMixRows: string[] = ['mode,stress_band,action,decisions,count,share,mean_prob'];
  for (const mode of MODES) {
    for (const b of BANDS) {
      const { n, actions } = mix[mode][b];
      for (const a of ACTIONS) {
        actionMixRows.push(
          [mode, b, a, n, actions[a].count, n ? r3(actions[a].count / n) : '', n ? r3(actions[a].prob / n) : ''].join(','),
        );
      }
    }
  }

  // --- Per-run rows.
  const runRows: string[] = ['seed,mode,quits,crack_order,first_quit_tick,time_to_first_quit,true_reach,false_reach,leaks,fallbacks,ending_price,price_feedback,headcount,morale'];
  for (const mode of MODES) {
    for (const r of runs[mode]) {
      const s = r.summary;
      runRows.push(
        [s.seed, mode, s.quits, s.crack_order_archetypes.join(' > '), s.first_quit_tick ?? '', s.time_to_first_quit ?? '',
          s.reach.true_holders, s.reach.false_holders, s.leaks, s.fallbacks, s.price, s.priceFeedback, s.headcount, s.morale ?? ''].join(','),
      );
    }
  }

  // --- Crack order per archetype per mode.
  const archetypes = fixtureCast(1, params).map((c) => c.profile.archetype);
  const crackRows: string[] = ['mode,archetype,quit_rate,mean_quit_tick,mean_rank,cracked_first'];
  const perMode: Record<string, unknown> = {};
  for (const mode of MODES) {
    const crack: Record<string, { quit_rate: number | null; mean_quit_tick: number | null; mean_rank: number | null; cracked_first: number }> = {};
    for (const arch of archetypes) {
      const ticks: number[] = [];
      const ranks: number[] = [];
      let first = 0;
      for (const r of runs[mode]) {
        const i = r.summary.crack_order_archetypes.indexOf(arch);
        if (i < 0) continue;
        ranks.push(i + 1);
        if (i === 0) first++;
        const id = r.summary.crack_order[i];
        ticks.push(r.world.agents[id].quitTick!);
      }
      crack[arch] = { quit_rate: r3(ranks.length / runs[mode].length), mean_quit_tick: r3(mean(ticks)), mean_rank: r3(mean(ranks)), cracked_first: first };
      crackRows.push([mode, arch, crack[arch].quit_rate, crack[arch].mean_quit_tick ?? '', crack[arch].mean_rank ?? '', first].join(','));
    }
    const firstQuits = runs[mode].map((r) => r.summary.time_to_first_quit).filter((x): x is number => x !== null);
    const firstQuitTicks = runs[mode].map((r) => r.summary.first_quit_tick).filter((x): x is number => x !== null);
    perMode[mode] = {
      crack,
      mean_quits: r3(mean(runs[mode].map((r) => r.summary.quits))),
      price: {
        feedback: opts.priceFeedback ?? false,
        mean_ending_price: mean(runs[mode].map(r => r.summary.price)),
        mean_headcount: mean(runs[mode].map(r => r.summary.headcount)),
        mean_morale: mean(runs[mode].map(r => r.summary.morale).filter((m): m is number => m !== null)),
      },
      first_quit: {
        mean_tick: r3(mean(firstQuitTicks)),
        median_tick: median(firstQuitTicks),
        mean_ticks_after_first_shock: r3(mean(firstQuits)),
        runs_without_quit: runs[mode].length - firstQuitTicks.length,
      },
      reach: {
        mean_true_holders: r3(mean(runs[mode].map((r) => r.summary.reach.true_holders))),
        mean_false_holders: r3(mean(runs[mode].map((r) => r.summary.reach.false_holders))),
        per_tick: Array.from({ length: opts.ticks }, (_, t) => ({
          tick: t + 1,
          true_holders: r3(mean(runs[mode].map((r) => r.logs[t].reach.true_holders))),
          false_holders: r3(mean(runs[mode].map((r) => r.logs[t].reach.false_holders))),
        })),
      },
      action_mix: Object.fromEntries(
        BANDS.map((b) => [b, {
          decisions: mix[mode][b].n,
          share: Object.fromEntries(ACTIONS.map((a) => [a, mix[mode][b].n ? r3(mix[mode][b].actions[a].count / mix[mode][b].n) : null])),
        }]),
      ),
    };
  }

  const checks = await behaviourChecks(runs, seeds, opts, params);
  return {
    files: {
      'action_mix.csv': actionMixRows.join('\n') + '\n',
      'runs.csv': runRows.join('\n') + '\n',
      'crack_order.csv': crackRows.join('\n') + '\n',
      'summary.json': JSON.stringify({ options: { ...opts, params: undefined }, params, modes: perMode, checks }, null, 2) + '\n',
    },
    perMode,
    checks,
    runs,
  };
}

interface Check {
  name: string;
  pass: boolean | null;
  detail: string;
}

/** The brief's acceptance checks, measured on the stub LLM. */
async function behaviourChecks(runs: Record<Mode, RunResult[]>, seeds: number[], opts: AblationOptions, params: Params): Promise<Check[]> {
  const checks: Check[] = [];
  const decisions = (mode: Mode) => runs[mode].flatMap((r) => r.logs.flatMap((l) => l.decisions));
  const workShare = (ds: ReturnType<typeof decisions>) =>
    ds.length ? ds.filter((d) => d.chosen.action === 'work' || d.chosen.action === 'overwork').length / ds.length : null;

  // 1. Pressure above 0.8: work + overwork under 40% in llm_bias.
  const hot = decisions('llm_bias').filter((d) => d.pressure > 0.8);
  const hotShare = workShare(hot);
  checks.push({
    name: 'pressure > 0.8: work + overwork < 40% (llm_bias)',
    pass: hotShare === null ? null : hotShare < 0.4,
    detail: hotShare === null ? 'no decisions above pressure 0.8' : `${(hotShare * 100).toFixed(1)}% of ${hot.length} decisions`,
  });

  // 2. llm_raw agents work more than llm_bias agents.
  const raw = workShare(decisions('llm_raw'))!;
  const bias = workShare(decisions('llm_bias'))!;
  checks.push({
    name: 'llm_raw works more than llm_bias',
    pass: raw > bias,
    detail: `work + overwork: llm_raw ${(raw * 100).toFixed(1)}% vs llm_bias ${(bias * 100).toFixed(1)}%`,
  });

  // 3. At equal stress, Flight Risk interviews more than Breadwinner in >= 8/10 runs.
  let wins = 0;
  let compared = 0;
  for (const r of runs.llm_bias) {
    const ds = r.logs.flatMap((l) => l.decisions);
    const byBand = (agent: string) => {
      const out: Partial<Record<Band, number[]>> = {};
      for (const d of ds.filter((x) => x.agent === agent)) (out[band(d.state.stress)] ??= []).push(d.probs.interview ?? 0);
      return out;
    };
    const fr = byBand('flight');
    const bw = byBand('breadwinner');
    const shared = BANDS.filter((b) => fr[b]?.length && bw[b]?.length);
    if (!shared.length) continue;
    compared++;
    const diff = mean(shared.map((b) => mean(fr[b]!)! - mean(bw[b]!)!))!;
    if (diff > 0) wins++;
  }
  const need = Math.ceil(0.8 * compared);
  checks.push({
    name: 'equal stress: Flight Risk interviews more than Breadwinner in >= 80% of runs',
    pass: compared ? wins >= need : null,
    detail: `${wins}/${compared} runs (mean interview probability within shared stress bands)`,
  });

  // 4. Calm run (no billboard events): at most 1 agent quits in 30 ticks.
  let calmOk = 0;
  for (const seed of seeds) {
    const config: RunConfig = { seed, mode: 'llm_bias', ticks: 30, scenario: CALM_SCENARIO, gossip: opts.gossip ?? true, billboard: true, priceFeedback: opts.priceFeedback ?? false };
    const r = await runSimulation(fixtureCast(seed, params), config, createStubProvider(seed), params);
    if (r.summary.quits <= 1) calmOk++;
  }
  checks.push({
    name: 'calm run: at most 1 quit in 30 ticks (llm_bias)',
    pass: calmOk === seeds.length,
    detail: `${calmOk}/${seeds.length} seeds`,
  });

  // 5. High-impulsivity agents shift their mix faster as stress rises.
  // Measured within each agent (slope of P(not work/overwork) on stress), then
  // averaged per group, so differences between agents' baselines don't count.
  // The pooled slope is reported too. Neither isolates impulsivity: stress
  // moves with burnout and traits differ. The controlled version is a unit
  // test in server/test/bias.test.ts.
  const HIGH = 55;
  const LOW = 30;
  const perAgent = new Map<string, { imp: number; pts: Array<[number, number]> }>();
  const pooled = { high: [] as Array<[number, number]>, low: [] as Array<[number, number]> };
  for (const r of runs.llm_bias) {
    for (const d of r.logs.flatMap((l) => l.decisions)) {
      const imp = r.world.agents[d.agent].profile.traits.impulsivity;
      const pt: [number, number] = [d.state.stress / 100, 1 - (d.probs.work ?? 0) - (d.probs.overwork ?? 0)];
      const key = `${r.config.seed}:${d.agent}`;
      if (!perAgent.has(key)) perAgent.set(key, { imp, pts: [] });
      perAgent.get(key)!.pts.push(pt);
      if (imp >= HIGH) pooled.high.push(pt);
      else if (imp <= LOW) pooled.low.push(pt);
    }
  }
  const groupSlope = (test: (imp: number) => boolean) =>
    mean([...perAgent.values()].filter((a) => test(a.imp)).map((a) => slope(a.pts)).filter((s): s is number => s !== null));
  const wh = groupSlope((i) => i >= HIGH);
  const wl = groupSlope((i) => i <= LOW);
  checks.push({
    name: 'high-impulsivity agents shift away from work faster as stress rises',
    pass: wh === null || wl === null ? null : wh > wl,
    detail:
      `mean within-agent slope of P(not work/overwork) on stress: impulsivity >= ${HIGH}: ${r3(wh)}, <= ${LOW}: ${r3(wl)}` +
      ` (pooled across agents: ${r3(slope(pooled.high))} vs ${r3(slope(pooled.low))})`,
  });

  void opts;
  return checks;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args['price-feedback'] !== undefined && args['price-feedback'] !== true) throw new Error('--price-feedback is a flag');
  const opts: AblationOptions = {
    seeds: Number(args.seeds ?? 10),
    ticks: Number(args.ticks ?? 16),
    calm: Boolean(args.calm),
    priceFeedback: args['price-feedback'] === true,
    gossip: !args['no-gossip'],
  };
  const out = String(args.out ?? 'runs/ablation');
  const result = await runAblation(opts);
  mkdirSync(out, { recursive: true });
  for (const [name, body] of Object.entries(result.files)) writeFileSync(join(out, name), body);

  console.log(`Ablation | ${opts.seeds} seeds x ${MODES.length} modes | ${opts.ticks} ticks | ${opts.calm ? 'calm' : 'shock'} scenario | stub LLM`);
  console.log('\nmode       quits/run  first quit (mean tick)  no-quit runs  true reach  false reach  work+overwork @ stress 70+');
  for (const mode of MODES) {
    const m = result.perMode[mode] as {
      mean_quits: number; first_quit: { mean_tick: number | null; runs_without_quit: number };
      reach: { mean_true_holders: number; mean_false_holders: number };
      action_mix: Record<Band, { decisions: number; share: Record<Action, number | null> }>;
    };
    const hi = m.action_mix['70-100'];
    const work = hi.decisions ? ((hi.share.work ?? 0) + (hi.share.overwork ?? 0)) * 100 : null;
    console.log(
      `${mode.padEnd(10)} ${String(m.mean_quits).padStart(9)}  ${String(m.first_quit.mean_tick ?? '-').padStart(22)}  ${String(m.first_quit.runs_without_quit).padStart(12)}  ${String(m.reach.mean_true_holders).padStart(10)}  ${String(m.reach.mean_false_holders).padStart(11)}  ${work === null ? '-' : work.toFixed(1) + '%'}`,
    );
  }
  console.log('\nCrack order (llm_bias): archetype, quit rate, mean rank');
  const crack = (result.perMode.llm_bias as { crack: Record<string, { quit_rate: number; mean_rank: number | null }> }).crack;
  for (const [arch, c] of Object.entries(crack).sort((a, b) => (a[1].mean_rank ?? 99) - (b[1].mean_rank ?? 99))) {
    console.log(`  ${arch.padEnd(12)} ${String(c.quit_rate).padStart(5)}  ${c.mean_rank ?? '-'}`);
  }
  console.log('\nBehaviour checks (brief)');
  for (const c of result.checks) console.log(`  [${c.pass === null ? 'n/a ' : c.pass ? 'PASS' : 'FAIL'}] ${c.name}: ${c.detail}`);
  console.log(`\nWrote ${Object.keys(result.files).map((f) => join(out, f)).join(', ')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
