import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OfficeSimManager } from '../index';
import { createStubProvider } from '../stub-provider';
import type { TurnProvider } from '../engine-types';
// Never consume the developer's live API key during deterministic API checks.
process.env.ANTHROPIC_API_KEY = '';
const temp = () => mkdtempSync(join(tmpdir(),'business-api-'));
function gateProvider(phase: string) {
  let release!: () => void; let entered!: () => void; let used = false;
  const reached = new Promise<void>(r => { entered = r; }); const held = new Promise<void>(r => { release = r; });
  const provider: TurnProvider = async (a,ctx) => {
    const current = ctx.management?.kind ?? 'employee';
    if (current === phase && !used) { used = true; entered(); await held; }
    return createStubProvider(42)(a,ctx);
  };
  return { provider,reached,release: () => release() };
}
describe('business API commit and generation isolation', () => {
  it('journals generated custom event effects before accepting the input', async () => {
    const m = new OfficeSimManager(temp()); const id = m.response().run_id!;
    const input = { text: 'Free lunch on Fridays for everyone', is_true: true };
    const commit = m.store.commit.bind(m.store);
    m.store.commit = () => { throw new Error('disk unavailable'); };
    await assert.rejects(m.injectCustom(input),/disk unavailable/);
    assert.equal(m.response().state.queue.length,0);
    m.store.commit = commit; await m.injectCustom(input);
    const queued = m.store.recover(id).queue[0];
    assert.equal(queued.text,input.text); assert.equal(queued.custom,true);
    assert.ok(queued.customEffects); assert.ok(queued.customMeta);
    assert.equal(m.store.read(id).at(-1)!.kind,'input');
  });
  for (const phase of ['ceo','ops','employee']) it(`discards a reset during ${phase} without any old commit or report`, async () => {
    const gate = gateProvider(phase); const m = new OfficeSimManager(temp(),{provider:gate.provider});
    m.injectBusiness({template_id:'client_win'}); const oldRun = m.response().run_id!;
    const pending = m.step(); await gate.reached; m.reset(); const newRun = m.response().run_id!;
    assert.notEqual(oldRun,newRun); gate.release(); await pending;
    assert.equal(m.response().state.tick,0); assert.equal(m.response().state.business!.bookings,0);
    assert.equal(m.store.metadata(oldRun).status,'partial'); assert.equal(m.store.recover(oldRun).tick,0);
    assert.equal(m.store.reports(oldRun).length,0);
  });
  it('retains an injection posted during employee calls for exactly the next tick', async () => {
    const gate = gateProvider('employee'); const m = new OfficeSimManager(temp(),{provider:gate.provider});
    const pending = m.step(); await gate.reached;
    m.injectBusiness({template_id:'cost_review'}); gate.release(); await pending;
    assert.equal(m.response().state.eventState!.cases.filter(e => e.templateId === 'cost_review').length,0);
    assert.equal(m.response().state.queue.length,1);
    await m.step(); assert.equal(m.response().state.queue.length,0);
    assert.equal(m.response().state.eventState!.cases.filter(e => e.templateId === 'cost_review').length,1);
    await m.step(); assert.equal(m.response().state.eventState!.cases.filter(e => e.templateId === 'cost_review').length,1);
  });
  it('generates one completion report, archives it after reset and retains old cutoffs on extension', async () => {
    const directory = temp(); const m = new OfficeSimManager(directory);
    m.settings({max_ticks:1}); await m.step(); await m.reporting.generate(m.response().run_id!);
    const id = m.response().run_id!; const first = m.store.reports(id)[0];
    assert.equal(m.store.reports(id).length,1); assert.equal(first.tick,1);
    m.pause(); assert.equal(m.store.reports(id).length,1);
    m.settings({max_ticks:2}); await m.step(); await m.reporting.generate(id);
    assert.equal(m.store.reports(id).length,2); assert.equal(m.store.reports(id)[0].cutoff,first.cutoff);
    const recovered = new OfficeSimManager(directory); assert.equal(recovered.response().state.tick,2);
    recovered.reset(); assert.equal(recovered.store.reports(id).length,2);
  });
  it('never publishes an unjournalled tick and can retry after storage recovers', async () => {
    const m = new OfficeSimManager(temp()); const id = m.response().run_id!;
    const commit = m.store.commit.bind(m.store);
    m.store.commit = () => { throw new Error('disk unavailable'); };
    await assert.rejects(m.step(),/disk unavailable/);
    assert.equal(m.response().state.tick,0); assert.ok(m.response().storage_error);
    m.store.commit = commit; await m.step(); assert.equal(m.response().state.tick,1);
    assert.equal(m.store.read(id).filter(tx => tx.kind === 'tick').length,1);
  });
});
