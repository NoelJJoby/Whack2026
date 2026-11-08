// Accountability: internal deadlines, stand-up chases, the fault rule, warn-then-fire, blocker fixes,
// the cutscene rate limit, meeting lines, chase effects in the bias engine, and determinism.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Task } from '../../shared/business';
import { emptyAccountability, nextDayClose, planDeadlines, recordTurn, reviewChases, standup, chaseSituation, ownerAtFault } from '../accountability';
import { decide } from '../bias';
import { openBusinessTick } from '../business';
import { beginDiagnostics, takeDiagnostics } from '../diagnostics/collector';
import type { Action, Decision, TurnProvider, World } from '../engine-types';
import { DEFAULT_PARAMS, type Params } from '../params';
import { rngFactory } from '../rng';
import { fixtureCast } from '../scripts/fixture';
import { driftingStaff } from '../scripts/accountability-tuning';
import { createWorld, runTick } from '../tick';
import { computeTriggers } from '../triggers';
import { isDayStart, isOfficeClose, isOfficeHour } from '../../shared/workday';
import { LEADERBOARD_SCENARIO } from '../leaderboard/ceos';

const P = DEFAULT_PARAMS;
const TOM = 'loyalist', SAM = 'skeptic', LENA = 'flight';
/** Day 2, 09:00: a stand-up tick. Chases opened now fall due at day 3, 17:00. */
const STANDUP = 9;

function world(): World {
  const w = createWorld(fixtureCast(7), 7);
  (w as World & { businessEnabled?: boolean }).businessEnabled = true;
  w.accountability = emptyAccountability();
  return w;
}
const task = (w: World, id: string): Task => w.business.tasks.find(t => t.id === id)!;
function assign(w: World, id: string, owner: string): Task {
  const t = task(w, id); t.owner = owner; t.status = 'active'; t.allocated = 1; t.remaining = 4; t.dependencies = [];
  return t;
}
/** Already past its internal deadline, so the stand-up chases it. */
const overdueInternally = (w: World, t: Task) => { w.accountability!.internal[t.id] = { due: 3, basis: t.deadline, feasible: true, since: 1 }; };
function decision(w: World, action: Action, t?: Task): Decision {
  return { action, target: null, claim: null, task_id: t?.id, assignment_version: t?.version, probs: { [action]: 1 }, public_line: '', inner_monologue: '',
    log: {} } as unknown as Decision;
}
/** Every office-hour turn from `from` to `to` inclusive. */
function turns(w: World, from: number, to: number, act: (w: World) => Array<[string, Decision]>) {
  for (let t = from; t <= to; t++) { w.tick = t; if (!isOfficeHour(t)) continue; for (const [id, d] of act(w)) recordTurn(w, id, d); }
}
async function standupAt(w: World, tick = STANDUP) { w.tick = tick; return standup(w, P); }
async function review(w: World, tick: number, provider: TurnProvider | null = null, mode: 'rules' | 'llm_bias' = 'rules', params: Params = P) {
  w.tick = tick; return reviewChases(w, provider, mode, params);
}

describe('accountability: internal deadlines', () => {
  it('sets internal due times earlier than the deadline, in dependency order, and flags an impossible deadline', () => {
    const w = world(); w.tick = 1;
    const a = assign(w, 'service-0', TOM), b = assign(w, 'service-1', SAM);
    a.deadline = 40; b.deadline = 40; b.dependencies = [a.id];
    const c = assign(w, 'initial-sales', 'gossip'); c.deadline = 3; c.remaining = 4;
    beginDiagnostics(w, P);
    planDeadlines(w, P);
    const events = takeDiagnostics(w);
    const st = w.accountability!;
    assert.ok(st.internal[a.id].due < a.deadline && st.internal[b.id].due < b.deadline);
    assert.ok(st.internal[a.id].due < st.internal[b.id].due, 'the dependency is due before the task waiting on it');
    assert.equal(st.internal[c.id].feasible, false);
    assert.ok(events.some(e => e.code === 'DEADLINE_INFEASIBLE' && e.taskId === c.id));
    assert.ok(!events.some(e => e.code === 'DEADLINE_INFEASIBLE' && e.taskId === a.id));
  });
});

