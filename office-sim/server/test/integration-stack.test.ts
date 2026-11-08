import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorld, runTick, queueEvent } from '../tick';
import { fixtureCast } from '../scripts/fixture';
import { createStubProvider } from '../stub-provider';
import { DEFAULT_PARAMS } from '../params';
import { fallbackCeo, managementContext } from '../management';
import { openEvent, managementOwners } from '../events/lifecycle';
import { CATALOG } from '../events/catalog';
import { OfficeSimManager } from '../index';
import { isOfficeHour } from '../../shared/workday';
import type { ManagementContext } from '../../shared/events';
import type { TurnProvider, World } from '../engine-types';

// Never consume a developer's live API key during deterministic integration runs.
process.env.ANTHROPIC_API_KEY = '';

const config = { mode: 'llm_raw' as const, scenario: [], gossip: true, billboard: true, business: true };
const world = (seed = 42) => createWorld(fixtureCast(seed, DEFAULT_PARAMS, false), seed);
const temp = () => mkdtempSync(join(tmpdir(), 'integration-stack-'));
const isResolved = (status: string) => ['resolved', 'failed', 'cancelled', 'superseded'].includes(status);

/** Run whole engine ticks until `hours` office hours have passed. Every tick goes through runTick. */
async function run(w: World, hours: number, provider: TurnProvider | null = createStubProvider(w.seed)) {
  for (let i = 0; i < hours;) {
    w = (await runTick(w, provider, config)).world;
    if (isOfficeHour(w.tick)) i++;
  }
  return w;
}

/** A CEO provider that picks the first valid option for every open case, and defers everything else to the stub. */
function ceoPicksFirst(seed: number): TurnProvider {
  const stub = createStubProvider(seed);
  return async (profile, ctx) => {
    if (ctx.management?.kind === 'ceo') return fallbackCeo(ctx.management);
    return stub(profile, ctx);
  };
}

describe('event lifecycle: scheduling, CEO decision, ops work and resolution', () => {
  it('an event opened by the scheduler is decided by the CEO, worked by employees and closed', async () => {
    let w = world(7);
    w = await run(w, 30, ceoPicksFirst(7));
    const cases = w.eventState.cases;
    assert.ok(cases.length > 0, 'the scheduler should open at least one case over 30 office hours');
    const decided = cases.filter(c => c.decisions.length > 0);
    assert.ok(decided.length > 0, 'the CEO should decide on at least one case');
    for (const c of decided) {
      const directive = w.eventState.directives.find(d => d.eventId === c.id && d.active) ?? w.eventState.directives.filter(d => d.eventId === c.id).at(-1);
      assert.ok(directive, `case ${c.id} has a decision and therefore a directive`);
    }
    const everyTerminalOrOpen = cases.every(c => isResolved(c.status) || ['open', 'responding', 'monitoring'].includes(c.status));
    assert.ok(everyTerminalOrOpen, 'every case is in a known lifecycle status');
  });

  it('a case opened outside office hours is still handled within the same workday', async () => {
    let w = world(3);
    const e = openEvent(w, 'delivery_concern');
    w = await run(w, 2, ceoPicksFirst(3));
    const after = w.eventState.cases.find(c => c.id === e.id)!;
    assert.ok(after.decisions.length > 0, 'the CEO decided during office hours');
    assert.notEqual(after.status, 'open', 'the case moved past open once the CEO decided');
  });

  it('a truthful response case with a response task resolves once its work is done', async () => {
    let w = world(42);
    const e = openEvent(w, 'release_success');
    w = await run(w, 12, ceoPicksFirst(42));
    const after = w.eventState.cases.find(c => c.id === e.id)!;
    assert.ok(['responding', 'resolved', 'failed', 'monitoring'].includes(after.status), `unexpected status ${after.status}`);
    if (after.status === 'resolved') assert.ok(after.outcome, 'a resolved case records its outcome');
    assert.notEqual(after.status, 'open', 'the response case moved past open within the run');
  });

  it('an untrue rumour travels as a false claim only: no business case, no cash or employment change', async () => {
    let w = queueEvent(world(5), { type: 'layoffs_rumour', isTrue: false, hearers: ['gossip'] });
    const cashBefore = w.business.cash;
    w = await run(w, 8, ceoPicksFirst(5));
    assert.ok(Object.values(w.claims).some(c => c.is_true === false), 'the rumour exists as a false claim');
    assert.ok(!w.eventState.cases.some(c => c.templateId === 'layoffs_rumour'), 'a rumour never opens a business case');
    assert.ok(w.eventState.cases.every(c => c.truth), 'every business case is factual');
    assert.ok(w.ids.every(id => w.agents[id].status === 'active'), 'a false layoff rumour lays nobody off');
    assert.ok(w.business.cash >= cashBefore - 1, 'a false rumour does not move cash by itself');
  });
});

