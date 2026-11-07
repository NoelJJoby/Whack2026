// TEMPORARY behaviour-only placeholders, pending the persona author's text.
// The developer approved assignment in fixture cast order on 7 November 2026.
export const placeholderPersonas: readonly string[] = Object.freeze([
  'You prefer familiar routines and take a while to warm up to changes.',
  'You notice unfinished tasks and feel uneasy leaving loose ends.',
  'You enjoy a quiet chat and remember how people treated you.',
  'You like being useful and feel hurt when your effort goes unnoticed.',
  'You pause over promises and remember which ones were kept.',
  'You want room to try your own approach and dislike being watched.',
  'You value a predictable day and carry work worries home with you.',
  'You become restless when every day feels the same and notice new possibilities.',
]);

const fixtureIds = ['ceo', 'ops', 'gossip', 'climber', 'loyalist', 'skeptic', 'breadwinner', 'flight'];
const temporaryPersonas = new Map(fixtureIds.map((id, index) => [id, placeholderPersonas[index]]));

export function temporaryPersonaFor(id: string): string {
  return temporaryPersonas.get(id) ?? 'You have your own priorities and limits at work.';
}