describe('accountability: stand-up', () => {
  it('runs at 09:00 only, chases a task that is behind once, with the due-by at 17:00 the next working day', async () => {
    const w = world(); const t = assign(w, 'service-0', TOM); overdueInternally(w, t);
    w.tick = STANDUP + 1; assert.deepEqual(standup(w, P), []);
    const notices = await standupAt(w);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].owner, TOM); assert.equal(notices[0].chaser, 'ops');
    assert.equal(notices[0].dueBy, nextDayClose(STANDUP));
    assert.ok(isOfficeClose(notices[0].dueBy) && notices[0].dueBy > STANDUP + 8);
    assert.deepEqual(await standupAt(w), [], 'an open chase is not repeated');
  });

  it('a chased owner gets a trigger saying by when and what to do', async () => {
    const w = world(); const t = assign(w, 'service-0', TOM); overdueInternally(w, t);
    await standupAt(w);
    const trig = computeTriggers(w, w.agents[TOM], []).find(x => x.id === `chase-${t.id}`);
    assert.ok(trig && /chased you/.test(trig.text) && /in your control/.test(trig.text));
  });
});

describe('accountability: the fault rule', () => {
  it('an owner blocked by a dependency is never punished: the manager chases the dependency instead', async () => {
    const w = world(); const t = assign(w, 'service-0', TOM); overdueInternally(w, t);
    const dep = assign(w, 'service-1', SAM); t.dependencies = [dep.id];
    await standupAt(w);
    w.accountability!.chases = w.accountability!.chases.filter(c => c.owner === TOM);
    turns(w, STANDUP, nextDayClose(STANDUP), w => [[TOM, decision(w, 'work', t)]]);
    beginDiagnostics(w, P);
    const r = await review(w, nextDayClose(STANDUP));
    const events = takeDiagnostics(w);
    assert.deepEqual(r.meetings, []);
    assert.equal(w.accountability!.warnings[TOM], undefined);
    assert.ok(r.chases.some(c => c.owner === SAM && c.taskId === dep.id), 'the dependency owner is chased');
    assert.ok(events.some(e => e.code === 'CHASE_MISSED' && e.details.fault === 'not_owner'));
    assert.ok(events.some(e => e.code === 'BLOCKER_FIXED_BY_MANAGER' && e.taskId === t.id));
  });

  it('finished work waiting for a reviewer gets a reviewer at stand-up, and its owner is not chased', async () => {
    const w = world(); const t = assign(w, 'service-0', TOM); overdueInternally(w, t);
    t.status = 'review'; t.remaining = 0; t.allocated = 0; delete t.reviewer;
    beginDiagnostics(w, P);
    const notices = await standupAt(w);
    const events = takeDiagnostics(w);
    assert.deepEqual(notices, []);
    assert.ok(t.reviewer && t.reviewer !== TOM);
    assert.ok(events.some(e => e.code === 'BLOCKER_FIXED_BY_MANAGER' && e.taskId === t.id));
  });

  it('an owner who slacked with work available is warned by the CEO, then fired if it happens again', async () => {
    const w = world(); const t = assign(w, 'service-0', TOM); overdueInternally(w, t);
    await standupAt(w);
    turns(w, STANDUP, nextDayClose(STANDUP), w => [[TOM, decision(w, 'slack_off')]]);
    const first = await review(w, nextDayClose(STANDUP));
    assert.equal(first.meetings.length, 1);
    assert.equal(first.meetings[0].outcome, 'warning');
    assert.equal(first.meetings[0].boss, 'ceo');
    assert.ok(w.accountability!.warnings[TOM]);
    const rechase = first.chases.find(c => c.owner === TOM);
    assert.ok(rechase, 'the warning comes with a new expectation');
    const stressAfterWarning = w.agents[TOM].state.stress;
    assert.ok(stressAfterWarning > 0);

    const due = rechase!.dueBy;
    turns(w, nextDayClose(STANDUP) + 1, due, w => [[TOM, decision(w, 'gossip')]]);
    const second = await review(w, due);
    assert.equal(second.meetings[0].outcome, 'fired');
    assert.equal(w.agents[TOM].status, 'laid_off');
    // Their work becomes owner-left through the existing path at the next tick.
    w.tick = due + 1; beginDiagnostics(w, P); openBusinessTick(w); const events = takeDiagnostics(w);
    assert.equal(task(w, t.id).owner, null);
    assert.ok(events.some(e => e.code === 'OWNER_LEFT' && e.taskId === t.id));
  });

  it('a task ops hands to someone else is judged on the turns the owner had it', async () => {
    for (const [action, warned] of [['slack_off', true], ['work', false]] as const) {
      const w = world(); const t = assign(w, 'service-0', TOM); overdueInternally(w, t);
      await standupAt(w);
      turns(w, STANDUP, STANDUP + 4, w => [[TOM, decision(w, action, t)]]);
      t.owner = SAM; t.version++;
      turns(w, STANDUP + 5, nextDayClose(STANDUP), w => [[TOM, decision(w, 'slack_off')]]);
      const r = await review(w, nextDayClose(STANDUP));
      assert.equal(r.meetings.length, warned ? 1 : 0, action);
      if (!warned) assert.equal(w.accountability!.chases.find(c => c.owner === TOM)!.status, 'void');
    }
  });

  it('a warned owner who improves is not fired, and the warning lapses', async () => {
    const w = world(); const t = assign(w, 'service-0', TOM); overdueInternally(w, t);
    await standupAt(w);
    turns(w, STANDUP, nextDayClose(STANDUP), w => [[TOM, decision(w, 'slack_off')]]);
    const first = await review(w, nextDayClose(STANDUP));
    const due = first.chases.find(c => c.owner === TOM)!.dueBy;
    t.remaining = 0; t.status = 'done';
    const second = await review(w, due);
    assert.deepEqual(second.meetings, []);
    assert.equal(w.agents[TOM].status, 'active');
    const expires = w.accountability!.warnings[TOM].expires;
    let tick = expires; while (!isDayStart(tick)) tick++;
    await standupAt(w, tick);
    assert.equal(w.accountability!.warnings[TOM], undefined);
  });

  it('mixed turns: the owner is at fault only if at least half of the counted turns were their own choice', () => {
    assert.equal(ownerAtFault({ own: 3, blocked: { DEPENDENCY_PENDING: 3 } }, P), true);
    assert.equal(ownerAtFault({ own: 2, blocked: { DEPENDENCY_PENDING: 3 } }, P), false);
    assert.equal(ownerAtFault({ own: 1, blocked: {} }, P), false, 'too few turns to judge');
  });
});

