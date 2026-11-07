// How distinct the agents sound, from run-sim --out logs.
//   pnpm exec tsx server/scripts/voice-metrics.ts --baseline old.json --new new.json
//   pnpm exec tsx server/scripts/voice-metrics.ts --new new.json --blind 3   (one round, no names, then the key)
// Each metric is reported for LLM lines only and for all lines (fallback
// template lines repeat across agents by design).
import { readFileSync } from 'node:fs';

import type { EngineTickLog, EventType, ScenarioEvent } from '../engine-types';
import {
  bannedHits, eventTerms, isEchoOpener, openerMatch, patternHits, tokens, trigramSimilarity,
} from '../llm/similarity';
import { DEFAULT_PARAMS } from '../params';
import { createRng } from '../rng';
import { parseArgs } from './run-sim';

const V = DEFAULT_PARAMS.voice;

interface RunFile {
  config: { seed: number; scenario: ScenarioEvent[] };
  names?: Record<string, string>;
  records: Array<{ agent: string; summary: string }>;
  logs: EngineTickLog[];
  usage?: { requests: number };
}

interface Line { tick: number; agent: string; said: string; thought: string; llm: boolean; manner: string | null }

function load(path: string): RunFile {
  return JSON.parse(readFileSync(path, 'utf8')) as RunFile;
}

/** Names from the payload, or from record summaries ("Sam works normally.") for older logs. */
function namesOf(run: RunFile): Record<string, string> {
  if (run.names) return run.names;
  const out: Record<string, string> = {};
  for (const r of run.records) out[r.agent] ??= r.summary.split(' ')[0];
  return out;
}

function linesOf(run: RunFile): Line[] {
  return run.logs.flatMap((l) => l.lines.map((x) => {
    const d = l.decisions.find((y) => y.agent === x.agent);
    return {
      tick: l.tick, agent: x.agent, said: x.public_line ?? '', thought: x.inner_monologue ?? '',
      llm: Boolean(d && !d.fallback && d.effective_mode !== 'rules'), manner: d?.speech?.manner ?? null,
    };
  }));
}

/** Key terms for each event tick: the type's terms plus numbers in any of its wordings, or a custom headline. */
function termsByTick(run: RunFile): Map<number, string[][]> {
  const out = new Map<number, string[][]>();
  for (const l of run.logs) {
    if (!l.events.length) continue;
    out.set(l.tick, l.events.map((e) => {
      const custom = run.config.scenario.find((s) => s.tick === l.tick && s.type === e.type && s.text);
      const p = DEFAULT_PARAMS.events[e.type as EventType];
      const text = custom?.text ?? [p.text, ...(p.variants ?? [])].join(' ');
      return eventTerms({ type: e.type, text, custom: Boolean(custom?.custom) }, V.eventKeyTerms);
    }));
  }
  return out;
}

const byTick = (lines: Line[]) => {
  const m = new Map<number, Line[]>();
  for (const l of lines) m.set(l.tick, [...(m.get(l.tick) ?? []), l]);
  return [...m.values()];
};

function pairs<T>(xs: T[]): Array<[T, T]> {
  const out: Array<[T, T]> = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) out.push([xs[i], xs[j]]);
  return out;
}

interface Metrics {
  lines: number;
  echo: { hits: number; of: number };
  sameOpeners: number;
  meanTrigram: number;
  banned: number;
  labelSaid: number;
  labelThought: number;
  tickSaid: number;
  tickThought: number;
  manners: { min: number; mean: number; rounds: number } | null;
  thoughtSameOpeners: number;
  thoughtEcho: { hits: number; of: number };
  thoughtTrigram: number;
}

