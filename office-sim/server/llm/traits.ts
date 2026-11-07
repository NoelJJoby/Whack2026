// Trait values become sentences in five bands, so a 15 and a 35 read differently.
// The middle three bands keep the original wording; 0-14 and 90-100 are the extremes.
function band(value: number, sentences: [string, string, string, string, string]): string {
  return sentences[value < 15 ? 0 : value < 40 ? 1 : value < 70 ? 2 : value < 90 ? 3 : 4];
}

export function ambitionSentence(value: number): string {
  return band(value, [
    "You have no interest in promotion and avoid being noticed.",
    "You're content where you are.",
    "You'd like to move up if the chance came.",
    'You want the next role badly and watch who is in your way.',
    'You would step on anyone to get ahead, and everyone can tell.',
  ]);
}

export function financialNeedSentence(value: number): string {
  return band(value, [
    "You don't need the money at all; this job is a choice.",
    'You could walk away from this job tomorrow.',
    'You need this job but have some cushion.',
    "You can't afford to lose this income.",
    'One missed paycheque and you lose your home.',
  ]);
}

export function ethicsSentence(value: number): string {
  return band(value, [
    'You lie easily and feel nothing about it.',
    'You bend rules when it suits you.',
    "You try to do the right thing when it's easy.",
    'You hate dishonesty and say so.',
    'You would blow the whistle on anyone, whatever it cost you.',
  ]);
}

export function sociabilitySentence(value: number): string {
  return band(value, [
    'You barely speak to anyone and eat lunch alone.',
    'You keep to yourself.',
    'You chat with a few people.',
    'You talk to everyone and hear everything.',
    "You can't keep anything to yourself and know everyone's business.",
  ]);
}

export function impulsivitySentence(value: number): string {
  return band(value, [
    'You plan every move and never act in the heat of the moment.',
    'You think before you act.',
    'You sometimes act before thinking.',
    'You act on the first impulse and regret it later.',
    'You do whatever you feel like the second you feel it.',
  ]);
}

export function sourceTrustSentence(value: number): string {
  return value < 40 ? "you don't believe much of what they say"
    : value < 70 ? "you're not sure how far to trust them"
      : 'you generally trust them';
}
