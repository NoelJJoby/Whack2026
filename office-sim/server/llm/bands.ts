import type { AgentState } from '../../shared/types';
import type { FeelingVariants } from './voice';

// Feelings are given as facts, not phrases, so the model has nothing to parrot.
// Each band (below 40, below 70, 70 and up) has three variants; an agent's
// voice card fixes which one they see, so their facts stay consistent.
type Band = readonly [string, string, string];
type Table = readonly [Band, Band, Band];

const STRESS: Table = [
  ['Your to-do list is under control.', 'You left on time yesterday.', 'Nothing on your desk is overdue.'],
  ['You snapped at someone over something small this morning.', "You're behind on most of what's on your list.", 'You ate lunch at your desk again.'],
  ["You've had a headache since this morning and can't get through your list.", 'You jump every time a message comes in.', "You haven't had a proper break in days."],
];

const BURNOUT: Table = [
  ['You had a decent break recently.', 'You still enjoy parts of the work.', 'You slept well last night.'],
  ["You've slept badly all week.", "You've cancelled plans twice this month because of work.", 'Your weekends go on recovering from the week.'],
  ['You sat in the car park for ten minutes before coming in today.', "You can't remember a day you didn't think about work.", "You've stopped replying to friends."],
];

const LOYALTY: Table = [
  ['You looked at job listings this week.', "You wouldn't miss this place much.", "You've stopped going to team drinks."],
  ["You like a few people here, and that's most of why you stay.", "You've thought about leaving, but not seriously.", "You'd stay if things got a bit better."],
  ["You've stayed through hard times here before.", "You've turned down other offers to stay.", 'You still wear the company hoodie at weekends.'],
];

const TRUST: Table = [
  ["The last two things leadership promised didn't happen.", "You've stopped reading the all-staff emails.", "You were told there'd be no restructuring, and then there was."],
  ['Leadership has kept some promises and broken others.', 'You read the all-staff emails but check the details.', 'Your manager sometimes tells you more than the official line.'],
  ['Leadership has kept its word to you before.', 'Your manager backed you up when it mattered.', "You've seen the company look after people who struggled."],
];

const band = (value: number) => (value < 40 ? 0 : value < 70 ? 1 : 2);

function pick(table: Table, value: number, variants?: readonly number[]): string {
  const b = band(value);
  return table[b][(variants?.[b] ?? 0) % table[b].length];
}

export const stressSentence = (value: number, variants?: readonly number[]) => pick(STRESS, value, variants);
export const burnoutSentence = (value: number, variants?: readonly number[]) => pick(BURNOUT, value, variants);
export const loyaltySentence = (value: number, variants?: readonly number[]) => pick(LOYALTY, value, variants);
export const managementTrustSentence = (value: number, variants?: readonly number[]) => pick(TRUST, value, variants);

/** Every variant, for tests and leak checks. */
export const FEELING_TABLES = { stress: STRESS, burnout: BURNOUT, loyalty: LOYALTY, trust: TRUST };

// Workload has no wording table; do not invent a fifth sentence.
export function stateParagraph(
  state: Pick<AgentState, 'stress' | 'burnout' | 'loyalty' | 'trust_mgmt'>,
  variants?: FeelingVariants,
): string {
  return [
    stressSentence(state.stress, variants?.stress), burnoutSentence(state.burnout, variants?.burnout),
    loyaltySentence(state.loyalty, variants?.loyalty), managementTrustSentence(state.trust_mgmt, variants?.trust),
  ].join(' ');
}