function measure(run: RunFile, scope: 'llm' | 'all'): Metrics {
  const lines = linesOf(run).filter((l) => l.said && (scope === 'all' || l.llm));
  const terms = termsByTick(run);
  const onEvent = lines.filter((l) => terms.has(l.tick));
  const rounds = byTick(lines);
  const sims = rounds.flatMap((r) => pairs(r).map(([a, b]) => trigramSimilarity(a.said, b.said)));
  const mannerRounds = byTick(linesOf(run).filter((l) => l.manner)).filter((r) => r.length >= 6);
  const distinct = mannerRounds.map((r) => new Set(r.map((l) => l.manner)).size);
  const thinking = rounds.map((r) => r.filter((l) => l.thought));
  const thoughtSims = thinking.flatMap((r) => pairs(r).map(([a, b]) => trigramSimilarity(a.thought, b.thought)));
  const thoughtsOnEvent = onEvent.filter((l) => l.thought);
  const lead = (t: string) => tokens(t).slice(0, V.speech.thoughtEchoWords).join(' ');
  return {
    lines: lines.length,
    echo: { hits: onEvent.filter((l) => terms.get(l.tick)!.some((t) => isEchoOpener(l.said, t, V.speech.echoWords))).length, of: onEvent.length },
    sameOpeners: rounds.reduce((n, r) => n + pairs(r).filter(([a, b]) => openerMatch(a.said, b.said, 3)).length, 0),
    meanTrigram: sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : 0,
    banned: lines.filter((l) => bannedHits(l.said, V).length > 0).length,
    labelSaid: lines.filter((l) => patternHits(l.said, V.labelPatterns).length > 0).length,
    labelThought: lines.filter((l) => patternHits(l.thought, V.labelPatterns).length > 0).length,
    tickSaid: lines.filter((l) => patternHits(l.said, V.tickPatterns).length > 0).length,
    tickThought: lines.filter((l) => patternHits(l.thought, V.tickPatterns).length > 0).length,
    manners: distinct.length
      ? { min: Math.min(...distinct), mean: distinct.reduce((a, b) => a + b, 0) / distinct.length, rounds: distinct.length }
      : null,
    thoughtSameOpeners: thinking.reduce((n, r) => n + pairs(r).filter(([a, b]) => openerMatch(a.thought, b.thought, 3)).length, 0),
    thoughtEcho: {
      hits: thoughtsOnEvent.filter((l) => terms.get(l.tick)!.some((t) => isEchoOpener(lead(l.thought), t, V.speech.thoughtEchoWords))).length,
      of: thoughtsOnEvent.length,
    },
    thoughtTrigram: thoughtSims.length ? thoughtSims.reduce((a, b) => a + b, 0) / thoughtSims.length : 0,
  };
}

const pct = (h: number, of: number) => (of ? `${((100 * h) / of).toFixed(1)}% (${h}/${of})` : 'n/a');