describe('accountability: meetings and cutscenes', () => {
  async function slackers(w: World, ids: string[]) {
    const tasks = ['service-0', 'service-1', 'service-2'];
    ids.forEach((id, i) => overdueInternally(w, assign(w, tasks[i], id)));
    await standupAt(w);
    turns(w, STANDUP, nextDayClose(STANDUP), () => ids.map(id => [id, decision(w, 'slack_off')]));
  }

  it('plays at most one meeting cutscene a day; the rest are summarised', async () => {
    const w = world(); await slackers(w, [TOM, SAM, LENA]);
    const r = await review(w, nextDayClose(STANDUP));
    assert.equal(r.meetings.length, 3);
    assert.equal(r.meetings.filter(m => m.cutscene).length, 1);
  });

  it('a firing always gets its cutscene, even after the day\'s slot is used', async () => {
    const w = world(); await slackers(w, [TOM, SAM, LENA]);
    w.accountability!.warnings[TOM] = { tick: 1, taskId: 'x', expires: 999 };
    const r = await review(w, nextDayClose(STANDUP));
    const fired = r.meetings.find(m => m.agent === TOM)!;
    assert.equal(fired.outcome, 'fired'); assert.equal(fired.cutscene, true);
    assert.equal(r.meetings.filter(m => m.cutscene && m.outcome === 'warning').length, 1);
  });

  it('the LLM writes the lines when it can; templates otherwise', async () => {
    const good: TurnProvider = async (_a, ctx) => ctx.meeting ? { boss_line: 'Tom, this is your warning.', reply_line: 'Understood.', inner_line: 'I need to sort this out.' } : null;
    const bad: TurnProvider = async () => ({ boss_line: 'word '.repeat(40) });
    for (const [provider, mode, source] of [[good, 'llm_bias', 'llm'], [bad, 'llm_bias', 'template'], [good, 'rules', 'template']] as const) {
      const w = world(); await slackers(w, [TOM]);
      const r = await review(w, nextDayClose(STANDUP), provider, mode);
      assert.equal(r.meetings[0].source, source);
      assert.ok(r.meetings[0].lines.boss && r.meetings[0].lines.reply && r.meetings[0].lines.inner);
    }
  });
});

