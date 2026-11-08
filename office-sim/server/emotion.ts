// The LLM picks an emotion from a fixed list; rules validate it and set its intensity.
// Anger and frustration must point at a real trigger, otherwise they are downgraded.
import type { Action, EngineAgent } from './engine-types';
import type { Trigger } from './triggers';

export const EMOTIONS = ['neutral', 'happy', 'excited', 'stressed', 'anxious', 'frustrated', 'angry', 'sad', 'skeptical', 'surprised'] as const;
export type Emotion = (typeof EMOTIONS)[number];
const NEGATIVE: readonly Emotion[] = ['stressed', 'anxious', 'frustrated', 'angry', 'sad'];

export interface SettledEmotion { emotion: Emotion; intensity: 1 | 2 | 3; cause: Trigger | null }

const isEmotion = (v: unknown): v is Emotion => typeof v === 'string' && (EMOTIONS as readonly string[]).includes(v);

/** Without an LLM emotion (rules mode, failed call): derive one from the action, triggers and personality. */
function derived(agent: EngineAgent, action: Action, triggers: Trigger[]): { emotion: Emotion; cause: Trigger | null } {
  const top = [...triggers].sort((a, b) => b.severity - a.severity)[0] ?? null;
  const news = triggers.find(t => t.kind === 'event' && t.id.startsWith('ev-')) ?? null;
  const a = agent.profile.archetype, s = agent.state;
  // The hour news reaches them, their emotion is their reaction to it.
  if (news) return { emotion: a === 'Skeptic' ? 'skeptical' : a === 'Flight risk' && news.id === 'ev-competitor_poaching' ? 'excited' : news.severity >= 2 ? 'anxious' : 'surprised', cause: news };
  switch (action) {
    case 'complain': return top ? { emotion: top.severity >= 3 ? 'angry' : 'frustrated', cause: top } : { emotion: s.stress >= 60 ? 'stressed' : 'neutral', cause: null };
    case 'gossip': return { emotion: 'excited', cause: triggers.find(t => t.kind === 'claim') ?? null };
    case 'verify': return { emotion: 'skeptical', cause: triggers.find(t => t.kind === 'claim') ?? null };
    case 'leak': case 'interview': return { emotion: 'anxious', cause: top };
    case 'overwork': return { emotion: 'stressed', cause: top };
    case 'slack_off': return { emotion: s.burnout >= 60 ? 'sad' : 'happy', cause: null };
    default:
      if (s.stress >= 70) return { emotion: 'stressed', cause: top };
      if (a === 'Flight risk' && s.burnout >= 50) return { emotion: 'sad', cause: top };
      if (a === 'Skeptic' && s.trust_mgmt < 40) return { emotion: 'skeptical', cause: null };
      return { emotion: s.stress < 35 && agent.profile.traits.sociability >= 60 ? 'happy' : 'neutral', cause: null };
  }
}

export function settleEmotion(agent: EngineAgent, action: Action, triggers: Trigger[], raw?: unknown, causeId?: unknown): SettledEmotion {
  // The prompt says "doubtful" (archetype names stay out of prompts); it means skeptical.
  if (raw === 'doubtful') raw = 'skeptical';
  const llmCause = typeof causeId === 'string' ? triggers.find(t => t.id === causeId.trim()) ?? null : null;
  let { emotion, cause } = isEmotion(raw) ? { emotion: raw, cause: llmCause } : derived(agent, action, triggers);
  // Anger needs a reason. No valid cause: stressed if they really are, otherwise neutral.
  if ((emotion === 'angry' || emotion === 'frustrated') && !cause) emotion = agent.state.stress >= 60 ? 'stressed' : 'neutral';
  if (emotion === 'neutral') return { emotion, intensity: 1, cause };
  let intensity = 1;
  if (NEGATIVE.includes(emotion)) {
    if (agent.state.stress >= 60) intensity++;
    if ((cause?.severity ?? 0) >= 3 || agent.state.stress >= 85) intensity++;
    if (agent.profile.traits.impulsivity >= 70 && cause) intensity++;
  } else if (emotion === 'happy' || emotion === 'excited') {
    if (agent.state.stress < 30) intensity++;
    if (agent.profile.traits.sociability >= 70) intensity++;
  } else if ((cause?.severity ?? 0) >= 2) intensity++;
  return { emotion, intensity: Math.min(3, intensity) as 1 | 2 | 3, cause };
}
