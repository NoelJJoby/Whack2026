import 'dotenv/config';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

import type { TurnProvider } from '../../engine-types';
import { createTurnProvider } from '../../llm';
import { DEFAULT_PARAMS } from '../../params';
import { fixtureCast } from '../../scripts/fixture';
import { buildContext, createWorld, runTick } from '../../tick';
import { buildTurnPrompt } from '../prompt';

// Explicitly live: this script is not included in *.test.ts acceptance runs.
assert.ok(process.env.ANTHROPIC_API_KEY?.trim(), 'BLOCKED: ANTHROPIC_API_KEY is not configured');
const provider = createTurnProvider();
const reports = [];
for (const condition of ['calm', 'high-stress'] as const) {
  const cast = fixtureCast(42);
  for (const member of cast) {
    member.start.stress = condition === 'calm' ? 23 : 83;
    member.start.burnout = condition === 'calm' ? 27 : 87;
  }
  const world = createWorld(cast, 42);
  const scenario = [{ tick: 1, type: 'layoffs_rumour' as const, isTrue: false,
    hearers: world.ids, source: 'ops' }];
  const config = { mode: 'llm_raw', scenario, gossip: true, billboard: true } as const;
  const captured = new Map<string, { prompt: string; output: unknown }>();
  const observed: TurnProvider = async (agent, ctx) => {
    const output = await provider(agent, ctx);
    captured.set(agent.id, { prompt: buildTurnPrompt(agent, ctx), output });
    return output;
  };
  const raw = await runTick(world, observed, config);
  assert.equal(raw.log.decisions.length, 8);
  assert.ok(raw.log.decisions.every(decision => decision.fallback === null),
    'Live engine rejected a response or an API call failed');
  for (const decision of raw.log.decisions) {
    assert.ok(decision.provider);
    assert.ok(decision.provider.usage?.promptTokens);
    assert.ok(decision.provider.usage?.completionTokens);
    assert.ok(decision.provider.latency_ms !== null && decision.provider.latency_ms >= 0);
    assert.equal(decision.provider.cache_hit, false);
  }
  // This is a test-only snapshot replay after engine acceptance, not a cache.
  // It avoids billing twice while proving identical prompts/proposals reach
  // the two modes before reweighting, which may change sampled actions.
  const replay: TurnProvider = async (agent, ctx) => {
    const accepted = captured.get(agent.id);
    assert.ok(accepted);
    assert.equal(buildTurnPrompt(agent, ctx), accepted.prompt);
    return structuredClone(accepted.output);
  };
  const biased = await runTick(world, replay, { ...config, mode: 'llm_bias' });
  const proposals = (result: typeof raw) => result.log.decisions
    .map(decision => [decision.agent, decision.llm?.proposals]).sort(([a], [b]) => String(a).localeCompare(String(b)));
  assert.deepEqual(proposals(raw), proposals(biased));
  const rows = raw.log.decisions.map(decision => ({
    agent: decision.agent, proposals: decision.llm!.proposals,
    lines: raw.log.lines.find(line => line.agent === decision.agent),
  }));
  reports.push({ condition, mode: raw.log, biasedMode: biased.log, rows });
  assert.ok(biased.log.decisions.every(decision => decision.provider?.usage === null),
    'Snapshot replay must not claim new API usage');
  console.log(`Live ${condition}: eight accepted decisions; identical pre-bias proposals verified in both modes.`);
}

let failures = 0;
const failing = createTurnProvider({ fetch: async () => {
  failures++;
  return Response.json({ type: 'error', error: { type: 'api_error', message: 'controlled failure' } }, { status: 503 });
} });
const fallback = await runTick(createWorld(fixtureCast(42), 42), failing,
  { mode: 'llm_bias', scenario: [], gossip: true, billboard: true });
assert.equal(failures, 16, 'Eight agents, exactly two engine-owned attempts each');
assert.ok(fallback.log.decisions.every(decision => decision.effective_mode === 'rules' && decision.fallback === 'no_output'));
assert.ok(fallback.log.decisions.every(decision => decision.provider?.attempts === 2
  && decision.provider.retry_count === 1 && decision.provider.requests.length === 2 && decision.provider.usage === null));

// Verify that mode itself never reaches the prompt for the same real context.
const world = createWorld(fixtureCast(42), 42);
for (const id of world.ids) {
  const ctx = buildContext(world, world.agents[id], { mode: 'llm_raw', gossip: true }, [], DEFAULT_PARAMS);
  assert.equal(buildTurnPrompt(world.agents[id].profile, ctx),
    buildTurnPrompt(world.agents[id].profile, { ...ctx, mode: 'llm_bias' }));
}
const outIndex = process.argv.indexOf('--out');
if (outIndex !== -1) {
  assert.ok(process.argv[outIndex + 1], '--out needs a path');
  await writeFile(process.argv[outIndex + 1], JSON.stringify({ reports, fallback: fallback.log }, null, 2) + '\n');
}
console.log('Live engine integration and controlled repeated-failure fallback passed.');
