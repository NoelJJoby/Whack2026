// "Simulate CEO warning" from an inbox thread: a warning meeting scene for the task's owner, played
// through the same cutscene as a real one. Presentation only: the simulation state is not changed.
import type { MeetingScene } from '../shared/accountability';
import type { InboxThread } from '../shared/inbox';
import { DEFAULT_PARAMS } from '../server/params';
import { templateMeetingLines } from '../server/llm/meeting-prompt';
import type { Person } from './people';

type Who = Pick<Person, 'id' | 'name' | 'role' | 'quit' | 'present'>;

/** Hidden (null), unavailable (with why), or ready to play (with its scene). */
export type WarningPreview = null | { ok: false; why: string } | { ok: true; scene: MeetingScene };

export function warningPreview(thread: InboxThread, people: Who[], tick: number, key = String(Date.now())): WarningPreview {
  const owner = people.find(p => p.id === thread.ownerId);
  const ceo = people.find(p => p.role === 'CEO');
  // Only an unresolved task with a current employee to answer for it.
  if (thread.status === 'resolved' || !owner || owner.quit || !ceo || owner.id === ceo.id) return null;
  if (ceo.quit) return { ok: false, why: 'There is no CEO to call them in.' };
  if (owner.present === false) return { ok: false, why: `${owner.name} has left for the day.` };
  if (ceo.present === false) return { ok: false, why: `${ceo.name} has left for the day.` };
  const task = thread.title.split(':')[0].trim();
  const lines = templateMeetingLines({
    outcome: 'warning', boss: { name: ceo.name, voice: '' }, agent: { name: owner.name, voice: '' }, task,
    reason: `let "${task}" slip`, limits: DEFAULT_PARAMS.voice.words,
  });
  return { ok: true, scene: {
    id: `simulated-${thread.id}-${key}`, tick, boss: ceo.id, agent: owner.id, taskId: thread.taskId, taskTitle: thread.title,
    outcome: 'warning', reason: `let "${task}" slip`, cutscene: true, source: 'template', lines,
  } };
}
