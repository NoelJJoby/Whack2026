// Console runner: the engine in the terminal, no server.
//   Stub LLM (no API calls, the default):
//     pnpm exec tsx server/scripts/run-sim.ts --seed 42 --ticks 16 --mode llm_bias [--json] [--calm] [--no-gossip] [--no-billboard] [--price-feedback]
//   Real LLM (Anthropic, needs ANTHROPIC_API_KEY in office-sim/.env, the repo-root .env or the environment):
//     pnpm exec tsx server/scripts/run-sim.ts --llm [--ticks 16] [--mode llm_bias|llm_raw] [--cast fixture|data] [--out run.json] [--verbose] [--keep-going]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

import { LLM_MODES, MODES, type CastMember, type Mode, type RunConfig, type TurnProvider } from '../engine-types';
import { createTurnProvider } from '../llm';
import { llmConfig } from '../llm/config';
import { DEFAULT_PARAMS } from '../params';
import { createStubProvider } from '../stub-provider';
import { runSimulation, type TickResult } from '../tick';
import { CALM_SCENARIO, buildScenario, dataCast, fixtureCast } from './fixture';

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const num = (x: number) => String(Math.round(x)).padStart(3);

function printTick(r: TickResult, showLines: boolean): void {
  const { log, world } = r;
  const name = (id: string | null) => (id ? world.agents[id]?.profile.name ?? id : '');
  const ev = log.events.map((e) => `${e.type} (${e.is_true ? 'true' : 'false'}) "${world.claims[e.claim].text}"`).join('; ');
  console.log(`\n== Tick ${log.tick}${ev ? ` | event: ${ev}` : ''}`);
  if (log.voices) {
    console.log('  voices:');
    for (const [id, c] of Object.entries(log.voices)) {
      console.log(`    ${pad(name(id), 7)} ${c.register}/${c.length}${c.fragments ? '+fragments' : ''}/${c.humour}/${c.tell}  habits ${c.habits.join(', ')}  topics ${c.topics.join('; ')}${c.resamples ? `  (resampled ${c.resamples}x)` : ''}`);
    }
  }
  for (const [id, lines] of Object.entries(log.examples ?? {})) console.log(`    ${pad(name(id), 7)} small talk: ${lines.map((l) => `"${l}"`).join(' ') || '(none)'}`);
  for (const d of log.decisions) {
    const s = log.states[d.agent];
    const act = d.chosen.action + (d.chosen.target ? ` -> ${name(d.chosen.target)}` : '');
    const p = (d.probs[d.chosen.action] ?? 0).toFixed(2);
    const fb = d.fallback ? ` [fallback: ${d.fallback}]` : '';
    console.log(
      `  ${pad(name(d.agent), 7)} ${pad(act, 22)} p=${p}  S${num(s.stress)} B${num(s.burnout)} L${num(s.loyalty)} T${num(s.trust_mgmt)}  ${d.explain}${fb}`,
    );
    if (showLines) {
      const proposed = d.llm?.proposals.map((q) => `${q.action} ${q.weight}`).join(', ');
      const line = log.lines.find((l) => l.agent === d.agent);
      if (proposed) console.log(`            proposed: ${proposed}`);
      const how = d.speech ? ` [${d.speech.manner}${d.speech.regenerated ? ', regenerated' : d.speech.flags.length ? `, flagged: ${d.speech.flags.join(' ')}` : ''}]` : '';
      if (line?.public_line) console.log(`            says:     "${line.public_line}"${how}`);
      if (line?.inner_monologue) console.log(`            thinks:   "${line.inner_monologue}"`);
    }
  }
  for (const h of log.hops) {
    console.log(`  ~ ${name(h.from)} -> ${name(h.to)}: ${h.distorted ? 'distorted' : 'passed on'} ${h.claim}${h.distorted ? ` as ${h.delivered}` : ''}`);
  }
  for (const v of log.verifications) console.log(`  ? ${name(v.agent)} verified ${v.claim} with ${name(v.target)}: ${v.result}`);
  for (const l of log.leaks) console.log(`  ! ${name(l.agent)} leaked ${l.claim}`);
  for (const q of log.quits) {
    const s = log.states[q];
    console.log(`  X ${name(q)} QUITS (burnout ${Math.round(s.burnout)}, loyalty ${Math.round(s.loyalty)}, trust ${Math.round(s.trust_mgmt)})`);
  }
  if (log.speech) console.log(`  speech: ${log.speech.flagged} flagged, ${log.speech.regenerated} regenerated, ${log.speech.still_flagged} still flagged, ${log.speech.budget_left} requests spare`);
  console.log(`  reach: true ${log.reach.true_holders}, false ${log.reach.false_holders}`);
  console.log(`  price: ${log.price.price.toFixed(2)}, log return ${log.price.ret.toFixed(4)}, output ${log.price.outputLog.toFixed(4)}, news ${log.price.newsLevel.toFixed(4)}, noise ${log.price.noise.toFixed(4)}`);
  const usage = tickUsage(r);
  if (usage.requests > 0) {
    console.log(`  llm: ${usage.requests} requests, ${usage.input} in / ${usage.output} out tokens, slowest ${Math.round(usage.slowestMs)} ms`);
  }
}

function tickUsage(r: TickResult) {
  const out = { requests: 0, failed: 0, input: 0, output: 0, slowestMs: 0 };
  for (const d of r.log.decisions) {
    for (const q of d.provider?.requests ?? []) {
      out.requests++;
      if (q.outcome === 'error') out.failed++;
      out.input += q.usage?.promptTokens ?? 0;
      out.output += q.usage?.completionTokens ?? 0;
      out.slowestMs = Math.max(out.slowestMs, q.latencyMs);
    }
  }
  return out;
}

