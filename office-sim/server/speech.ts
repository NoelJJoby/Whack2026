// Round-level speech orchestration, called from tick.ts: deal voice cards,
// sample each agent's manner before the LLM calls, build the style brief,
// check the round's lines for repetition and leaks, regenerate flagged lines
// once within the tick's request budget, and remember what was said.
import type {
  EngineProfile, EventType, LlmOutput, ProviderLog, SpeechContext, SpeechLog, SpeechState,
  SpeechTickLog, TurnContext, TurnProvider, World,
} from './engine-types';
import { toLlmOutput } from './llm-adapter';
import type { CallMetrics } from './llm/client';
import {
  bannedHits, eventTerms, isEchoOpener, openerMatch, patternHits, trigramSimilarity,
} from './llm/similarity';
import { withRequestMetrics } from './llm/telemetry';
import {
  addVoice, assignVoices, describeManner, describeVoice, sampleStyle, signalsOf, type Manner,
  type TurnStyle, type VoiceCard,
} from './llm/voice';
import type { Params, VoiceParams } from './params';
import { stream } from './rng';

const subject = (world: World, id: string) => ({
  id, traits: world.agents[id].profile.traits, state: world.agents[id].state,
});

/** Cards for the whole cast, in cast order. */
export function initSpeech(world: World, p: Params): SpeechState {
  return {
    voices: assignVoices(world.ids.map((id) => subject(world, id)), world.seed, p.voice),
    lastManner: {},
    recent: [],
    examples: {},
  };
}

/** A card for an agent who joins mid-run (no join path exists yet). Returns the new card. */
export function joinSpeech(world: World, id: string, p: Params): VoiceCard {
  world.speech ??= initSpeech(world, p);
  const card = addVoice(world.speech.voices, subject(world, id), world.seed, world.tick, p.voice);
  world.speech.voices[id] = card;
  return card;
}

/** Manners for this round, drawn in the seeded turn order. */
export function planRound(world: World, order: readonly string[], p: Params): Record<string, TurnStyle> {
  const speech = world.speech!;
  const round: Partial<Record<Manner, number>> = {};
  const out: Record<string, TurnStyle> = {};
  for (const id of order) {
    const agent = world.agents[id];
    const card = speech.voices[id];
    if (!card) continue;
    const colleagues = world.ids
      .filter((o) => o !== id && world.agents[o].status === 'active')
      .map((o) => ({ id: o, affinity: agent.state.affinity[o] ?? p.rules.defaultAffinity }));
    const style = sampleStyle(
      stream(world.seed, world.tick, id, 'manner'), card, signalsOf(agent.profile.traits, agent.state),
      agent.state.trust_mgmt, colleagues, { last: speech.lastManner[id] ?? null, round }, p.voice,
    );
    round[style.manner] = (round[style.manner] ?? 0) + 1;
    out[id] = style;
  }
  return out;
}

/** Other agents' lines from the rounds before this one. */
function recentLines(world: World, p: Params): Array<{ agent: string; line: string }> {
  const from = world.tick - p.voice.speech.recentRounds;
  return (world.speech?.recent ?? []).filter((r) => r.tick >= from && r.tick < world.tick);
}

const nameOf = (world: World) => (id: string) => world.agents[id]?.profile.name ?? 'a colleague';

export function speechContext(world: World, id: string, style: TurnStyle, p: Params): SpeechContext {
  const speech = world.speech!;
  const card = speech.voices[id];
  const name = nameOf(world);
  return {
    voice: describeVoice(card, style.stance, style.habits_shown, p.voice),
    manner: describeManner(style, name, p.voice),
    minimal: style.manner === 'minimal',
    feelings: card.feelings,
    examples: speech.examples[id] ?? [],
    recent: recentLines(world, p).filter((r) => r.agent !== id).map((r) => ({ name: name(r.agent), line: r.line })),
    nudge: null,
  };
}

/**
 * One call per agent, the first time they speak, for example small talk in
 * their voice. Stored on the world, so the run keeps them. Never throws.
 */
export async function ensureExamples(
  world: World, ids: readonly string[], provider: TurnProvider, p: Params,
): Promise<{ added: Record<string, string[]>; requests: number }> {
  const speech = world.speech;
  const ask = provider.styleExamples;
  if (!speech || !ask || !p.voice.examples.enabled) return { added: {}, requests: 0 };
  const todo = ids.filter((id) => speech.voices[id] && !(id in speech.examples));
  if (todo.length === 0) return { added: {}, requests: 0 };
  const metrics: CallMetrics[] = [];
  const results = await withRequestMetrics(metrics, () => Promise.all(todo.map(async (id) => {
    try {
      return await ask(world.agents[id].profile, describeVoice(speech.voices[id], null, true, p.voice));
    } catch {
      return null;
    }
  })));
  const added: Record<string, string[]> = {};
  todo.forEach((id, i) => (speech.examples[id] = added[id] = results[i] ?? []));
  return { added, requests: metrics.length };
}

// --- Repetition check ------------------------------------------------------

export interface LineCheck {
  flags: string[];
  /** The colleague the line is too close to, if any. */
  against: string | null;
}

type Said = { agent: string; line: string };

/**
 * Flags for one public line. `earlier` holds lines from agents who spoke
 * before this one in the round (so only the later of a pair is flagged);
 * `recent` holds lines from previous rounds.
 */
