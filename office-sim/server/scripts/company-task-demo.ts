import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HistoryResponse, SimResponse } from '../../shared/api';
import type { CompanyTask, CompanyTaskSummary } from '../../shared/companyTasks';

const [objective = 'Investigate demand for a new service and plan its launch.', seedText = '42', ticksText = '56', deadlineText = '32'] =
  process.argv.slice(2).filter(arg => arg !== '--live');
const live = process.argv.includes('--live');
const seed = Number(seedText);
const ticks = Number(ticksText);
const deadline = Number(deadlineText);
if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(ticks) || ticks < 1 || !Number.isSafeInteger(deadline)) {
  throw new Error('Usage: company-task-demo.ts [objective] [seed] [ticks] [deadline_ticks] [--live]');
}

const journal = mkdtempSync(join(tmpdir(), 'office-company-demo-'));
process.env.SIM_STORE_DIR = journal;
process.env.SIM_SEED = String(seed);
if (!live) process.env.ANTHROPIC_API_KEY = '';
const { app } = await import('../index');
try {
  const initial = (await app.inject('/api/sim/state')).json<SimResponse>();
  if (live && initial.mode === 'rules') throw new Error('Live mode requires ANTHROPIC_API_KEY');
  const submission = await app.inject({ method: 'POST', url: '/api/sim/company-tasks', payload: {
    run_id: initial.run_id, idempotency_key: 'company-demo', objective, deadline_ticks: deadline,
  } });
  if (submission.statusCode !== 202) throw new Error(submission.body);
  const taskId = submission.json<CompanyTaskSummary>().id;
  console.log(`Seed ${seed} · ${initial.mode} · journal ${journal}`);
  console.log(`Queued ${objective}`);
  let task: CompanyTask | undefined;
  for (let i = 0; i < ticks; i++) {
    const step = await app.inject({ method: 'POST', url: '/api/sim/step' });
    if (step.statusCode !== 200) throw new Error(step.body);
    const state = step.json<SimResponse>();
    const frame = (await app.inject('/api/sim/history')).json<HistoryResponse>().history.at(-1)!;
    for (const activity of frame.company_activity ?? []) {
      const who = [activity.actor ?? 'engine', ...activity.recipients].join(' → ');
      console.log(`  ${frame.tick}.${activity.round} ${activity.kind} [${who}] ${activity.dialogue}${activity.result ? ` (${activity.result})` : ''}`);
    }
    if (frame.company_activity?.length) {
      console.log(`  ${frame.tick} stock ${state.price.price.toFixed(2)} · productive units ${state.price.operating?.productiveUnits.toFixed(2)} · cash ${state.state.business?.cash}`);
      for (const marker of state.price.markers) console.log(`     market ${marker.kind} ${marker.id}`);
    }
    task = (await app.inject(`/api/sim/company-tasks/${taskId}`)).json<CompanyTask>();
    if (task.outcome) break;
  }
  console.log(JSON.stringify({ status: task?.status, deadline: task?.deadlineTick, outcome: task?.outcome,
    briefing: task?.activity.find(a => a.kind === 'brief')?.decision?.source, findings: task?.findings.length }, null, 2));
} finally {
  await app.close();
}
