import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

import { DEFAULT_PARAMS } from '../../params';
import { fixtureCast } from '../../scripts/fixture';
import { makeClaim } from '../../test/helpers';
import { buildContext, createWorld } from '../../tick';
import { placeholderPersonas } from '../personas';
import { buildTurnPrompt } from '../prompt';

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
    assert.ok(identity.startsWith(agent.profile.persona!));
    assert.doesNotMatch(identity, /archetype|CEO|ops manager|gossip hub|climber|loyalist|skeptic|breadwinner|flight risk/i);
    assert.doesNotMatch(identity, /\d/);
    assert.doesNotMatch(feelings, /\d|workload|stress:|burnout:|trust_mgmt|loyalty:/);
    assert.ok(feelings.includes(condition === 'calm' ? 'You feel on top of things.' : "You're overwhelmed and close to snapping."));
    assert.ok(feelings.includes(condition === 'calm' ? 'You have energy for the work.' : 'You dread opening your laptop.'));
    assert.doesNotMatch(prompt, /is_true|isTrue|groundTruth|source_trust|distortion_rate|quit_threshold|recruiter_contact|verified|rootId|parentId/);
    assert.doesNotMatch(prompt, /"(?:stress|burnout|loyalty|trust_mgmt|ambition|financial_need|ethics|sociability|impulsivity|affinity)"\s*:/);
    assert.ok(prompt.includes('(id: claim-4-audit), from ops, heard 4 ticks ago.'));
    // Hidden truth changes must not change a prompt. Legitimate scandal metadata
    // and real ids remain; they are not archetype identity or truth labels.
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
console.log('Sixteen calm/high-stress prompt safety checks passed; ids, ages and output ranges are permitted.');
