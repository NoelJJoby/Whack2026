import { workdayTime } from '../../shared/workday';

// A stylised office day: dawn for arrivals, dusk at closing, then a blue night.
// These are simulation hours, independent of the computer's clock or timezone.
const KEYS = [
  { hour: 0, sky: '#101a30', sun: '#a7bfff', ambient: 0.38, sunlight: 0.18, lamps: 1 },
  { hour: 7, sky: '#18233d', sun: '#a7bfff', ambient: 0.38, sunlight: 0.18, lamps: 1 },
  { hour: 8, sky: '#a77979', sun: '#ffab70', ambient: 0.75, sunlight: 0.8, lamps: 0.65 },
  { hour: 9, sky: '#b6cbd6', sun: '#ffdcad', ambient: 1.2, sunlight: 1.9, lamps: 0.15 },
  { hour: 12, sky: '#a6cbe2', sun: '#fff1d5', ambient: 1.4, sunlight: 2.4, lamps: 0 },
  { hour: 15, sky: '#c5b3ac', sun: '#ffd09a', ambient: 1.15, sunlight: 1.8, lamps: 0.1 },
  { hour: 16, sky: '#b97770', sun: '#ff9a63', ambient: 0.85, sunlight: 1.1, lamps: 0.45 },
  { hour: 17, sky: '#3b3856', sun: '#ffac7d', ambient: 0.5, sunlight: 0.3, lamps: 0.9 },
  { hour: 19, sky: '#101a30', sun: '#a7bfff', ambient: 0.38, sunlight: 0.18, lamps: 1 },
  { hour: 24, sky: '#101a30', sun: '#a7bfff', ambient: 0.38, sunlight: 0.18, lamps: 1 },
];

export function daylightAt(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  const next = KEYS.findIndex(key => key.hour > h);
  const from = KEYS[next - 1], to = KEYS[next];
  const fraction = (h - from.hour) / (to.hour - from.hour);
  const mix = (a: number, b: number) => a + (b - a) * fraction;
  // The sun crosses from east to west; a soft overhead moon keeps night readable.
  const sunProgress = Math.max(0, Math.min(1, (h - 8) / 9));
  const angle = Math.PI * sunProgress;
  const night = h < 8 || h >= 18;
  return {
    from, to, fraction,
    ambient: mix(from.ambient, to.ambient),
    sunlight: mix(from.sunlight, to.sunlight),
    lamps: mix(from.lamps, to.lamps),
    sunProgress,
    sunVisibility: Math.max(0, Math.min(1, (h - 7.5) * 2, (17.5 - h) * 2)),
    position: (night ? [-14, 26, 16] : [-Math.cos(angle) * 26, 5 + Math.sin(angle) * 26, 16]) as [number, number, number],
  };
}

export const daylightForTick = (tick: number) => daylightAt(workdayTime(tick).hour);

/** Only replay arrivals when presence changes in this session, or the first workday starts. */
export function walksIn(previous: boolean | undefined, present: boolean, previousTick: number, tick: number): boolean {
  return present && (previous === false || previous === true && previousTick === 0 && tick === 1);
}
