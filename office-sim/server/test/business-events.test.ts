import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorld, runTick, queueEvent, buildContext } from '../tick';
import { fixtureCast } from '../scripts/fixture';
import { createTurnProvider } from '../llm';
import { createStubProvider } from '../stub-provider';
import { fallbackCeo, fallbackOps, managementContext } from '../management';
import { openEvent, interval } from '../events/lifecycle';
import { RunStore } from '../run-store';
import { Reporting, factsFor, validateReport } from '../reporting';
import { DEFAULT_PARAMS } from '../params';
import { BUSINESS_PARAMS, makeTask, openBusinessTick, validateOrganisation } from '../business';
import { calendarSpan, days, isOfficeHour, TICKS_PER_DAY, TICKS_PER_MONTH } from '../../shared/workday';
import { CATALOG, eligible } from '../events/catalog';
import { employeeSchema } from '../llm/schemas';
import { toLlmOutput } from '../llm-adapter';
import { executeWork, workContext } from '../tasks';
import { availableActions, decide } from '../bias';
import { rngFactory } from '../rng';
import type { ManagementContext } from '../../shared/events';
import type { TurnContext, TurnProvider, World } from '../engine-types';
const config = { mode: 'llm_raw' as const, scenario: [], gossip: true, billboard: false, business: true };
function world(seed = 42) { return createWorld(fixtureCast(seed,DEFAULT_PARAMS,false),seed); }
/** Run `hours` office hours (09:00-17:00), plus any evening hours in between: step counts here are in working hours. */
async function advance(w: World, hours: number, provider: TurnProvider | null = createStubProvider(w.seed)) {
  for (let i = 0; i < hours;) {
    w = (await runTick(w,provider,config)).world;
    if (isOfficeHour(w.tick)) i++;
  }
  return w;
}
const temp = () => mkdtempSync(join(tmpdir(),'business-events-'));
const options = (ctx: TurnContext) => ctx.management!;

describe('business model invariants', () => {
  it('accrues exactly thirty days of payroll over a month, including skipped days', () => {
    const w = world();
    const salary = Object.values(w.business.positions).reduce((n,p) => n+p.dailySalary,0);
    for (let tick = 1; tick <= TICKS_PER_MONTH; tick++) { w.tick = tick; openBusinessTick(w); }
    assert.equal(calendarSpan(0,TICKS_PER_MONTH),30);
    assert.equal(w.business.ledger.filter(l => l.category === 'payroll').reduce((n,l) => n+l.amount,0),salary*30);
    const count = w.business.ledger.length; openBusinessTick(w); assert.equal(w.business.ledger.length,count);
    assert.throws(() => validateOrganisation({ a: { ...w.business.positions.ceo,id:'a',supervisor:'a' } }));
  });
  it('defines exactly sixteen common and eight rare eligible families', () => {
    assert.equal(CATALOG.filter(d => d.rarity === 'common').length,16);
    assert.equal(CATALOG.filter(d => d.rarity === 'rare').length,8);
    const w = world();
    for (const d of CATALOG) { assert.ok(d.acceptance); assert.ok(d.cooldown); assert.ok(d.deadline); }
    assert.equal(eligible(w,CATALOG.find(d => d.id === 'release_success')!),false);
    w.business.opportunities.forEach(o => o.stage = 'signed');
    assert.equal(eligible(w,CATALOG.find(d => d.id === 'client_win')!),false);
    for (let seed = 1; seed <= 100; seed++) for (let index = 0; index < 30; index++) {
      const c = interval(seed,'common',index); const r = interval(seed,'rare',index);
      assert.ok(c >= days(2) && c <= days(4)); assert.ok(r >= days(8) && r <= days(12));
    }
  });
});

