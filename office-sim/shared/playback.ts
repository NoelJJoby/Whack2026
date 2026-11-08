import { TICKS_PER_QUARTER } from './workday';

/** Fast-forward leaves 24 seconds of the two-minute budget for rendering and I/O. */
export const FAST_FORWARD_SPEED = 8;
export const FAST_QUARTER_MS = 96_000;
export const FAST_TICK_MS = FAST_QUARTER_MS / TICKS_PER_QUARTER;
export const PLAYBACK_SPEEDS = [0.5, 1, 2, 4, FAST_FORWARD_SPEED] as const;
export const isFastForward = (speed: number) => speed === FAST_FORWARD_SPEED;
