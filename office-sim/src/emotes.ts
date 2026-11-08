// Part A UI flag and the emotion glyphs shared by the 3D view and the feed.
import type { Emotion } from '../shared/types';

/** VITE_EMOTES=false restores the previous UI (no emote icons, gestures, conversation bubbles or feed emoji). */
export const EMOTES = import.meta.env?.VITE_EMOTES !== 'false';

/** Pixel icon above the head. Neutral shows none. */
export const EMOTE_ICON: Record<Emotion, string> = {
  neutral: '', angry: '💢', frustrated: '♨', stressed: '💧', anxious: '≋', skeptical: '?', surprised: '!', happy: '♪', excited: '✨', sad: '☂',
};

/** Face in the Office wire. */
export const FEED_EMOJI: Record<Emotion, string> = {
  neutral: '😐', angry: '😠', frustrated: '😤', stressed: '😓', anxious: '😬', skeptical: '🤨', surprised: '😮', happy: '🙂', excited: '🤩', sad: '😢',
};

/** Which conversations get full speech bubbles first (at most two at once). */
export const FOCUS_PRIORITY = { confrontation: 1, venting: 2, gossip: 3, task: 4 } as const;
