import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CompanyTask } from '../../shared/companyTasks';
import { makeTask } from '../business';
import { companyLimits } from '../company-tasks/config';
import { newCompanyTask } from '../company-tasks/state';
import type { TurnProvider, World } from '../engine-types';
import { createTurnProvider } from '../llm';
import { DEFAULT_PARAMS } from '../params';
import { fixtureCast } from '../scripts/fixture';
import { createStubProvider } from '../stub-provider';
import { createWorld, queueEvent, runTick, type TickConfig } from '../tick';

const seed = 42;
const objective = 'Investigate demand for a new service and plan its launch.';
const config: TickConfig = { business: true, mode: 'llm_raw', scenario: [], gossip: true, billboard: false };
const params = { ...DEFAULT_PARAMS, voice: { ...DEFAULT_PARAMS.voice, enabled: false } };
const fixed = createStubProvider(seed);
const plan = {
  assumptions: ['Pilot buyers can be modeled using a synthetic cohort.'],
  constraints: ['Respect client service obligations.'],
  rationale: 'Validate demand, then prepare and review a bounded service pilot.',
  effect: 'reviewed_release',
  work: [
    { title: 'Identify demand for the proposed service', category: 'research', department: 'Sales', effort: 2, dependsOn: [], acceptance: 'Record buyer segment and demand constraint.' },
    { title: 'Design a pilot based on Sales findings', category: 'engineering', department: 'Engineering', effort: 2, dependsOn: [1], acceptance: 'Use the received constraint to scope the pilot.' },
    { title: 'Validate the pilot release', category: 'engineering', department: 'Engineering', effort: 1, dependsOn: [2], acceptance: 'Pass independent acceptance of the pilot.' },
  ],
};

const provider: TurnProvider = (agent, ctx) => ctx.companyTurn
  ? Promise.resolve(ctx.companyTurn.kind === 'brief' ? plan : { tone: 'warm', action: 'send' })
  : fixed(agent, ctx);

function setup(deadline = 32, prompt = objective, runId = 'test-run', runSeed = seed) {
  const w = createWorld(fixtureCast(runSeed), runSeed, params);
  w.business.tasks = Object.values(w.business.positions)
    .filter(p => p.role === 'employee')
    .map(p => makeTask(`test-routine-${p.id}`, p.department === 'Engineering' ? 'support' : 'sales',
      p.department as 'Engineering' | 'Sales' | 'Operations', 'Routine service work', 48, 96));
  w.companyTasks = [newCompanyTask({ run_id: runId, idempotency_key: 'once', objective: prompt, deadline_ticks: deadline }, w)];
  return w;
}

const missionOf = (w: World) => w.companyTasks![0];
const tick = (w: World, p = provider, patch: Partial<TickConfig> = {}) => runTick(w, p, { ...config, ...patch }, params);

async function runUntil(world: World, stop: (mission: CompanyTask) => unknown, p = provider, max = 64) {
  let w = world;
  while (!stop(missionOf(w)) && w.tick < max) w = (await tick(w, p)).world;
  return w;
}