describe('role calls through the actual Anthropic prompt, parser, schemas and engine', () => {
  it('orders CEO → Ops → employees and books, earns and collects one client contract', async () => {
    const old = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'test-only';
    const calls: Array<{ kind: string; ctx: unknown }> = [];
    const provider = createTurnProvider({ fetch: async (_url,init) => {
      const request = JSON.parse(String(init?.body)); const prompt = request.messages[0].content as string;
      const managementLine = prompt.split('\n').find(l => l.startsWith('{"schemaVersion":1,"kind":') && l.includes('"actor"'));
      let output: unknown;
      if (managementLine) {
        const ctx = JSON.parse(managementLine) as ManagementContext; calls.push({kind:ctx.kind,ctx});
        output = ctx.kind === 'ceo' ? fallbackCeo(ctx) : fallbackOps(ctx);
      } else if (prompt.includes('Small talk only:')) {
        output = { lines: ['Rain again.', 'The bus was late.', 'I made soup.'] };
      } else {
        const prefix = 'Your current role, supervisor, assignments, directive versions and known evidence: ';
        const line = prompt.split('\n').find(l => l.startsWith(prefix))!;
        const ctx = JSON.parse(line.slice(prefix.length)) as NonNullable<TurnContext['work']>;
        const regenerating = prompt.includes('You were going to say:') || prompt.includes('Your thoughts were going to be:');
        calls.push({kind:regenerating ? 'speech' : 'employee',ctx});
        const task = ctx.reviewable[0] ?? ctx.assignments[0];
        output = { proposals: [task ? { action: ctx.reviewable.length ? 'review_work' : 'work', weight: 1, task_id: task.id, assignment_version: task.version } : { action: 'slack_off', weight: 1 }], public_line:'I will follow the current plan.', inner_monologue:'I should check the acceptance criteria.', beliefs:{} };
      }
      return new Response(JSON.stringify({ id:'test', type:'message', role:'assistant', model:'fixture', content:[{type:'text',text:JSON.stringify(output)}], stop_reason:'end_turn', usage:{input_tokens:100,output_tokens:100} }),{ status:200,headers:{'content-type':'application/json'} });
    } });
    try {
      let w = queueEvent(world(),{type:'new_management',templateId:'client_win'});
      const before = structuredClone(w); w = await advance(w,1,provider);
      assert.deepEqual(calls.filter(c => c.kind !== 'speech').map(c => c.kind),['ceo','ops',...Array(6).fill('employee')]);
      assert.ok(calls.slice(8).every(c => c.kind === 'speech'));
      assert.equal(Object.keys(w.speech!.examples).length,6);
      assert.deepEqual(before.business.contracts.length,3);
      assert.equal(w.business.contracts.length,4); assert.equal(w.business.bookings,10_000_000);
      const e = w.eventState.cases[0]; assert.equal(e.target,100_000_000); assert.equal(e.value/e.target,0.1);
      const employeeContexts = calls.filter(c => c.kind === 'employee').map(c => c.ctx as NonNullable<TurnContext['work']>);
      assert.ok(employeeContexts.some(c => c.assignments.some(t => t.eventId === e.id && t.directiveId)));
      assert.ok(employeeContexts.some(c => c.directives.some(d => d.eventId === e.id && d.version === 1)));
      assert.equal(w.business.contracts.at(-1)!.recognised,0); assert.equal(w.business.contracts.at(-1)!.collected,0);
      w = await advance(w,12,provider);
      const c = w.business.contracts.find(c => c.id === `contract-${e.id}`)!;
      assert.equal(c.recognised,10_000_000); assert.equal(c.collected,10_000_000);
      assert.equal(w.business.ledger.filter(l => l.id === `${c.id}-booking`).length,1);
      assert.equal(w.eventState.cases[0].status,'resolved');
    } finally { if (old === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = old; }
  });
});

describe('causal management and information boundaries', () => {
  it('routes a supplier outage, displaces work and waits for external recovery', async () => {
    let w = world(); const e = openEvent(w,'supplier_interruption');
    w.business.supplierAvailableAt = 12;
    w = await advance(w,6);
    assert.ok(w.eventState.decisions.some(d => d.kind === 'ceo' && d.choices.some(c => c.eventId === e.id)));
    assert.notEqual(w.eventState.cases[0].status,'resolved');
    assert.ok(w.business.tasks.some(t => t.status === 'paused'));
    w = await advance(w,7); assert.equal(w.eventState.cases[0].status,'resolved');
  });
  it('creates an employee configuration error, detects it, contains it and verifies recovery separately', async () => {
    let w = world(4);
    w.business.tasks = [makeTask('risky-deployment','release','Engineering','Deploy access configuration',1,15)];
    w.business.tasks[0].reviewRequired = false;
    const base = BUSINESS_PARAMS.errorBase; const max = BUSINESS_PARAMS.errorMax;
    try { BUSINESS_PARAMS.errorBase = 1; BUSINESS_PARAMS.errorMax = 1; w = await advance(w,1); }
    finally { BUSINESS_PARAMS.errorBase = base; BUSINESS_PARAMS.errorMax = max; }
    const incident = w.eventState.cases.find(e => e.templateId === 'configuration_error')!;
    assert.ok(incident); assert.equal(incident.detected,false); assert.equal(incident.origin,'employee');
    const ceo = managementContext(w,'ceo','ceo'); assert.equal(ceo.cases.some(e => e.id === incident.id),false);
    w = await advance(w,1); assert.equal(w.eventState.cases.find(e => e.id === incident.id)!.detected,true);
    assert.ok(w.business.tasks.some(t => t.eventId === incident.id && t.kind === 'containment'));
    w = await advance(w,5);
    const contained = w.eventState.cases.find(e => e.id === incident.id)!;
    assert.equal(contained.contained,true); assert.notEqual(contained.status,'resolved');
    assert.ok(w.business.tasks.some(t => t.eventId === incident.id && t.kind === 'recovery'));
    w = await advance(w,8); assert.equal(w.eventState.cases.find(e => e.id === incident.id)!.status,'resolved');
  });
  it('keeps false layoff information private and leaves payroll and employment unchanged', async () => {
    const w = queueEvent(world(),{ type:'layoffs_rumour',isTrue:false,hearers:['gossip'] });
    const r = await runTick(w,createStubProvider(w.seed),{...config,billboard:true});
    const informed = buildContext(r.world,r.world.agents.gossip,config,r.log.events,DEFAULT_PARAMS);
    const uninformed = buildContext(r.world,r.world.agents.ceo,config,r.log.events,DEFAULT_PARAMS);
    assert.ok(informed.claims.length); assert.equal(uninformed.claims.length,0); assert.equal(uninformed.events.length,0);
    assert.ok(r.world.ids.every(id => r.world.agents[id].status === 'active'));
    assert.equal(r.world.business.positions.gossip.dailySalary,w.business.positions.gossip.dailySalary);
  });
  it('avoids layoffs through executed savings and only executes a specific valid CEO layoff', async () => {
    let w = world(); openEvent(w,'cost_review'); const oldRate = w.business.dailyDiscretionary;
    w = await advance(w,7); assert.equal(w.business.dailyDiscretionary,oldRate-20_000);
    assert.ok(w.eventState.cases[0].outcome?.includes('avoided')); assert.ok(w.ids.every(id => w.agents[id].status === 'active'));
    let laid = world(); const event = openEvent(laid,'cost_review');
    laid.business.tasks[0].owner = 'loyalist'; laid.business.tasks[0].status = 'active';
    const provider: TurnProvider = async (a,ctx) => {
      if (ctx.management?.kind === 'ceo') { const v = fallbackCeo(ctx.management); const option = ctx.management.options.find(o => o.employeeId === 'loyalist')!; v.choices[0].optionId = option.id; v.choices[0].budget = option.cost; return v; }
      return createStubProvider(42)(a,ctx);
    };
    const salary = laid.business.positions.loyalist.dailySalary;
    laid = await advance(laid,1,provider);
    assert.equal(laid.agents.loyalist.status,'laid_off'); assert.equal(laid.eventState.cases[0].id,event.id);
    assert.ok(laid.business.tasks.filter(t => t.status !== 'done').every(t => t.owner !== 'loyalist'));
    const payrollBefore = laid.business.ledger.filter(l => l.category === 'payroll').at(-1)!.amount;
    laid = await advance(laid,1,provider);
    assert.equal(laid.business.ledger.filter(l => l.category === 'payroll').at(-1)!.amount,payrollBefore-salary/TICKS_PER_DAY);
  });
  it('uses safe role fallbacks and acting management without discretionary layoffs', async () => {
    let w = world(); w.agents.ceo.status = 'quit'; openEvent(w,'cost_review');
    w = await advance(w,1,async () => { throw new Error('timeout'); });
    assert.equal(w.eventState.decisions[0].author,'ops');
    assert.ok(w.eventState.decisions.every(d => d.fallback === 'role_response_unavailable'));
    assert.ok(w.ids.every(id => w.agents[id].status !== 'laid_off'));
    assert.ok(w.business.work.some(r => r.progress > 0));
  });
  it('supersedes directives with fresh versions before the next employee calls', async () => {
    let w = world(); openEvent(w,'delivery_concern'); w = await advance(w,1);
    const original = w.eventState.directives[0]; original.reviewTick = 2;
    const contexts: TurnContext[] = [];
    w = await advance(w,1,async (a,ctx) => { contexts.push(ctx); return createStubProvider(w.seed)(a,ctx); });
    assert.equal(w.eventState.directives[0].active,false);
    const latest = w.eventState.directives.at(-1)!; assert.equal(latest.version,2); assert.equal(latest.supersedes,original.id);
    assert.ok(contexts.some(c => c.work?.directives.some(d => d.id === latest.id)));
    assert.ok(!contexts.some(c => c.work?.directives.some(d => d.id === original.id)));
  });
});

describe('employee vocabulary and validation', () => {
  it('preserves two task identities, rejects stale/foreign work and restricts reporting to known evidence', async () => {
    const raw = { proposals:[{ action:'work', weight:1,task_id:'a',assignment_version:1 },{ action:'work',weight:2,task_id:'b',assignment_version:2 }], public_line:'Ready.',inner_monologue:'Ready.',beliefs:{} };
    assert.equal(toLlmOutput(raw).output!.proposals.length,2);
    assert.equal(employeeSchema.safeParse({...raw,proposals:[{action:'report_issue',weight:1}]}).success,false);
    let w = world(); w = await advance(w,1);
    const a = w.agents.loyalist; const context = workContext(w,a);
    const task = context.assignments[0]!; assert.ok(task);
    const d = decide({agent:a,world:w,llm:{...raw,proposals:[{ action:'work',weight:1,task_id:task.id,assignment_version:task.version-1 }]},mode:'llm_raw',rngs:rngFactory(w.seed,w.tick,a.id),params:DEFAULT_PARAMS});
    const before = w.business.tasks.find(t => t.id === task.id)!.remaining;
    assert.match(executeWork(w,a,d),/No eligible/); assert.equal(w.business.tasks.find(t => t.id === task.id)!.remaining,before);
  });
});

describe('durable history and grounded reports', () => {
  it('recovers transactions, ignores a torn tail, detects corruption and makes commits idempotent', async () => {
    const store = new RunStore(temp()); let w = world(); const run = store.create(w);
    w = await advance(w,1); store.commit(run.id,w,'tick',{ actual:'work' }); store.commit(run.id,w,'tick',{ actual:'work' });
    assert.equal(store.read(run.id).length,2);
    appendFileSync(join(store.directory,`${run.id}.journal.jsonl`),'{"partial":');
    assert.deepEqual(store.recover(run.id),w);
    w = await advance(w,1); store.commit(run.id,w,'tick',{}); assert.equal(store.read(run.id).length,3);
    const path = join(store.directory,`${run.id}.journal.jsonl`); const contents = readFileSync(path,'utf8');
    writeFileSync(path,contents.replace('"seed":42','"seed":43'));
    assert.throws(() => store.read(run.id),/Invalid journal/);
  });
  it('retains early evidence beyond the frame window and validates all narrative, figures and references', async () => {
    const store = new RunStore(temp()); let w = world(); openEvent(w,'client_win'); const run = store.create(w);
    // Tick snapshots contain the complete evidence, independent of any 300-frame display window.
    w = await advance(w,305); store.commit(run.id,w,'complete',{});
    const facts = factsFor(store,run.id); assert.ok(facts.evidence.some(e => e.id === 'event-0-1'));
    assert.equal(facts.metrics.revenue,w.business.revenue);
    const reporting = new Reporting(store,async () => ({schemaVersion:1,kind:'report',sections:[{ title:'Business performance',observations:[{ evidenceIds:['made-up'],metricIds:['revenue'],assessment:'observed',text:'Revenue doubled.' }] }]}));
    const [a,b] = await Promise.all([reporting.generate(run.id),reporting.generate(run.id)]);
    assert.equal(a.id,b.id); assert.equal(a.status,'factual_fallback'); assert.equal(a.facts.metrics.revenue,w.business.revenue);
    const restored = new RunStore(store.directory); assert.equal(restored.reports(run.id).length,1);
    assert.throws(() => validateReport({schemaVersion:1,kind:'report',sections:[{title:'Performance',observations:[{ evidenceIds:['run-metrics'],metricIds:['revenue'],assessment:'observed',text:'Revenue is £999 billion.' }]}]},facts),/Unsupported/);
    const second = await reporting.generate(run.id,true); assert.equal(second.version,2); assert.equal(store.reports(run.id).length,2);
    const before = structuredClone(store.recover(run.id)); assert.deepEqual(before,w);
  });
});
