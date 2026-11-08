import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStubProvider } from '../stub-provider';
import type { TurnProvider, TurnContext } from '../engine-types';
import { isDayEnd } from '../../shared/workday';
process.env.ANTHROPIC_API_KEY = '';
const { OfficeSimManager } = await import('../index');
const directory = () => mkdtempSync(join(tmpdir(), 'reactive-presentation-'));
const waitFor = async (predicate: () => boolean) => {
  const end = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > end) throw new Error('Timed out waiting for tick'); await new Promise(r => setTimeout(r, 10)); }
};

test('play computes one hour, waits for acknowledgement, resumes and clears its gate on reset/recovery', async () => {
  const dir = directory();
  const m = new OfficeSimManager(dir); m.setSpeed({ speed: 4 });
  try {
    m.play(); await waitFor(() => m.response().state.tick === 1);
    await new Promise(r => setTimeout(r, 450));
    assert.equal(m.response().state.tick, 1);
    m.acknowledge({ tick: 1, run_id: m.response().run_id });
    await waitFor(() => m.response().state.tick === 2);
    m.acknowledge({ tick: 0 }); // stale acknowledgements cannot move the gate backwards
    await new Promise(r => setTimeout(r, 450));
    assert.equal(m.response().state.tick, 2);
    m.pause();
    assert.throws(() => m.acknowledge({ tick: 3 }), /already computed/);
    assert.throws(() => m.acknowledge({ tick: -1 }), /already computed/);
    const oldRun = m.response().run_id;
    m.reset();
    assert.throws(() => m.acknowledge({ tick: 0, run_id: oldRun }), /previous run/);
    m.play(); await waitFor(() => m.response().state.tick === 1); m.pause();
    const recovered = new OfficeSimManager(dir);
    try { recovered.play(); await waitFor(() => recovered.response().state.tick === 2); }
    finally { recovered.pause(); }
    m.reseed(44); m.play(); await waitFor(() => m.response().state.tick === 1);
  } finally { m.pause(); }
});

test('step bypasses the gate and factual daily reports appear only at 23:00', async () => {
  const m = new OfficeSimManager(directory());
  for (let n = 1; n <= 16; n++) {
    await m.step();
    const frame = m.history().history.at(-1)!;
    assert.equal(Boolean(frame.day_report), isDayEnd(n));
    if (!isDayEnd(n)) continue;
    assert.deepEqual(frame.day_report!.fillerDays, n === 8 ? [2, 3] : [5, 6]);
    assert.ok(frame.day_report!.lines.includes('No announcements today.'));
    assert.ok(Object.values(frame.state.agents).filter(a => a.status === 'active').every(a => a.present === false));
  }
});

test('business banners expose exactly management disclosure and preserve private cases for spectators', async () => {
  for (const share of [false, true]) {
    const seen: TurnContext[] = [];
    const stub = createStubProvider(42);
    const provider: TurnProvider = async (agent, ctx) => {
      const result = await stub(agent, ctx) as any;
      if (ctx.management?.kind === 'ceo' && share) for (const c of result.choices) {
        c.communicate = ['gossip']; c.acceptance = 'An independent delivery review is required.';
      }
      if (ctx.work) seen.push(ctx);
      return result;
    };
    const m = new OfficeSimManager(directory(), { provider });
    m.reseed(42); m.injectBusiness({ template_id: 'client_win' }); await m.step();
    const frame = m.history().history.at(-1)!;
    const event = frame.events.find(e => e.business_id === frame.state.eventState!.cases[0].id);
    assert.ok(frame.state.eventState!.cases.length > 0);
    assert.equal(Boolean(event), share);
    if (share) {
      assert.match(event!.text, /Shared with/);
      assert.ok(event!.text.includes('An independent delivery review is required.'));
      assert.ok(!event!.text.includes(frame.state.eventState!.cases[0].headline));
      const recipient = seen.find(c => c.work!.evidence.some(e => e.source === 'ceo'));
      assert.ok(recipient);
    }
  }
});
