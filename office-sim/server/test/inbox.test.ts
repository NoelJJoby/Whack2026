// The inbox fold: primary blocker, de-duplication, resolution, projection, and hidden defects.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Task } from '../../shared/business';
import type { TaskEvent } from '../../shared/inbox';
import { openBusinessTick } from '../business';
import { beginDiagnostics, takeDiagnostics } from '../diagnostics/collector';
import { scanTasks } from '../diagnostics/details';
import { emptyInbox, foldInbox, type InboxState } from '../diagnostics/inbox';
import type { Action, Decision, TurnProvider, World } from '../engine-types';
import { openEvent, updateLifecycle } from '../events/lifecycle';
import { fallbackCeo, managementPhase } from '../management';
import { detectIncidents } from '../incidents';
import { DEFAULT_PARAMS } from '../params';
import { fixtureCast } from '../scripts/fixture';
import { executeWork } from '../tasks';
import { createWorld } from '../tick';

const TOM = 'loyalist', SAM = 'skeptic';
function world(): World { const w = createWorld(fixtureCast(7), 7); w.tick = 2; return w; }
const task = (w: World, id: string): Task => w.business.tasks.find(t => t.id === id)!;
function collect(w: World, run: () => void): TaskEvent[] { beginDiagnostics(w, DEFAULT_PARAMS); run(); return takeDiagnostics(w); }
function decision(w: World, agentId: string, action: Action, t?: Task): Decision {
  const s = w.agents[agentId].state;
  return { action, target: null, claim: null, task_id: t?.id, assignment_version: t?.version, probs: { [action]: 0.3 }, public_line: '', inner_monologue: '',
    log: { state: { stress: s.stress, burnout: s.burnout, loyalty: s.loyalty, trust_mgmt: s.trust_mgmt }, fresh: false, explain: '' } } as unknown as Decision;
}
const ev = (w: World, e: Omit<TaskEvent, 'turn'>): TaskEvent => ({ turn: w.tick, ...e });
/** Advance one tick: run `act`, then the end-of-tick scan, then fold. */
function tick(w: World, inbox: InboxState, act: () => void = () => {}) {
  w.tick++;
  const events = collect(w, () => { act(); scanTasks(w); });
  return foldInbox(inbox, events, w, DEFAULT_PARAMS);
}

