// Short per-action lines so the UI has text in `rules` and `random` modes and
// after an LLM fallback. {target} and {claim} are filled in when known.
import type { Action } from './engine-types';
import type { Rng } from './rng';

export const ACTION_TEMPLATES: Record<Action, { public: string[]; inner: string[] }> = {
  work: {
    public: ['On it.', "I'll have it done by end of day.", 'Heads down today.'],
    inner: ['Just keep going.', 'Another normal day, I hope.', "Don't think, just ship."],
  },
  overwork: {
    public: ["I'll stay late and finish it.", "Leave it with me, I'll do the weekend.", 'No problem, I can take that too.'],
    inner: ['If I stop now I fall behind.', 'They will notice this. They have to.', "I can't afford to look slow."],
  },
  slack_off: {
    public: ['Taking a long lunch.', "I'm offline for a bit.", "I'll pick that up tomorrow."],
    inner: ["I can't look at this right now.", 'Nobody will notice one slow afternoon.', 'Why bother?'],
  },
  complain: {
    public: ['{target}, is it just me or is this ridiculous?', '{target}, can we talk about how this is being handled?'],
    inner: ['I need someone to say I am not crazy.', 'Somebody has to say it.'],
  },
  gossip: {
    public: ['{target}, did you hear? {claim}', "{target}, between us: {claim}"],
    inner: ['People deserve to know.', "If it's true, better we hear it early."],
  },
  verify: {
    public: ['{target}, have you heard anything solid about this: {claim}', '{target}, is this actually true? {claim}'],
    inner: ["I'm not acting on a rumour.", 'Let me check before I panic.'],
  },
  interview: {
    public: ['Dentist appointment this afternoon.', 'Got a personal thing, back in an hour.'],
    inner: ['Time to see what else is out there.', 'That recruiter call is looking better every day.'],
  },
  leak: {
    public: ['No comment.', "I'm just doing my job."],
    inner: ['If they won\'t say it, I will.', 'Customers deserve to know: {claim}'],
  },
};

export function fillTemplate(template: string, target: string | null, claim: string | null): string {
  return template.replace('{target}', target ?? 'hey').replace('{claim}', claim ?? 'something is going on');
}

export function templateLines(
  action: Action,
  targetName: string | null,
  claimText: string | null,
  rng: Rng,
): { public_line: string; inner_monologue: string } {
  const t = ACTION_TEMPLATES[action];
  return {
    public_line: fillTemplate(t.public[rng.int(t.public.length)], targetName, claimText),
    inner_monologue: fillTemplate(t.inner[rng.int(t.inner.length)], targetName, claimText),
  };
}