function table(base: RunFile | null, next: RunFile, scope: 'llm' | 'all'): string[] {
  const b = base ? measure(base, scope) : null;
  const n = measure(next, scope);
  const rows: Array<[string, string, string, string, boolean | null]> = [
    ['Echo openers (event ticks)', '< 10%', b ? pct(b.echo.hits, b.echo.of) : '-', pct(n.echo.hits, n.echo.of), n.echo.of ? n.echo.hits / n.echo.of < 0.1 : null],
    ['Same first 3 words, same round (pairs)', '0', b ? String(b.sameOpeners) : '-', String(n.sameOpeners), n.sameOpeners === 0],
    ['Mean pairwise trigram similarity', '< baseline', b ? b.meanTrigram.toFixed(4) : '-', n.meanTrigram.toFixed(4), b ? n.meanTrigram < b.meanTrigram : null],
    ['Banned-phrase hits (lines)', '0', b ? String(b.banned) : '-', String(n.banned), n.banned === 0],
    ['Label leaks: said / thought', '0 / 0', b ? `${b.labelSaid} / ${b.labelThought}` : '-', `${n.labelSaid} / ${n.labelThought}`, n.labelSaid + n.labelThought === 0],
    ['Tick leaks: said / thought', '0 / 0', b ? `${b.tickSaid} / ${b.tickThought}` : '-', `${n.tickSaid} / ${n.tickThought}`, n.tickSaid + n.tickThought === 0],
    ['Distinct manners per round (6+ speakers)', 'min >= 4', b?.manners ? `min ${b.manners.min}` : 'n/a',
      n.manners ? `min ${n.manners.min}, mean ${n.manners.mean.toFixed(1)} over ${n.manners.rounds}` : 'n/a', n.manners ? n.manners.min >= 4 : null],
    // Thoughts: not in the brief's targets; compared with the baseline.
    ['Thoughts: same first 3 words (pairs)', '< baseline', b ? String(b.thoughtSameOpeners) : '-', String(n.thoughtSameOpeners), b ? n.thoughtSameOpeners < b.thoughtSameOpeners : null],
    ['Thoughts: open with the event (3 words)', '< baseline', b ? pct(b.thoughtEcho.hits, b.thoughtEcho.of) : '-', pct(n.thoughtEcho.hits, n.thoughtEcho.of),
      b && b.thoughtEcho.of && n.thoughtEcho.of ? n.thoughtEcho.hits / n.thoughtEcho.of < b.thoughtEcho.hits / b.thoughtEcho.of : null],
    ['Thoughts: mean pairwise trigram similarity', '< baseline', b ? b.thoughtTrigram.toFixed(4) : '-', n.thoughtTrigram.toFixed(4), b ? n.thoughtTrigram < b.thoughtTrigram : null],
  ];
  const w = [42, 10, 22, 30];
  const fmt = (c: string[]) => c.map((x, i) => x.padEnd(w[i] ?? 0)).join(' ');
  return [
    `-- ${scope === 'llm' ? 'LLM lines only' : 'All lines (including fallback templates)'}: ${b ? `${b.lines} baseline / ` : ''}${n.lines} new`,
    fmt(['Metric', 'Target', 'Baseline', 'New', 'Pass']),
    ...rows.map(([m, t, bv, nv, ok]) => fmt([m, t, bv, nv, ok === null ? '-' : ok ? 'yes' : 'NO'])),
  ];
}

function context(run: RunFile, label: string): string {
  const fallbacks = run.logs.reduce((n, l) => n + l.decisions.filter((d) => d.fallback).length, 0);
  const regen = run.logs.reduce((n, l) => n + (l.speech?.regenerated ?? 0), 0);
  const still = run.logs.reduce((n, l) => n + (l.speech?.still_flagged ?? 0), 0);
  const examples = run.logs.reduce((n, l) => n + (l.speech?.example_requests ?? 0), 0);
  return `${label}: ${run.usage?.requests ?? '?'} requests, ${fallbacks} fallbacks, ${regen} regenerations, ${still} lines still flagged, ${examples} example-line requests`;
}

/** One round's lines in a seeded shuffle with no names, then the key. */
function blind(run: RunFile, tick: number): string[] {
  const names = namesOf(run);
  const round = linesOf(run).filter((l) => l.tick === tick && l.said);
  const shuffled = createRng(run.config.seed + tick).shuffle(round);
  return [
    `-- Blind round, tick ${tick}: who is speaking?`,
    ...shuffled.map((l, i) => `${i + 1}. "${l.said}"`),
    '',
    'Key:',
    ...shuffled.map((l, i) => `${i + 1}. ${names[l.agent] ?? l.agent}${l.manner ? ` (${l.manner})` : ''}`),
  ];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.new !== 'string') throw new Error('--new <run.json> is required');
  const next = load(args.new);
  const base = typeof args.baseline === 'string' ? load(args.baseline) : null;
  const out: string[] = [];
  if (base) out.push(context(base, 'Baseline'));
  out.push(context(next, 'New'), '');
  out.push(...table(base, next, 'llm'), '', ...table(base, next, 'all'));
  if (args.blind !== undefined) out.push('', ...blind(next, Number(args.blind)));
  console.log(out.join('\n'));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
