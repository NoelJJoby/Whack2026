// Console runner: the engine with the stub LLM, no server, no API calls.
//   pnpm exec tsx server/scripts/run-sim.ts --seed 42 --ticks 16 --mode llm_bias [--json] [--calm] [--no-gossip] [--no-billboard]
import { MODES, type Mode, type RunConfig } from '../engine-types';
import { DEFAULT_PARAMS } from '../params';
import { createStubProvider } from '../stub-provider';
import { runSimulation, type TickResult } from '../tick';
import { CALM_SCENARIO, SHOCK_SCENARIO, fixtureCast } from './fixture';

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

function printTick(r: TickResult): void {
  const { log, world } = r;
  const name = (id: string | null) => (id ? world.agents[id]?.profile.name ?? id : '');
  const ev = log.events.map((e) => `${e.type} (${e.is_true ? 'true' : 'false'}) "${world.claims[e.claim].text}"`).join('; ');
  console.log(`\n== Tick ${log.tick}${ev ? ` | event: ${ev}` : ''}`);
  for (const d of log.decisions) {
    const s = log.states[d.agent];
    const act = d.chosen.action + (d.chosen.target ? ` -> ${name(d.chosen.target)}` : '');
    const p = (d.probs[d.chosen.action] ?? 0).toFixed(2);
    const fb = d.fallback ? ' [fallback]' : '';
    console.log(
      `  ${pad(name(d.agent), 7)} ${pad(act, 22)} p=${p}  S${num(s.stress)} B${num(s.burnout)} L${num(s.loyalty)} T${num(s.trust_mgmt)}  ${d.explain}${fb}`,
    );
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
  console.log(`  reach: true ${log.reach.true_holders}, false ${log.reach.false_holders}`);
}

export function configFromArgs(args: Record<string, string | boolean>): RunConfig {
  const mode = (args.mode ?? 'llm_bias') as Mode;
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}`);
  return {
    seed: Number(args.seed ?? 42),
    mode,
    ticks: Number(args.ticks ?? 16),
    scenario: args.calm ? CALM_SCENARIO : SHOCK_SCENARIO,
    gossip: !args['no-gossip'],
    billboard: !args['no-billboard'],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = configFromArgs(args);
  const json = Boolean(args.json);
  if (!json) {
    console.log(`Office sim | seed ${config.seed} | mode ${config.mode} | ${config.ticks} ticks | stub LLM`);
  }
  const run = await runSimulation(
    fixtureCast(config.seed),
    config,
    createStubProvider(config.seed),
    DEFAULT_PARAMS,
    json ? undefined : printTick,
  );
  if (json) {
    console.log(JSON.stringify({ config, params: run.params, summary: run.summary, records: run.records, logs: run.logs }));
    return;
  }
  const s = run.summary;
  const names = s.crack_order.map((id) => `${run.world.agents[id].profile.name} (${run.world.agents[id].profile.archetype}, t${run.world.agents[id].quitTick})`);
  console.log('\n== Summary');
  console.log(`  crack order:        ${names.join(' > ') || 'nobody quit'}`);
  console.log(`  first quit tick:    ${s.first_quit_tick ?? '-'}  (${s.time_to_first_quit ?? '-'} ticks after first shock)`);
  console.log(`  claim reach:        true ${s.reach.true_holders}, false ${s.reach.false_holders}`);
  console.log(`  leaks:              ${s.leaks}`);
  console.log(`  LLM fallbacks:      ${s.fallbacks}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