describe('inbox fold', () => {
  it('reports the earliest failing stage as the primary blocker', () => {
    const w = world();
    const t = task(w, 'service-0'); t.owner = TOM; t.status = 'active'; t.allocated = 1;
    w.business.supplierAvailableAt = w.tick + 10;
    const base = { taskId: t.id, agentId: TOM };
    const events = [
      ev(w, { ...base, stage: 'deadline', code: 'AT_RISK', severity: 'warning', details: { remaining: 4, allocated: 1, worked: 0, window: 4, finish: -1, deadline: t.deadline, client: '' } }),
      ev(w, { ...base, stage: 'execution', code: 'SUPPLIER_OUTAGE', severity: 'warning', details: { until: w.tick + 10, kind: 'delivery' } }),
      ev(w, { ...base, stage: 'choice', code: 'CHOSE_OTHER_ACTION', severity: 'warning', details: { action: 'gossip', actionLabel: 'gossiping', probability: 20, drivers: 'stress', explain: '', otherTurns: 3, window: 4, topAction: 'gossip', topLabel: 'gossiping', topTurns: 3 } }),
    ];
    const thread = foldInbox(emptyInbox(), events, w, DEFAULT_PARAMS).state.threads[t.id];
    assert.equal(thread.primary?.code, 'CHOSE_OTHER_ACTION');
    assert.equal(thread.status, 'blocked');
    assert.equal(thread.also.length, 2);
    assert.match(thread.also[0], /supplier outage/);
    assert.match(thread.also[1], /miss its deadline/);
    const lead = thread.messages.at(-1)!;
    assert.match(lead.headline, /Tom isn't working on “Deliver Northstar service”/);
    assert.match(lead.why[0], /Tom spent 3 of the last 4 hours gossiping/);
    assert.ok(lead.unblock);
  });

  it('counts a repeated reason instead of adding messages, then resolves when it clears', () => {
    const w = world();
    let inbox = emptyInbox();
    for (let i = 0; i < 3; i++) inbox = tick(w, inbox).state;
    const thread = inbox.threads['service-0'];
    assert.equal(thread.messages.length, 1);
    assert.equal(thread.messages[0].code, 'UNASSIGNED');
    assert.equal(thread.messages[0].count, 3);
    assert.ok(thread.messages[0].why.includes('No progress for 3 hours.'));
    const t = task(w, 'service-0'); t.owner = TOM; t.status = 'active'; t.allocated = 1;
    const { state, delta } = tick(w, inbox);
    assert.equal(state.threads['service-0'].status, 'resolved');
    assert.match(state.threads['service-0'].resolution!.summary, /it got an owner/);
    assert.ok(delta.threads.some(x => x.id === 'service-0'));
  });

  it('adds a new message and a toast when severity rises (owner left, ops did not reassign)', () => {
    const w = world();
    const t = task(w, 'initial-sales'); t.owner = 'gossip'; t.status = 'active'; t.allocated = 1;
    w.agents.gossip.status = 'quit';
    let r = tick(w, emptyInbox(), () => openBusinessTick(w));
    assert.equal(r.state.threads['initial-sales'].primary?.code, 'OWNER_LEFT');
    assert.equal(r.state.threads['initial-sales'].severity, 'warning');
    assert.equal(r.delta.toasts.length, 0);
    w.eventState.decisions.push({ id: 'd', tick: w.tick + 1, revision: w.tick + 1, author: 'ops', kind: 'ops', rationale: '', fallback: 'rules', choices: [], assignments: [] });
    r = tick(w, r.state);
    const thread = r.state.threads['initial-sales'];
    assert.equal(thread.severity, 'critical');
    assert.equal(thread.messages.filter(m => m.code === 'OWNER_LEFT').length, 2);
    assert.equal(r.delta.toasts.length, 1);
    assert.match(r.delta.toasts[0].headline, /lost its owner/);
    assert.match(thread.messages.at(-1)!.unblock!, /Reassign to someone in Sales/);
  });

  it('raises AT_RISK when the projection passes the deadline and clears it when it recovers', () => {
    const w = world();
    const t = task(w, 'initial-collection'); t.owner = 'breadwinner'; t.status = 'active'; t.allocated = 1; t.remaining = 4; t.deadline = w.tick + 3;
    let r = tick(w, emptyInbox());
    assert.equal(r.state.threads[t.id].status, 'at_risk');
    assert.equal(r.state.threads[t.id].primary?.code, 'AT_RISK');
    t.remaining = 0.5;
    r = tick(w, r.state);
    assert.equal(r.state.threads[t.id].status, 'resolved');
    assert.match(r.state.threads[t.id].resolution!.summary, /projection recovered/);
  });
});

describe('critical alerts', () => {
  it('a failed case still toasts and sets severity when an earlier stage is the primary blocker', () => {
    const w = world();
    const e = openEvent(w, 'client_win'); e.status = 'responding'; e.domain = 'delivery'; e.deadline = w.tick;
    const r = tick(w, emptyInbox(), () => updateLifecycle(w));
    const thread = r.state.threads[e.tasks[0]];
    assert.equal(thread.primary?.code, 'UNASSIGNED');
    assert.equal(thread.severity, 'critical');
    assert.ok(thread.messages.some(m => m.code === 'CASE_FAILED' && m.severity === 'critical'));
    assert.equal(r.delta.toasts.length, 1);
    assert.match(r.delta.toasts[0].headline, /failed: the deadline passed/);
  });

  it('records a rejected ops plan even when the fallback then assigned the task', async () => {
    const w = world();
    w.tick++;
    const provider: TurnProvider = async (_p, ctx) => ctx.management?.kind === 'ceo' ? fallbackCeo(ctx.management)
      : { schemaVersion: 1, kind: 'ops', revision: ctx.management!.revision, assignments: [{ taskId: 'service-0', employeeId: 'gossip', state: 'active', allocation: 1 }], infeasible: [], rationale: 'x' };
    beginDiagnostics(w, DEFAULT_PARAMS); await managementPhase(w, provider, 'llm_bias'); scanTasks(w);
    const thread = foldInbox(emptyInbox(), takeDiagnostics(w), w, DEFAULT_PARAMS).state.threads['service-0'];
    assert.equal(thread.status, 'resolved');
    assert.equal(thread.messages[0].code, 'REJECTED_NO_CAPABILITY');
    assert.match(thread.resolution!.summary, /Ops rescheduled it\. It went to \w+ instead\./);
  });
});

describe('hidden defects', () => {
  /** The first tick at which finishing the release rolls a hidden defect (or doesn't), at maximum risk. */
  function finishRelease(wantDefect: boolean) {
    for (let at = 3; at < 400; at++) {
      const w = world(); w.tick = at;
      const t = task(w, 'initial-release'); t.owner = TOM; t.status = 'active'; t.allocated = 1; t.remaining = 1;
      Object.assign(w.agents[TOM].state, { burnout: 100, workload: 100 });
      const events = collect(w, () => { executeWork(w, w.agents[TOM], decision(w, TOM, 'work', t)); });
      if (t.error === wantDefect) return { w, events };
    }
    throw new Error('no matching roll');
  }

  it('shows the same messages whether or not a defect was rolled, until it surfaces', () => {
    const bad = finishRelease(true), clean = finishRelease(false);
    assert.ok(bad.events.some(e => e.code === 'DEFECT_LINKED'), 'the engine opened a hidden security case');
    const visible = (r: ReturnType<typeof finishRelease>) => foldInbox(emptyInbox(), r.events, r.w, DEFAULT_PARAMS).delta.threads
      .flatMap(t => t.messages.map(m => [m.code, m.severity, m.headline, m.why.join(' ')]));
    assert.deepEqual(visible(bad), visible(clean));
    assert.ok(visible(bad).some(m => m[0] === 'HIGH_DEFECT_RISK'));
    const delta = JSON.stringify(foldInbox(emptyInbox(), bad.events, bad.w, DEFAULT_PARAMS).delta);
    assert.doesNotMatch(delta, /DEFECT_LINKED|DEFECT_SURFACED|security case|event-/);
  });

  it('reveals the defect, linked to the task, once the engine detects the security case', () => {
    const { w, events } = finishRelease(true);
    const first = foldInbox(emptyInbox(), events, w, DEFAULT_PARAMS);
    w.tick++;
    detectIncidents(w);
    const next = foldInbox(first.state, [], w, DEFAULT_PARAMS);
    const thread = next.state.threads['initial-release'];
    const surfaced = thread.messages.find(m => m.code === 'DEFECT_SURFACED')!;
    assert.equal(surfaced.severity, 'critical');
    assert.match(surfaced.headline, /A defect in “Release with access controls checked” surfaced as a security case/);
    assert.match(surfaced.why[0], /Tom finished/);
    assert.deepEqual(next.delta.toasts.map(t => t.threadId), ['initial-release']);
    assert.deepEqual(next.state.links, {});
  });
});