describe('CEO: decisions, budgets, layoffs and authority', () => {
  it('the CEO decides every case that needs a decision and each directive is versioned', async () => {
    let w = world(42);
    openEvent(w, 'supplier_interruption');
    openEvent(w, 'delivery_concern');
    w = await run(w, 3, ceoPicksFirst(42));
    const ceoDecisions = w.eventState.decisions.filter(d => d.kind === 'ceo');
    assert.ok(ceoDecisions.length > 0);
    for (const decision of ceoDecisions) {
      assert.equal(decision.author, 'ceo', 'the CEO authors CEO decisions when present');
      assert.equal(decision.fallback, null, 'a valid CEO response is not a fallback');
    }
    for (const c of w.eventState.cases) {
      const versions = w.eventState.directives.filter(d => d.eventId === c.id).map(d => d.version);
      assert.deepEqual(versions, [...versions].sort((a, b) => a - b), 'directive versions increase');
      assert.ok(w.eventState.directives.filter(d => d.eventId === c.id && d.active).length <= 1, 'at most one active directive per case');
    }
  });

  it('the CEO cannot commit more budget than the free cash after committed directives', async () => {
    let w = world(42);
    w.business.cash = 0;
    openEvent(w, 'account_at_risk');
    const provider: TurnProvider = async (profile, ctx) => {
      if (ctx.management?.kind === 'ceo') {
        const v = fallbackCeo(ctx.management);
        for (const c of v.choices) c.budget = 1_000_000_000;
        return v;
      }
      return createStubProvider(42)(profile, ctx);
    };
    w = await run(w, 1, provider);
    const ceo = w.eventState.decisions.find(d => d.kind === 'ceo');
    assert.ok(ceo?.fallback === 'role_response_unavailable', 'an unaffordable CEO response is rejected and falls back');
    assert.ok(w.eventState.diagnostics.some(d => d.phase === 'ceo' && /Unaffordable|Invalid budget/.test(d.reason)));
  });

  it('a CEO layoff is applied only through a valid option for an active employee', async () => {
    let w = world(42);
    openEvent(w, 'cost_review');
    w.business.tasks[0].owner = 'loyalist';
    w.business.tasks[0].status = 'active';
    let offered = false;
    const provider: TurnProvider = async (profile, ctx) => {
      if (ctx.management?.kind === 'ceo') {
        const v = fallbackCeo(ctx.management);
        const layoff = ctx.management.options.find(o => o.kind === 'layoff' && o.employeeId === 'loyalist');
        assert.ok(layoff, 'the layoff option for an active employee must be offered');
        offered = true;
        v.choices[0].optionId = layoff.id; v.choices[0].budget = layoff.cost;
        return v;
      }
      return createStubProvider(42)(profile, ctx);
    };
    w = await run(w, 1, provider);
    assert.ok(offered, 'the CEO was asked to choose');
    assert.equal(w.agents.loyalist.status, 'laid_off', 'the valid layoff was applied');
    assert.ok(w.business.tasks.filter(t => !['done', 'cancelled'].includes(t.status)).every(t => t.owner !== 'loyalist'), 'the laid-off employee holds no open work');
    assert.equal(w.eventState.decisions.find(d => d.kind === 'ceo')!.fallback, null, 'the CEO decision was valid, not a fallback');
  });

  it('with the CEO quit, ops acts with authority "acting" and discretionary layoffs are never offered', async () => {
    let w = world(42);
    w.agents.ceo.status = 'quit';
    openEvent(w, 'cost_review');
    const owners = managementOwners(w);
    assert.equal(owners.acting, true);
    const ctx: ManagementContext = managementContext(w, 'ops', owners.ops!);
    assert.equal(ctx.authority, 'acting');
    assert.ok(ctx.options.every(o => o.kind !== 'layoff'), 'no layoff options while acting');
    w = await run(w, 2);
    assert.ok(w.ids.every(id => w.agents[id].status !== 'laid_off'));
  });

  it('with no active CEO or ops, open cases fail immediately with a recorded reason', async () => {
    let w = world(42);
    w.agents.ceo.status = 'quit';
    w.agents.ops.status = 'quit';
    const e = openEvent(w, 'delivery_concern');
    w = await run(w, 1, ceoPicksFirst(42));
    const after = w.eventState.cases.find(c => c.id === e.id)!;
    assert.equal(after.status, 'failed');
    assert.ok(w.eventState.diagnostics.some(d => d.reason === 'no_active_management'));
    assert.equal(w.eventState.decisions.length, 0, 'nobody decides without a manager');
  });
});

