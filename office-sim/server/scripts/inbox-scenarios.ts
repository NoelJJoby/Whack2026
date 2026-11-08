// Force each inbox blocker through the real engine decision points and print the thread the
// player would see. For blockers the UI can't create (ops is autonomous): `npx tsx server/scripts/inbox-scenarios.ts`.
import type { Task } from '../../shared/business';
import type { InboxThread, TaskEvent } from '../../shared/inbox';
import { openBusinessTick } from '../business';
import { beginDiagnostics, takeDiagnostics } from '../diagnostics/collector';
import { scanTasks } from '../diagnostics/details';
import { emptyInbox, foldInbox, type InboxState } from '../diagnostics/inbox';
import type { Action, Decision, TurnProvider, World } from '../engine-types';
import { openEvent, updateLifecycle } from '../events/lifecycle';
import { detectIncidents } from '../incidents';
import { fallbackCeo, managementPhase } from '../management';
import { DEFAULT_PARAMS } from '../params';
import { executeWork } from '../tasks';
import { createWorld } from '../tick';
import { fixtureCast } from './fixture';

const TOM = 'loyalist', SAM = 'skeptic', JULES = 'gossip';
const world = () => { const w = createWorld(fixtureCast(7), 7); w.tick = 2; return w; };
const task = (w: World, id: string) => w.business.tasks.find(t => t.id === id)!;
const assign = (t: Task, owner: string) => { t.owner = owner; t.status = 'active'; t.allocated = 1; };
function decision(w: World, id: string, action: Action, t?: Task): Decision {
  const s = w.agents[id].state;
  return { action, target: null, claim: null, task_id: t?.id, assignment_version: t?.version, probs: { [action]: 0.2 }, public_line: '', inner_monologue: '',
    log: { state: { stress: s.stress, burnout: s.burnout, loyalty: s.loyalty, trust_mgmt: s.trust_mgmt }, fresh: false, explain: '' } } as unknown as Decision;
}
const ops = (assignments: Array<{ taskId: string; employeeId: string; state: 'active'; allocation: number }>): TurnProvider =>
  async (_p, ctx) => ctx.management?.kind === 'ceo' ? fallbackCeo(ctx.management) : { schemaVersion: 1, kind: 'ops', revision: ctx.management!.revision, assignments, infeasible: [], rationale: 'dev' };
/** One tick: act at the engine's decision point, scan, fold. */
async function step(w: World, inbox: InboxState, act: () => unknown = () => {}) {
  w.tick++;
  beginDiagnostics(w, DEFAULT_PARAMS);
  await act(); scanTasks(w);
  const events: TaskEvent[] = takeDiagnostics(w);
  return foldInbox(inbox, events, w, DEFAULT_PARAMS);
}
function print(title: string, thread: InboxThread | undefined, toasts = 0) {
  console.log(`\n=== ${title}${toasts ? ` (toasts: ${toasts})` : ''}`);
  if (!thread) return console.log('  (no thread)');
  const m = (thread.primary && [...thread.messages].reverse().find(x => x.code === thread.primary!.code)) || thread.messages.at(-1)!;
  console.log(`  [${thread.status} · ${thread.severity}] ${m.headline}`);
  for (const line of m.why) console.log(`    ${line}`);
  if (m.unblock) console.log(`    Unblocks when: ${m.unblock}`);
  if (thread.also.length) console.log(`    Also: ${thread.also.join(' · ')}`);
  if (thread.resolution) console.log(`    Resolved: ${thread.resolution.summary}`);
  console.log(`    Timeline: ${thread.messages.slice(-4).map(x => `[${x.severity}] ${x.headline}`).join(' → ')}`);
}