describe('accountability: chase effects', () => {
  it('being chased raises the owner\'s work share in rules mode, and is logged', async () => {
    const w = world(); const t = assign(w, 'service-0', TOM); overdueInternally(w, t);
    w.tick = STANDUP;
    const before = decide({ agent: w.agents[TOM], world: w, llm: null, mode: 'rules', rngs: rngFactory(7, STANDUP, TOM), params: P });
    await standupAt(w);
    const situational = chaseSituation(w, TOM, P);
    assert.ok(situational);
    const after = decide({ agent: w.agents[TOM], world: w, llm: null, mode: 'rules', rngs: rngFactory(7, STANDUP, TOM), params: P, options: { situational } });
    assert.ok((after.probs.work ?? 0) + (after.probs.overwork ?? 0) > (before.probs.work ?? 0) + (before.probs.overwork ?? 0));
    assert.ok((after.probs.slack_off ?? 0) < (before.probs.slack_off ?? 0));
    assert.equal(after.log.situational?.source, 'chased');
  });

  it('a chased owner whose task is blocked is pushed to raise it with management', async () => {
    const w = world(); const t = assign(w, 'service-0', TOM); overdueInternally(w, t);
    const dep = assign(w, 'service-1', SAM); t.dependencies = [dep.id];
    await standupAt(w);
    assert.equal(chaseSituation(w, TOM, P)!.modifiers.report_issue, P.accountability.chased.blockedReportIssue);
  });
});

describe('accountability: determinism', () => {
  async function run(seed: number, diagnostics: boolean) {
    let w = createWorld(fixtureCast(seed), seed);
    const provider = driftingStaff(seed);
    for (let i = 0; i < 48; i++) w = (await runTick(w, provider, { mode: 'llm_bias', scenario: LEADERBOARD_SCENARIO, gossip: true, billboard: true, business: true, diagnostics })).world;
    return w;
  }
  it('same seed, same chases, fault decisions and meetings; the inbox being off changes nothing', async () => {
    const a = await run(3, true), b = await run(3, true), c = await run(3, false);
    assert.ok(a.accountability!.stats.chases > 0);
    assert.deepEqual(a.accountability, b.accountability);
    assert.deepEqual(a.accountability, c.accountability);
  });
  it('can be switched off in params', async () => {
    const off: Params = { ...P, accountability: { ...P.accountability, enabled: false } };
    let w = createWorld(fixtureCast(3), 3);
    for (let i = 0; i < 20; i++) w = (await runTick(w, null, { mode: 'rules', scenario: [], gossip: true, billboard: true, business: true }, off)).world;
    assert.equal(w.accountability?.stats.chases ?? 0, 0);
  });
});