export function configFromArgs(args: Record<string, string | boolean>): RunConfig {
  if (args['price-feedback'] !== undefined && args['price-feedback'] !== true) throw new Error('--price-feedback is a flag');
  const mode = (args.mode ?? 'llm_bias') as Mode;
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}`);
  const seed = Number(args.seed ?? 42);
  const ticks = Number(args.ticks ?? 16);
  return {
    seed,
    mode,
    ticks,
    scenario: [],
    business: true,
    gossip: !args['no-gossip'],
    billboard: !args['no-billboard'] && !args.calm,
    priceFeedback: args['price-feedback'] === true,
  };
}

export function castFromArgs(args: Record<string, string | boolean>, seed: number): CastMember[] {
  const which = args.cast ?? 'fixture';
  if (which === 'fixture') return fixtureCast(seed);
  if (which === 'data') return dataCast();
  throw new Error('--cast must be fixture or data');
}

/** Real Anthropic provider. Loads the key from office-sim/.env, then the repo-root .env. */
function realProvider(verbose: boolean): TurnProvider {
  loadEnv({
    path: [fileURLToPath(new URL('../../.env', import.meta.url)), fileURLToPath(new URL('../../../.env', import.meta.url))],
    quiet: true,
  });
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error('--llm needs ANTHROPIC_API_KEY (office-sim/.env, the repo-root .env, or the environment)');
  }
  if (!verbose) {
    // The client logs one metrics line per request; the runner prints per-tick totals instead.
    const info = console.info;
    console.info = (...a: unknown[]) => {
      if (a[0] !== 'anthropic_request') info(...a);
    };
  }
  return createTurnProvider();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = configFromArgs(args);
  const json = Boolean(args.json);
  const llm = Boolean(args.llm);
  const cast = castFromArgs(args, config.seed);
  if (llm && !LLM_MODES.includes(config.mode)) {
    throw new Error(`--llm only makes sense with --mode ${LLM_MODES.join(' or ')}; ${config.mode} never calls the LLM`);
  }
  const provider = llm ? realProvider(Boolean(args.verbose)) : createStubProvider(config.seed);
  const maxCalls = cast.length * config.ticks * (1 + DEFAULT_PARAMS.bias.llmRetries);

  if (!json) {
    const source = llm ? `Anthropic ${llmConfig.model} (at most ${maxCalls} requests)` : 'stub LLM';
    console.log(`Office sim | seed ${config.seed} | mode ${config.mode} | ${config.ticks} ticks | cast ${args.cast ?? 'fixture'} | ${source}`);
  }

  const run = await runSimulation(cast, config, provider, DEFAULT_PARAMS, (r) => {
    if (!json) printTick(r, llm);
    // A dead key or network makes every call fail; stop instead of running every tick on rules.
    const u = tickUsage(r);
    if (llm && r.log.tick === 1 && !args['keep-going'] && u.requests > 0 && u.failed === u.requests) {
      throw new Error('every LLM request failed on tick 1 (check the key, model access and network); pass --keep-going to run on rules anyway');
    }
  });

  const totals = run.logs
    .map((l) => tickUsage({ world: run.world, records: [], log: l }))
    .reduce((a, b) => ({
      requests: a.requests + b.requests, failed: a.failed + b.failed,
      input: a.input + b.input, output: a.output + b.output, slowestMs: Math.max(a.slowestMs, b.slowestMs),
    }));
  const fallbackReasons: Record<string, number> = {};
  for (const d of run.logs.flatMap((l) => l.decisions)) if (d.fallback) fallbackReasons[d.fallback] = (fallbackReasons[d.fallback] ?? 0) + 1;

  const agentNames = Object.fromEntries(run.world.ids.map((id) => [id, run.world.agents[id].profile.name]));
  const payload = { config, cast: args.cast ?? 'fixture', names: agentNames, provider: llm ? llmConfig.model : 'stub', params: run.params, summary: run.summary, usage: totals, records: run.records, logs: run.logs };
  if (typeof args.out === 'string') {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(payload, null, 2) + '\n');
  }
  if (json) {
    console.log(JSON.stringify(payload));
    return;
  }
  const s = run.summary;
  const names = s.crack_order.map((id) => `${run.world.agents[id].profile.name} (${run.world.agents[id].profile.archetype}, t${run.world.agents[id].quitTick})`);
  console.log('\n== Summary');
  console.log(`  crack order:        ${names.join(' > ') || 'nobody quit'}`);
  console.log(`  first quit tick:    ${s.first_quit_tick ?? '-'}  (${s.time_to_first_quit ?? '-'} ticks after first shock)`);
  console.log(`  claim reach:        true ${s.reach.true_holders}, false ${s.reach.false_holders}`);
  console.log(`  leaks:              ${s.leaks}`);
  console.log(`  ending price:       ${s.price.toFixed(2)} (feedback ${s.priceFeedback ? 'on' : 'off'}, ${s.headcount} active, morale ${s.morale === null ? 'no employees' : (100 * s.morale).toFixed(1)})`);
  console.log(`  LLM fallbacks:      ${s.fallbacks}${s.fallbacks ? `  ${JSON.stringify(fallbackReasons)}` : ''}`);
  if (llm) {
    console.log(`  LLM requests:       ${totals.requests} (${totals.failed} failed), ${totals.input} in / ${totals.output} out tokens, slowest ${Math.round(totals.slowestMs)} ms`);
  }
  if (typeof args.out === 'string') console.log(`  full log:           ${args.out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