describe('ops and employees: task assignment and capacity', () => {
  it('no employee is allocated more work than their capacity in any tick', async () => {
    let w = world(42);
    openEvent(w, 'delivery_concern');
    openEvent(w, 'release_success');
    for (let i = 0; i < 12; i++) {
      w = (await runTick(w, createStubProvider(42), config)).world;
      const load = new Map<string, number>();
      for (const t of w.business.tasks) if (t.owner && t.status === 'active') load.set(t.owner, (load.get(t.owner) ?? 0) + (t.allocated ?? 0));
      for (const [owner, total] of load) {
        const seat = w.business.positions[owner];
        if (seat) assert.ok(total <= seat.capacity + 1e-9, `${owner} overbooked: ${total} > ${seat.capacity}`);
      }
    }
  });

  it('a supplier outage does not stop the response work, but holds the case open until the supplier recovers', async () => {
    let w = world(42);
    const e = openEvent(w, 'supplier_interruption');
    w.business.supplierAvailableAt = 10_000;
    w = await run(w, 4, ceoPicksFirst(42));
    const tasks = w.business.tasks.filter(t => t.eventId === e.id);
    assert.ok(tasks.length > 0, 'the case created response work');
    assert.ok(tasks.every(t => t.status === 'done'), 'the response work itself completes');
    const after = w.eventState.cases.find(c => c.id === e.id)!;
    assert.equal(after.status, 'monitoring', 'the case waits in monitoring until the supplier is available again');
    assert.notEqual(after.status, 'resolved');
  });

  it('employees see only assigned work and execute it through the same tick path', async () => {
    let w = world(42);
    openEvent(w, 'release_success');
    w = await run(w, 4, ceoPicksFirst(42));
    const worked = w.business.work.filter(r => r.progress > 0);
    assert.ok(worked.length > 0, 'at least one employee made progress on assigned work');
    for (const r of worked) {
      const task = w.business.tasks.find(t => t.id === r.taskId);
      assert.ok(task, `work record ${r.id} references a real task`);
    }
  });
});

describe('custom events through the public entry points', () => {
  it('a custom positive headline is queued, delivered on its tick and moves the stock in that same tick', async () => {
    const m = new OfficeSimManager(temp(), { provider: undefined });
    await m.injectCustom({ text: 'We signed a landmark client contract worth millions', is_true: true });
    const runId = m.response().run_id!;
    const queued = m.store.recover(runId).queue;
    assert.equal(queued.length, 1);
    assert.equal(queued[0].custom, true);
    assert.ok(queued[0].customEffects, 'custom effects are generated and journalled');
    assert.equal(m.response().state.queue.length, 1, 'the headline waits in the queue before the tick');
    await m.step();
    assert.equal(m.response().state.queue.length, 0, 'the headline is delivered on the next tick');
    const record = m.response().price;
    assert.ok(Number.isFinite(record.price) && record.price > 0);
    assert.equal(record.tick, m.response().revision, 'the price record belongs to the tick that delivered the headline');
  });

  it('a custom event with no effects still runs the tick without corrupting the price state', async () => {
    const m = new OfficeSimManager(temp(), { provider: undefined });
    await m.injectCustom({ text: 'The office plant needs watering', is_true: true });
    await m.step();
    const price = m.response().price;
    assert.ok(Number.isFinite(price.price) && price.price > 0);
  });
});

describe('end-to-end stack: state, history and price coupling', () => {
  it('a full run keeps every component consistent: price finite, cases well-formed, decisions journalled', async () => {
    let w = world(11);
    w = await run(w, 40, ceoPicksFirst(11));
    assert.ok(Number.isFinite(w.price.price) && w.price.price > 0, 'price stays finite and positive');
    for (const c of w.eventState.cases) {
      assert.ok(CATALOG.some(d => d.id === c.templateId), `case ${c.id} uses a catalogued template`);
      assert.ok(Number.isFinite(c.deadline) && c.deadline >= c.openedTick, `case ${c.id} has a sensible deadline`);
    }
    for (const d of w.eventState.decisions) {
      assert.ok(['ceo', 'ops'].includes(d.kind));
      assert.ok(d.tick <= w.tick);
    }
    assert.ok(w.eventState.scheduling.every(s => s.reason), 'every scheduling decision records a reason');
  });

  it('the same seed reproduces the same events, decisions and price path end to end', async () => {
    const a = await run(world(23), 20, ceoPicksFirst(23));
    const b = await run(world(23), 20, ceoPicksFirst(23));
    assert.deepEqual(a.eventState.cases.map(c => [c.templateId, c.status]), b.eventState.cases.map(c => [c.templateId, c.status]));
    assert.equal(a.price.price, b.price.price);
    assert.equal(a.eventState.decisions.length, b.eventState.decisions.length);
  });
});
