// On-time completion with the accountability loop on and off, calm vs shocks, across seeds.
//   npx tsx server/scripts/accountability-tuning.ts [--ticks 80] [--seeds 8]
// Staff:
//   rules    the bias engine in rules mode (no LLM).
//   drifting a seeded stand-in for LLM staff: each turn proposes work with a per-agent diligence and
//            leans to breaks, gossip or complaints otherwise. The bias engine (llm_bias) still decides,
//            so being chased moves them the same way it would move a real LLM's proposals.
import { LEADERBOARD_SCENARIO } from '../leaderboard/ceos';
import { fallbackCeo, fallbackOps } from '../management';
import { DEFAULT_PARAMS, type Params } from '../params';
import { stream } from '../rng';
import { createWorld, runTick } from '../tick';
import { newCompanyTask } from '../company-tasks/state';
import type { Mode, ScenarioEvent, TurnProvider, World } from '../engine-types';
import { fixtureCast } from './fixture';

const arg = (name: string, fallback: number) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? Number(process.argv[i + 1]) : fallback; };
const TICKS = arg('ticks', 80);
const SEEDS = Array.from({ length: arg('seeds', 8) }, (_, i) => i + 1);

export function driftingStaff(seed: number): TurnProvider {
  return async (agent, ctx) => {
    if (ctx.management) return ctx.management.kind === 'ceo' ? fallbackCeo(ctx.management) : fallbackOps(ctx.management, ctx.companySchedule);
    if (ctx.meeting) return null;
    const rng = stream(seed, ctx.tick, agent.id, 'stub');
    const t = agent.traits;
    const diligence = Math.min(0.9, Math.max(0.2, 0.3 + 0.35 * ctx.state.loyalty / 100 + 0.2 * t.financial_need / 100 - 0.25 * ctx.state.stress / 100 + 0.2 * (rng.next() - 0.5)));
    const task = ctx.work?.reviewable[0] ?? ctx.work?.assignments[0];
    const friend = ctx.colleagues[0]?.id;
    const proposals: Array<Record<string, unknown>> = [];
    if (task) proposals.push({ action: ctx.work!.reviewable.includes(task) ? 'review_work' : 'work', task_id: task.id, assignment_version: task.version, weight: diligence });
    if (ctx.available.includes('slack_off')) proposals.push({ action: 'slack_off', weight: (1 - diligence) * 0.6 });
    if (friend && ctx.available.includes(t.sociability >= 60 && ctx.available.includes('gossip') ? 'gossip' : 'complain')) proposals.push({ action: t.sociability >= 60 && ctx.available.includes('gossip') ? 'gossip' : 'complain', target: friend, weight: (1 - diligence) * 0.4 });
    return { proposals: proposals.slice(0, 3), public_line: 'Getting on with it.', inner_monologue: 'One thing at a time.', beliefs: Object.fromEntries(ctx.claims.map(c => [c.id, 50])) };
  };
}

export interface Outcome { due: number; onTime: number; quits: number; firings: number; warnings: number; chases: number; fixes: number; meanStress: number }

export async function run(seed: number, staff: 'rules' | 'drifting', scenario: ScenarioEvent[], params: Params, ticks = TICKS): Promise<Outcome> {
  const mode: Mode = staff === 'rules' ? 'rules' : 'llm_bias';
  const provider = staff === 'rules' ? null : driftingStaff(seed);
  let w: World = createWorld(fixtureCast(seed, params), seed, params);
  // One CEO objective a run: objective work is where live runs miss most often.
  w.companyTasks = [newCompanyTask({ run_id: 'tuning', idempotency_key: 'tuning', objective: 'Investigate demand for a new service and plan its launch.', deadline_ticks: 32 }, w)];
  const stress: number[] = [];
  for (let i = 0; i < ticks; i++) {
    w = (await runTick(w, provider, { mode, scenario, gossip: true, billboard: true, business: true }, params)).world;
    for (const id of w.ids) if (w.agents[id].status === 'active') stress.push(w.agents[id].state.stress);
  }
  const done = new Map<string, number>();
  for (const r of w.business.work) if (r.taskId && !done.has(r.taskId) && /completed|review passed/i.test(r.outcome)) done.set(r.taskId, r.tick);
  let due = 0, onTime = 0;
  for (const t of w.business.tasks) {
    if (t.id.startsWith('routine-')) continue;
    if (t.deadline > ticks && !done.has(t.id)) continue;
    due++; if (done.has(t.id) && done.get(t.id)! <= t.deadline) onTime++;
  }
  const s = w.accountability?.stats;
  return { due, onTime, quits: w.quits.length, firings: s?.firings ?? 0, warnings: s?.warnings ?? 0, chases: s?.chases ?? 0, fixes: s?.fixes ?? 0,
    meanStress: stress.reduce((n, x) => n + x, 0) / Math.max(1, stress.length) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const off: Params = { ...DEFAULT_PARAMS, accountability: { ...DEFAULT_PARAMS.accountability, enabled: false } };
  console.log(`ticks ${TICKS}, seeds ${SEEDS.join(',')} (non-routine tasks due by the end of the run, judged against their real deadline)`);
  console.log('staff     scenario  chasing  on-time        quits  firings  warnings  chases  fixes  mean stress');
  for (const staff of ['rules', 'drifting'] as const) for (const [name, scenario] of [['calm', []], ['shock', LEADERBOARD_SCENARIO]] as const) for (const [label, params] of [['off', off], ['on', DEFAULT_PARAMS]] as const) {
    const rows = await Promise.all(SEEDS.map(seed => run(seed, staff, [...scenario], params)));
    const sum = (k: keyof Outcome) => rows.reduce((n, r) => n + r[k], 0);
    console.log(`${staff.padEnd(9)} ${name.padEnd(9)} ${label.padEnd(8)} ${`${sum('onTime')}/${sum('due')} = ${(100 * sum('onTime') / Math.max(1, sum('due'))).toFixed(0)}%`.padEnd(14)} ${String(sum('quits')).padEnd(6)} ${String(sum('firings')).padEnd(8)} ${String(sum('warnings')).padEnd(9)} ${String(sum('chases')).padEnd(7)} ${String(sum('fixes')).padEnd(6)} ${(sum('meanStress') / rows.length).toFixed(1)}`);
  }
}
