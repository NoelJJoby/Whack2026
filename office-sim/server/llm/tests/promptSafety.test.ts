import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

import type { TurnContext, TurnProvider } from '../../engine-types';
import { DEFAULT_PARAMS } from '../../params';
import { buildScenario, fixtureCast } from '../../scripts/fixture';
import { createStubProvider } from '../../stub-provider';
import { makeClaim } from '../../test/helpers';
import { buildContext, createWorld, runSimulation } from '../../tick';
import { FEELING_TABLES } from '../bands';
import { placeholderPersonas } from '../personas';
import { buildTurnPrompt } from '../prompt';

const LABELS = /archetype|gossip hub|climber|loyalist|s[ck]eptic|breadwinner|flight risk|ops manager/i;
/** The prompt minus the action list and JSON example, where action names (such as "gossip") belong. */
const outsideActions = (prompt: string) => prompt.split('\n\n')
  .filter((part) => !part.startsWith('What you can do:') && !part.startsWith('Respond with JSON only')).join('\n\n');

const samples: string[] = [];
for (const condition of ['calm', 'high-stress'] as const) {
  const world = createWorld(fixtureCast(42), 42);
  world.tick = 8;
  const claim = makeClaim('claim-4-audit', {
    text: 'An outside audit may find that leadership concealed losses.',
    source: 'ops', created_tick: 4, scandal: true, is_true: condition === 'calm',
  });
  world.claims[claim.id] = claim;
  for (const id of world.ids) {
    const agent = world.agents[id];
    agent.state.stress = condition === 'calm' ? 23 : 83;
    agent.state.burnout = condition === 'calm' ? 27 : 87;
    agent.state.workload = 97;
    agent.claims = [{ claimId: claim.id, from: 'ops', tickHeard: 4, depth: 0,
      belief: 75, verified: null }];
    const ctx = buildContext(world, agent, { mode: 'llm_bias', gossip: true }, [], DEFAULT_PARAMS);
    const prompt = buildTurnPrompt(agent.profile, ctx);
    const identity = prompt.split('Who you are: ')[1].split('\n\n')[0];
    const feelings = prompt.split('How you feel right now: ')[1].split('\n\n')[0];
    assert.ok(placeholderPersonas.includes(agent.profile.persona!));
    assert.ok(identity.startsWith(`You're ${agent.profile.name}. `));
    assert.ok(identity.split('\n')[0].endsWith(agent.profile.persona!));
    assert.doesNotMatch(identity, /CEO/);
    assert.doesNotMatch(identity, LABELS);
    assert.doesNotMatch(identity, /\d/);
    assert.doesNotMatch(feelings, /\d|workload|stress:|burnout:|trust_mgmt|loyalty:/);
    const band = condition === 'calm' ? 0 : 2;
    assert.ok(feelings.includes(FEELING_TABLES.stress[band][0]));
    assert.ok(feelings.includes(FEELING_TABLES.burnout[band][0]));
    assert.doesNotMatch(prompt, /is_true|isTrue|groundTruth|source_trust|distortion_rate|quit_threshold|recruiter_contact|verified|rootId|parentId/);
    assert.doesNotMatch(prompt, /"(?:stress|burnout|loyalty|trust_mgmt|ambition|financial_need|ethics|sociability|impulsivity|affinity)"\s*:/);
    // The claim is from the ops manager: by name to colleagues; ops itself can't hear from itself.
    const from = id === 'ops' ? 'the grapevine' : world.agents.ops.profile.name;
    assert.ok(prompt.includes(`(key: c1), from ${from}, yesterday afternoon.`));
    assert.doesNotMatch(prompt, /claim-4|\btick/i);
    assert.doesNotMatch(prompt, LABELS);
    for (const other of world.ids) assert.doesNotMatch(outsideActions(prompt), new RegExp(`\\b${other}\\b`), `raw id ${other}`);
    // Hidden truth changes must not change a prompt.
    claim.is_true = !claim.is_true;
    assert.equal(buildTurnPrompt(agent.profile,
      buildContext(world, agent, { mode: 'llm_bias', gossip: true }, [], DEFAULT_PARAMS)), prompt);
    const rawScoresChanged = structuredClone(ctx);
    rawScoresChanged.state.workload = 1;
    rawScoresChanged.colleagues.forEach(colleague => { colleague.affinity = 2; });
    assert.equal(buildTurnPrompt(agent.profile, rawScoresChanged), prompt);
    samples.push(`===== ${condition}: ${id} =====\n${prompt}`);
  }
}
assert.equal(samples.length, 16);
if (process.argv.includes('--print')) console.log(samples.join('\n\n'));
const writeIndex = process.argv.indexOf('--write');
if (writeIndex !== -1) {
  assert.ok(process.argv[writeIndex + 1], '--write needs an output path');
  await writeFile(process.argv[writeIndex + 1], samples.join('\n\n') + '\n');
}

// Every prompt a full 16-tick run sends, voice brief included, is free of ids,
// claim ids, archetype labels and the word "tick".
for (const seed of [42, 7]) {
  const stub = createStubProvider(seed);
  const sent: Array<{ id: string; prompt: string }> = [];
  const capture: TurnProvider = async (agent, ctx: TurnContext) => {
    sent.push({ id: agent.id, prompt: buildTurnPrompt(agent, ctx) });
    return stub(agent, ctx);
  };
  const cast = fixtureCast(seed);
  const run = await runSimulation(cast, {
    seed, mode: 'llm_bias', ticks: 16, scenario: buildScenario(seed, 16), gossip: true, billboard: true, priceFeedback: false,
  }, capture);
  assert.ok(sent.length >= 16 * 6);
  assert.ok(sent.some((s) => s.prompt.includes('How you talk:')), 'voice briefs are sent');
  for (const { prompt } of sent) {
    assert.doesNotMatch(prompt, /\btick|claim-\d/i);
    assert.doesNotMatch(prompt, LABELS);
    for (const other of run.world.ids) assert.doesNotMatch(outsideActions(prompt), new RegExp(`\\b${other}\\b`), `seed ${seed}: raw id ${other}`);
  }
}

console.log('Sixteen calm/high-stress prompt safety checks and two full-run leak checks passed.');