const scenarios: Array<[string, () => Promise<{ thread?: InboxThread; toasts?: number }>]> = [
  ['Assign without capability (ops gives Engineering work to Jules, in Sales)', async () => {
    const w = world(); const r = await step(w, emptyInbox(), () => managementPhase(w, ops([{ taskId: 'service-0', employeeId: JULES, state: 'active', allocation: 1 }]), 'llm_bias'));
    return { thread: r.state.threads['service-0'] };
  }],
  ['Overbook someone (Tom on two tasks)', async () => {
    const w = world(); const r = await step(w, emptyInbox(), () => managementPhase(w, ops([{ taskId: 'service-0', employeeId: TOM, state: 'active', allocation: 1 }, { taskId: 'service-1', employeeId: TOM, state: 'active', allocation: 1 }]), 'llm_bias'));
    return { thread: r.state.threads['service-1'] ?? r.state.threads['service-0'] };
  }],
  ['Self-review (Tom asked to review his own work)', async () => {
    const w = world(); const t = task(w, 'service-0'); t.owner = TOM; t.status = 'review'; t.allocated = 0; t.remaining = 0;
    const r = await step(w, emptyInbox(), () => managementPhase(w, ops([{ taskId: 'service-0', employeeId: TOM, state: 'active', allocation: 1 }]), 'llm_bias'));
    return { thread: r.state.threads['service-0'] };
  }],
  ['Supplier outage', async () => {
    const w = world(); const t = task(w, 'service-0'); assign(t, TOM); w.business.supplierAvailableAt = w.tick + 9;
    const r = await step(w, emptyInbox(), () => executeWork(w, w.agents[TOM], decision(w, TOM, 'work', t)));
    return { thread: r.state.threads['service-0'] };
  }],
  ['Owner quits (escalates once ops has met and not reassigned)', async () => {
    const w = world(); assign(task(w, 'initial-sales'), JULES); w.agents[JULES].status = 'quit';
    let r = await step(w, emptyInbox(), () => openBusinessTick(w));
    w.eventState.decisions.push({ id: 'dev', tick: w.tick + 1, revision: w.tick + 1, author: 'ops', kind: 'ops', rationale: '', fallback: 'rules', choices: [], assignments: [] });
    r = await step(w, r.state);
    return { thread: r.state.threads['initial-sales'], toasts: r.delta.toasts.length };
  }],
  ['Deadline passes (client case fails)', async () => {
    const w = world(); const e = openEvent(w, 'client_win'); e.status = 'responding'; e.domain = 'delivery'; e.deadline = w.tick;
    const r = await step(w, emptyInbox(), () => updateLifecycle(w));
    return { thread: r.state.threads[e.tasks[0]], toasts: r.delta.toasts.length };
  }],
  ['Blocked several ways: earliest stage wins (no reviewer + overdue)', async () => {
    const w = world(); const t = task(w, 'service-0'); t.owner = TOM; t.status = 'review'; t.allocated = 0; t.remaining = 0; t.deadline = 1;
    const r = await step(w, emptyInbox());
    return { thread: r.state.threads['service-0'] };
  }],
  ['Repeated blocker: 4 hours unassigned, then assigned', async () => {
    const w = world(); let r = await step(w, emptyInbox());
    for (let i = 0; i < 3; i++) r = await step(w, r.state);
    print('  …while stuck', r.state.threads['service-0']);
    assign(task(w, 'service-0'), SAM); r = await step(w, r.state);
    return { thread: r.state.threads['service-0'] };
  }],
  ['Hidden defect: nothing shown until the security case is detected', async () => {
    for (let at = 3; at < 400; at++) {
      const w = world(); w.tick = at - 1; const t = task(w, 'initial-release'); assign(t, TOM); t.remaining = 1;
      Object.assign(w.agents[TOM].state, { burnout: 100, workload: 100 });
      const r = await step(w, emptyInbox(), () => executeWork(w, w.agents[TOM], decision(w, TOM, 'work', t)));
      if (!t.error) continue;
      print('  …the hour it finished', r.state.threads['initial-release']);
      const next = await step(w, r.state, () => detectIncidents(w));
      return { thread: next.state.threads['initial-release'], toasts: next.delta.toasts.length };
    }
    return {};
  }],
];

for (const [title, run] of scenarios) { const { thread, toasts } = await run(); print(title, thread, toasts); }
