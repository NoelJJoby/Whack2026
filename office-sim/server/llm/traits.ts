export function ambitionSentence(value: number): string {
  return value < 40 ? "You're content where you are."
    : value < 70 ? "You'd like to move up if the chance came."
      : 'You want the next role badly and watch who is in your way.';
}

export function financialNeedSentence(value: number): string {
  return value < 40 ? 'You could walk away from this job tomorrow.'
    : value < 70 ? 'You need this job but have some cushion.'
      : "You can't afford to lose this income.";
}

export function ethicsSentence(value: number): string {
  return value < 40 ? 'You bend rules when it suits you.'
    : value < 70 ? "You try to do the right thing when it's easy."
      : 'You hate dishonesty and say so.';
}

export function sociabilitySentence(value: number): string {
  return value < 40 ? 'You keep to yourself.'
    : value < 70 ? 'You chat with a few people.'
      : 'You talk to everyone and hear everything.';
}

export function impulsivitySentence(value: number): string {
  return value < 40 ? 'You think before you act.'
    : value < 70 ? 'You sometimes act before thinking.'
      : 'You act on the first impulse and regret it later.';
}

export function sourceTrustSentence(value: number): string {
  return value < 40 ? "you don't believe much of what they say"
    : value < 70 ? "you're not sure how far to trust them"
      : 'you generally trust them';
}