describe('company work and collaboration', () => {
  it('dispatches company turns through the Anthropic SDK with bounded requests and validated replies', async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-only-not-a-real-key';
    const intents: string[] = [];
    try {
      const transport = createTurnProvider({
        fetch: async (input, init) => {
          const request = new Request(input, init);
          assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
          const body = await request.json();
          const prompt = body.messages[0].content;
          const briefing = body.max_tokens === 2200;
          intents.push(briefing ? 'brief' : 'message');
          if (briefing) {
            assert.ok(prompt.includes(objective));
            assert.ok(prompt.includes('"staffing"'));
          } else {
            assert.equal(body.max_tokens, 120);
            assert.ok(prompt.includes('"mayWait":false'));
            assert.ok(!prompt.includes('"knownFinding"'));
          }
          return Response.json({
            id: 'msg_company_test', type: 'message', role: 'assistant',
            content: [{ type: 'text', text: JSON.stringify(briefing ? plan : { tone: 'concise', action: 'send' }) }],
            stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 19, output_tokens: 11 },
          });
        },
      });
      const result = await tick(setup(), (agent, ctx) => ctx.companyTurn ? transport(agent, ctx) : fixed(agent, ctx));
      const mission = missionOf(result.world);
      assert.deepEqual(intents, ['brief', 'message', 'message']);
      assert.equal(mission.activity.find(a => a.kind === 'brief')?.decision?.inference?.inputTokens, 19);
      assert.ok(mission.activity.filter(a => a.message).every(a => a.source === 'model'));
    } finally {
      if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = key;
    }
  });

  it('commits a grounded Sales handoff before Engineering can consume it, then prices one verified release', async () => {
    let w = setup();
    const first = await tick(w);
    w = first.world;
    const mission = missionOf(w);
    const [research, design] = mission.brief!.workIds;
    assert.equal(mission.activity.find(a => a.kind === 'brief')?.decision?.source, 'model');
    assert.equal(mission.activity.find(a => a.kind === 'assignment')?.actor, 'ops');
    assert.equal(mission.findings.length, 0);
    assert.ok(mission.activity.some(a => a.message?.kind === 'incomplete' && a.message.sourceTaskId === research));
    assert.ok(!w.business.work.some(r => r.taskId === design && r.progress > 0));
    const conversation = first.log.companyActivity!.filter(a => a.message);
    assert.equal(conversation[0].message!.kind, 'request');
    assert.equal(conversation[1].message!.replyTo, conversation[0].id);
    assert.equal(conversation[1].source, 'model');
    const researcher = conversation[1].actor!;
    assert.equal(w.business.work.find(r => r.agent === researcher)?.progress, 0.6);
    assert.equal(w.business.tasks.find(t => t.id === research)?.allocated, 1);

    w = await runUntil(w, task => task.outcome);
    const done = missionOf(w);
    assert.equal(done.outcome?.state, 'accepted');
    const handoff = done.activity.find(a => a.taskId === design && a.message?.kind === 'finding')!;
    const finding = done.findings.find(f => f.id === handoff.message!.findingId)!;
    assert.equal(w.business.positions[handoff.actor!].department, 'Sales');
    assert.equal(w.business.positions[handoff.recipients[0]].department, 'Engineering');
    assert.ok(finding.completedTick < handoff.tick);
    assert.ok(finding.knownBy.includes(handoff.recipients[0]));
    assert.equal(done.work[design].consumedFindings[research], finding.id);
    assert.ok(done.work[design].firstProgressTick! >= handoff.tick);
    assert.ok(done.outcome.newsCaseId);
    assert.equal(w.price.news.filter(n => n.id === `case-${done.outcome!.newsCaseId}`).length, 1);
    const outcomeTick = w.tick;
    w = (await tick(w)).world;
    assert.equal(w.price.news.filter(n => n.id === `case-${done.outcome!.newsCaseId}`).length, 1);
    assert.equal(missionOf(w).outcome?.tick, outcomeTick);
    assert.equal(missionOf(w).activity.filter(a => a.kind === 'outcome').length, 1);
    assert.ok(done.activity.some(a => a.kind === 'restored'));
    assert.equal(new Set(w.business.work.map(r => r.id)).size, w.business.work.length);
    assert.equal(w.priceRecord?.operating?.productiveUnits, w.business.work.filter(r => r.tick === w.tick).reduce((n, r) => n + r.progress, 0));

    for (const entry of done.activity.filter(a => a.message)) {
      const messages = done.activity.filter(a => a.tick === entry.tick && a.message);
      assert.ok(messages.length <= companyLimits.messagesPerTick);
      assert.ok(messages.filter(a => a.actor === entry.actor).length <= companyLimits.authoredPerTick);
      if (entry.message!.replyTo) {
        const request = done.activity.find(a => a.id === entry.message!.replyTo)!;
        assert.ok(request.tick < entry.tick || request.round < entry.round);
      }
      for (const id of [entry.actor!, ...entry.recipients]) {
        const reserved = messages.filter(a => a.actor === id || a.recipients.includes(id)).length * companyLimits.messageCost;
        const progress = w.business.work.find(r => r.tick === entry.tick && r.agent === id);
        if (progress) assert.ok(progress.progress <= (1 - reserved) * (progress.action === 'overwork' ? 1.2 : 1) + 0.0001);
      }
    }
  });

  it('turns disengagement into delayed effort and carries an escalation across office close', async () => {
    const distracted: TurnProvider = (agent, ctx) => ctx.tick <= 5 && ctx.work?.assignments.some(t => t.id === 'company-work-1-1')
      ? Promise.resolve({ proposals: [{ action: 'slack_off', weight: 1 }], public_line: 'I need a minute.', inner_monologue: 'I can pick this up later.', beliefs: {} })
      : provider(agent, ctx);
    const good = await runUntil(setup(12), task => task.outcome);
    const slow = await runUntil(setup(12), task => task.outcome, distracted);
    const result = missionOf(slow);
    assert.equal(result.outcome?.state, 'accepted');
    assert.equal(result.outcome.timing, 'late');
    assert.ok(result.outcome.tick > missionOf(good).outcome!.tick);
    assert.ok(result.activity.some(a => a.result === 'slack_off' && a.taskId === 'company-work-1-1'));
    const escalation = result.activity.find(a => a.message?.kind === 'escalation')!;
    const decision = result.activity.find(a => a.kind === 'priority' && a.decision?.evidence.includes(escalation.id));
    assert.equal(escalation.recipients[0], 'ops');
    assert.ok(decision && decision.tick > escalation.tick);
  });

  it('lets a supplier incident interrupt an objective without starving available engineers', async () => {
    const ready = await runUntil(setup(), task => task.work['company-work-1-2']?.firstProgressTick);
    const interrupted = queueEvent(ready, { type: 'new_management', templateId: 'supplier_withdrawal', isTrue: true });
    const shock = (await tick(interrupted)).world;
    assert.ok(shock.business.supplierAvailableAt > shock.tick);
    assert.ok(missionOf(shock).activity.some(a => a.kind === 'assignment' && a.tick === shock.tick && a.result?.includes('supplier')));
    assert.ok(shock.business.work.some(r => r.tick === shock.tick && r.taskId?.startsWith('test-routine-') && r.progress > 0 && shock.business.positions[r.agent].department === 'Engineering'));
    assert.ok(shock.business.ledger.some(l => l.category === 'response' && l.tick === shock.tick));
    const done = await runUntil(shock, task => task.outcome);
    const healthy = await runUntil(ready, task => task.outcome);
    assert.ok(missionOf(done).outcome!.tick > missionOf(healthy).outcome!.tick);
  });

  it('repeats independent review after genuine canonical rework', async () => {
    let w = await runUntil(setup(), task => task.status === 'review');
    const final = w.business.tasks.find(t => t.id === missionOf(w).brief!.workIds.at(-1))!;
    assert.equal(final.status, 'review');
    final.error = true; // Exercise the existing defect result without changing quality probabilities.
    w = (await tick(w)).world;
    assert.equal(missionOf(w).work[final.id].rework, 1);
    assert.equal(w.business.tasks.find(t => t.id === final.id)!.remaining, 1);
    assert.equal(missionOf(w).outcome, undefined);
    w = await runUntil(w, task => task.outcome);
    assert.equal(missionOf(w).outcome?.state, 'accepted');
    const reviews = w.business.work.filter(r => r.taskId === final.id && r.action === 'review_work' && r.progress > 0);
    assert.equal(reviews.length, 2);
    assert.ok(reviews.every(r => r.agent !== missionOf(w).work[final.id].author));
  });

  it('records a real departure, transfers remaining research, and preserves a departed producer’s finished artifact', async () => {
    let w = (await tick(setup())).world;
    const researchId = missionOf(w).brief!.workIds[0];
    const departing = w.business.tasks.find(t => t.id === researchId)!.owner!;
    Object.assign(w.agents[departing].state, { burnout: 100, loyalty: 0, trust_mgmt: 0 });
    w.agents[departing].profile.traits.quit_threshold = 10;
    w = (await tick(w)).world;
    assert.equal(w.agents[departing].status, 'quit');
    assert.ok(missionOf(w).activity.some(a => a.kind === 'departure' && a.taskId === researchId && a.actor === departing));
    w = await runUntil(w, task => task.findings.some(f => f.taskId === researchId));
    const producer = missionOf(w).findings[0].producer;
    assert.notEqual(producer, departing);
    assert.ok(missionOf(w).activity.some(a => a.kind === 'assignment' && a.taskId === researchId && a.recipients[0] === producer));
    w.agents[producer].status = 'quit';
    w.agents[producer].quitTick = w.tick;
    w = await runUntil(w, task => task.outcome);
    assert.equal(missionOf(w).outcome?.state, 'accepted');
    assert.ok(missionOf(w).activity.some(a => a.message?.kind === 'retrieve' && a.actor === 'ops'));
  });

  it('uses a feasible rules plan for an operations objective when the model returns invalid work', async () => {
    const bad: TurnProvider = (a, c) => c.companyTurn?.kind === 'brief'
      ? Promise.resolve({ ...plan, work: plan.work.map(item => ({ ...item, dependsOn: [3] })) }) : provider(a, c);
    const w = await runUntil(setup(32, 'Improve the internal handover process across teams.'), task => task.outcome, bad);
    const mission = missionOf(w);
    assert.equal(mission.activity.find(a => a.kind === 'brief')?.decision?.source, 'fallback');
    assert.equal(mission.activity.find(a => a.kind === 'brief')?.decision?.inference?.attempts, 2);
    assert.equal(mission.brief?.effect, 'ordinary_work');
    assert.equal(mission.outcome?.state, 'accepted');
    assert.ok(w.business.tasks.some(t => mission.work[t.id] && t.department === 'Operations'));
  });

  it('allows one model-selected reminder delay while preserving the mandatory handoff', async () => {
    const wait: TurnProvider = (agent, ctx) => {
      if (ctx.companyTurn?.kind === 'message') return Promise.resolve({ tone: 'concise', action: 'wait' });
      if (ctx.tick <= 5 && ctx.work?.assignments.some(t => t.id === 'company-work-1-1')) {
        return Promise.resolve({ proposals: [{ action: 'slack_off', weight: 1 }], public_line: 'I need a minute.', inner_monologue: 'I can pick this up later.', beliefs: {} });
      }
      return provider(agent, ctx);
    };
    const w = await runUntil(setup(), task => task.outcome, wait);
    const mission = missionOf(w);
    assert.equal(mission.outcome?.state, 'accepted');
    const reminders = mission.activity.filter(a => a.kind === 'deferred_message');
    assert.ok(reminders.length > 0);
    assert.equal(new Set(reminders.map(a => a.threadId)).size, reminders.length);
    assert.ok(reminders.every(a => a.source === 'model' && a.recipients.length === 0));
    assert.ok(mission.activity.some(a => a.message?.kind === 'finding' && a.source === 'fallback'));
  });

  it('keeps unfinished research truthful until the recovery period expires', async () => {
    const stopped: TurnProvider = (agent, ctx) => ctx.work
      ? Promise.resolve({ proposals: [{ action: 'slack_off', weight: 1 }], public_line: 'I need a minute.', inner_monologue: 'I can pick this up later.', beliefs: {} })
      : provider(agent, ctx);
    const w = await runUntil(setup(4), task => task.outcome, stopped);
    const mission = missionOf(w);
    assert.equal(mission.outcome?.state, 'failed');
    assert.equal(mission.outcome?.timing, 'late');
    assert.equal(mission.outcome?.tick, mission.deadlineTick! + companyLimits.graceTicks);
    assert.deepEqual(mission.findings, []);
    assert.ok(mission.activity.some(a => a.message?.kind === 'incomplete'));
    assert.ok(mission.outcome.criteria.every(c => !c.accepted));
    assert.ok(w.business.tasks.filter(t => mission.work[t.id]).every(t => t.status === 'cancelled' && t.allocated === 0));
  });

  it('reuses personality and pressure to change research timing across paired rules seeds', async () => {
    const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
    const totals = [];
    for (const pressured of [false, true]) {
      let total = 0;
      for (const runSeed of seeds) {
        let w = setup(12, objective, 'paired', runSeed);
        for (const id of ['gossip', 'climber']) {
          Object.assign(w.agents[id].state, { stress: pressured ? 92 : 10, burnout: pressured ? 80 : 10, loyalty: pressured ? 18 : 92, trust_mgmt: pressured ? 24 : 90 });
          Object.assign(w.agents[id].profile.traits, { ambition: pressured ? 20 : 85, financial_need: pressured ? 10 : 90, impulsivity: 92, quit_threshold: 100 });
        }
        while (w.tick < 24 && !missionOf(w).work['company-work-1-1']?.completedTick) {
          w = (await tick(w, provider, { mode: 'rules' })).world;
        }
        total += missionOf(w).work['company-work-1-1'].completedTick ?? 25;
      }
      totals.push(total);
    }
    assert.ok(totals[1] > totals[0], `Research ticks under low/high pressure: ${totals.join('/')}`);
  });

  it('keeps run identity out of seeded work quality and valuation', async () => {
    const [a, b] = await Promise.all(['first-run', 'second-run'].map(id => runUntil(setup(32, objective, id), task => task.outcome)));
    assert.deepEqual(a.business, b.business);
    assert.deepEqual(a.price, b.price);
    assert.deepEqual(missionOf(a).findings, missionOf(b).findings);
    assert.deepEqual(missionOf(a).outcome, missionOf(b).outcome);
  });
});