export function checkLine(
  agent: string, line: string, earlier: readonly Said[], recent: readonly Said[],
  terms: readonly string[][], p: VoiceParams,
): LineCheck {
  const flags: string[] = [];
  let against: string | null = null;
  const others = (xs: readonly Said[]) => xs.filter((x) => x.agent !== agent);
  const opener = others(earlier).find((o) => openerMatch(line, o.line, p.speech.openerWords));
  if (opener) {
    flags.push('opener');
    against = opener.agent;
  }
  const similar = others([...earlier, ...recent]).find((o) => trigramSimilarity(line, o.line) > p.speech.trigramThreshold);
  if (similar) {
    flags.push('similar');
    against ??= similar.agent;
  }
  for (const b of bannedHits(line, p)) flags.push(`banned:${b}`);
  if (patternHits(line, p.labelPatterns).length) flags.push('label');
  if (patternHits(line, p.tickPatterns).length) flags.push('tick');
  if (terms.some((t) => isEchoOpener(line, t, p.speech.echoWords))) flags.push('echo');
  return { flags, against };
}

export interface ReviewInput {
  world: World;
  order: readonly string[];
  llm: Record<string, { output: LlmOutput | null; providerLog?: ProviderLog }>;
  contexts: Record<string, TurnContext>;
  provider: TurnProvider;
  events: ReadonlyArray<{ type: EventType; text: string; custom?: boolean }>;
  styles: Record<string, TurnStyle>;
  params: Params;
}

/**
 * Check every LLM line in the round; give each flagged line one
 * regeneration, in turn order, within the requests the round's retries did
 * not use. A regeneration replaces only the spoken and inner lines; the
 * proposals and beliefs stay from the first call. Updates `llm` in place.
 */
export async function reviewRound(input: ReviewInput): Promise<{ logs: Record<string, SpeechLog>; summary: SpeechTickLog }> {
  const { world, order, llm, contexts, provider, events, styles, params: p } = input;
  const v = p.voice;
  const terms = events.map((e) => eventTerms(e, v.eventKeyTerms));
  const recent = recentLines(world, p);
  const lineOf = (id: string) => llm[id]?.output?.public_line?.trim() ?? '';
  const speakers = order.filter((id) => lineOf(id));
  const earlierThan = (id: string) => speakers.slice(0, speakers.indexOf(id)).map((a) => ({ agent: a, line: lineOf(a) }));

  const first: Record<string, LineCheck> = {};
  for (const id of speakers) first[id] = checkLine(id, lineOf(id), earlierThan(id), recent, terms, v);

  const budget = order.length * (1 + p.bias.llmRetries);
  const used = order.reduce((n, id) => n + (llm[id]?.providerLog?.attempts ?? 0), 0);
  const spare = Math.max(0, budget - used);
  const flagged = speakers.filter((id) => first[id].flags.length > 0);
  const chosen = v.speech.regenerate ? flagged.slice(0, spare) : [];

  const name = nameOf(world);
  const redo = await Promise.all(chosen.map(async (id) => {
    const ctx = contexts[id];
    const nudge = { line: lineOf(id), against: first[id].against ? name(first[id].against!) : null };
    const metrics: CallMetrics[] = [];
    let output: LlmOutput | null = null;
    try {
      const raw = await withRequestMetrics(metrics, () =>
        provider(world.agents[id].profile as EngineProfile, { ...ctx, speech: { ...ctx.speech!, nudge } }));
      output = toLlmOutput(raw).output;
    } catch {
      output = null;
    }
    return { id, output, metric: metrics[0] ?? null };
  }));

  const logs: Record<string, SpeechLog> = {};
  let regenerated = 0;
  let still = 0;
  for (const id of order) {
    const style = styles[id];
    if (!style) continue;
    const r = redo.find((x) => x.id === id);
    let regenFlags: string[] | null = null;
    let didRegen = false;
    const newLine = r?.output?.public_line?.trim();
    if (r && newLine) {
      const old = llm[id].output!;
      llm[id].output = { ...old, public_line: newLine, inner_monologue: r.output!.inner_monologue || old.inner_monologue };
      regenFlags = checkLine(id, newLine, earlierThan(id), recent, terms, v).flags;
      didRegen = true;
      regenerated++;
      if (regenFlags.length) still++;
    } else if (first[id]?.flags.length) {
      still++;
    }
    logs[id] = {
      ...style,
      flags: first[id]?.flags ?? [],
      regenerated: didRegen,
      regen_flags: regenFlags,
      regen_request: r?.metric
        ? { latencyMs: r.metric.latencyMs, outcome: r.metric.outcome, usage: r.metric.usage ? { ...r.metric.usage } : null }
        : null,
    };
  }

  return {
    logs,
    summary: { flagged: flagged.length, regenerated, still_flagged: still, budget_left: spare - chosen.length, example_requests: 0 },
  };
}

/** After the round: remember each agent's manner and what everyone said. */
export function recordRound(
  world: World, styles: Record<string, TurnStyle>, lines: ReadonlyArray<{ agent: string; public_line: string }>, p: Params,
): void {
  const speech = world.speech;
  if (!speech) return;
  for (const [id, style] of Object.entries(styles)) speech.lastManner[id] = style.manner;
  for (const l of lines) if (l.public_line.trim()) speech.recent.push({ tick: world.tick, agent: l.agent, line: l.public_line.trim() });
  const keepFrom = world.tick - p.voice.speech.recentRounds + 1;
  speech.recent = speech.recent.filter((r) => r.tick >= keepFrom);
}
