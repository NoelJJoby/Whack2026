// Best Boss batch: every CEO entry plays the same scripted week on the same seeds.
//   pnpm exec tsx server/scripts/leaderboard.ts [--seeds 5] [--ticks 40] [--entries haiku-5-5,random] [--concurrency 5]
// Writes src/leaderboard/leaderboard.json (bundled with the app, so the board works offline).
// Model replies are cached in server/leaderboard/ceo-cache.json: reruns are free and identical.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { board, type LeaderboardFile, type LeaderboardRun } from '../../shared/leaderboard';
import type { EngineTickLog, RunConfig } from '../engine-types';
import { DEFAULT_PARAMS as P } from '../params';
import { runSimulation } from '../tick';
import { fixtureCast } from './fixture';
import {
  ENTRIES, LEADERBOARD_SCENARIO, LEADERBOARD_TICKS, MODEL_CEOS, byTheBook, doNothing, leaderboardProvider, modelCeo, randomCeo,
  type CeoCache, type CeoPolicy, type Usage,
} from '../leaderboard/ceos';
import { runMetrics } from '../leaderboard/metrics';

const OUT = fileURLToPath(new URL('../../src/leaderboard/leaderboard.json', import.meta.url));
const CACHE = fileURLToPath(new URL('../leaderboard/ceo-cache.json', import.meta.url));
/** $ per million tokens (input, output), for the printed cost only. */
const PRICE: Record<string, [number, number]> = { 'claude-haiku-5-5': [0.1, 0.5], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20] };
const MODE = 'llm_bias engine; seeded stub employees; rules Ops; CEO varies by entry';

function arg(name: string, fallback: string) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; }
const seeds = Array.from({ length: Number(arg('seeds', '5')) }, (_, i) => i + 1);
const ticks = Number(arg('ticks', String(LEADERBOARD_TICKS)));
const concurrency = Math.max(1, Number(arg('concurrency', '5')));
const selected = arg('entries', ENTRIES.map(e => e.id).join(',')).split(',').map(s => s.trim());
const unknown = selected.filter(id => !ENTRIES.some(e => e.id === id));
if (unknown.length) throw new Error(`Unknown entries: ${unknown.join(', ')}. Known: ${ENTRIES.map(e => e.id).join(', ')}`);

for (const path of [fileURLToPath(new URL('../../.env', import.meta.url)), fileURLToPath(new URL('../../../.env', import.meta.url))]) dotenv.config({ path, quiet: true });
const models = MODEL_CEOS.filter(m => selected.includes(m.id));
// Without a key every model call fails and the engine silently substitutes its rules CEO: refuse instead.
if (models.length && !process.env.ANTHROPIC_API_KEY?.trim()) {
  console.error('ANTHROPIC_API_KEY is required for model entries. For baselines only: --entries by-the-book,do-nothing,random');
  process.exit(1);
}

const cache: CeoCache = new Map(existsSync(CACHE) ? Object.entries(JSON.parse(readFileSync(CACHE, 'utf8'))) : []);
const saveCache = () => { mkdirSync(dirname(CACHE), { recursive: true }); writeFileSync(CACHE, JSON.stringify(Object.fromEntries(cache))); };
const usage: Record<string, Usage> = Object.fromEntries(models.map(m => [m.id, { calls: 0, inputTokens: 0, outputTokens: 0, errors: 0 }]));

function policyFor(id: string): CeoPolicy {
  const spec = MODEL_CEOS.find(m => m.id === id);
  if (spec) return modelCeo(spec, cache, usage[id]);
  return id === 'by-the-book' ? byTheBook : id === 'do-nothing' ? doNothing : randomCeo;
}

async function one(entry: string, seed: number): Promise<LeaderboardRun> {
  const config: RunConfig = { seed, mode: 'llm_bias', ticks, scenario: LEADERBOARD_SCENARIO, gossip: true, billboard: true, priceFeedback: false, business: true };
  const logs: EngineTickLog[] = [];
  const run = await runSimulation(fixtureCast(seed, P), config, leaderboardProvider(policyFor(entry), seed), P, r => logs.push(r.log));
  const decisions = run.world.eventState.decisions.filter(d => d.kind === 'ceo');
  return { entry, seed, metrics: runMetrics(run.world, logs, P, ticks), prices: logs.map(l => Math.round(l.price.price * 100) / 100),
    ceo: { decisions: decisions.length, fallbacks: decisions.filter(d => d.fallback !== null).length } };
}

// Keep other entries' results when rerunning a subset, unless the setup changed.
const scenario = LEADERBOARD_SCENARIO.map(({ tick, type, templateId }) => ({ tick, type, ...(templateId ? { templateId } : {}) }));
const previous: LeaderboardFile | null = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const sameSetup = previous && previous.ticks === ticks && JSON.stringify(previous.seeds) === JSON.stringify(seeds) && JSON.stringify(previous.scenario) === JSON.stringify(scenario);
const runs: LeaderboardRun[] = sameSetup ? previous.runs.filter(r => !selected.includes(r.entry)) : [];

const jobs = selected.flatMap(entry => seeds.map(seed => ({ entry, seed })));
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const { entry, seed } = jobs[next++];
    const started = Date.now();
    runs.push(await one(entry, seed));
    saveCache();
    console.log(`${entry} seed ${seed} done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));

const order = ENTRIES.map(e => e.id);
runs.sort((a, b) => order.indexOf(a.entry) - order.indexOf(b.entry) || a.seed - b.seed);
const file: LeaderboardFile = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), mode: MODE, ticks, seeds, scenario,
  entries: ENTRIES.filter(e => runs.some(r => r.entry === e.id)), runs,
  usage: { ...(sameSetup ? previous.usage : {}), ...usage },
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(file, null, 1)}\n`);
console.log(`\nWrote ${OUT}`);

const at = (w: number) => new Map(board(file, w).map(r => [r.entry.id, r.score.toFixed(1)]));
const [s0, s5, s1] = [at(0), at(0.5), at(1)];
console.table(file.entries.map(e => {
  const r = board(file, 0.5).find(x => x.entry.id === e.id)!; const u = file.usage[e.id]; const price = e.model ? PRICE[e.model] : undefined;
  return { entry: e.name, 'w=0': s0.get(e.id), 'w=0.5': s5.get(e.id), 'w=1': s1.get(e.id),
    fallbacks: `${r.ceo.fallbacks}/${r.ceo.decisions}`,
    ...(u && price ? { calls: u.calls, errors: u.errors, cost: `$${((u.inputTokens * price[0] + u.outputTokens * price[1]) / 1e6).toFixed(2)}` } : {}) };
}));
