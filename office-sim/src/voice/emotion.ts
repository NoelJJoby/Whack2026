// A spoken line's emotion, derived from data the round already carries. Pure.
import type { Action, EventType } from '../../shared/types';

export type Emotion = 'normal' | 'happy' | 'angry' | 'sad';

export interface EmotionInput {
  quit: boolean;
  action: Action;
  stress: number;
  stressDelta: number;
  burnout: number;
  trust: number;
  events: EventType[];
}

/** First matching rule wins: angry, sad, happy, then normal. */
export function emotionFor({ quit, action, stress, stressDelta, burnout, trust, events }: EmotionInput): Emotion {
  if (action === 'complain' || action === 'leak' || (stressDelta >= 10 && stress > 60) || (quit && trust < 30)) return 'angry';
  if (quit || burnout >= 70 || (stress > 60 && (action === 'slack_off' || action === 'interview'))) return 'sad';
  if ((events.includes('surprise_bonus') && stress < 60) || (stress < 40 && stressDelta <= -5) || stress < 25) return 'happy';
  return 'normal';
}
