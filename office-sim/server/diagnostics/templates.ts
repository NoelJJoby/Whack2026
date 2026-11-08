// One plain-language template per reason code. Every message says what is stuck, who it is on,
// why (from the engine's recorded reason and details), and what would unblock it. No LLM.
import type { Task } from '../../shared/business';
import { clockLabel, type ReasonCode } from '../../shared/inbox';
import type { World } from '../engine-types';

export interface Rendered { headline: string; why: string[]; unblock: string | null }
export interface TemplateContext {
  w: World;
  task: Task;
  details: Record<string, string | number>;
  /** Ticks the reason has held, including this one. */
  count: number;
  /** Tick the event was recorded. */
  turn: number;
}

const money = (minor: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(minor / 100);
const hours = (n: number) => `${Number(n.toFixed(1))} h`;
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const shortTitle = (title: string) => title.split(':')[0].trim();
const STATUS: Record<Task['status'], string> = { pending: 'not started', active: 'in progress', paused: 'on hold', review: 'in review', done: 'done', blocked: 'blocked', cancelled: 'cancelled' };
const KIND: Partial<Record<Task['kind'], string>> = { delivery: 'Delivery', release: 'Release', onboarding: 'Onboarding' };

/** "a, b and c" */
function list(items: string[]) {
  const xs = items.filter(Boolean);
  return xs.length <= 1 ? xs[0] ?? '' : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
}

export function personName(w: World, id: string | number | null | undefined) {
  if (!id) return '';
  return w.agents[String(id)]?.profile.name ?? String(id);
}

/** Active employees in a department with spare booked capacity, by name. */
export function spareCapacity(w: World, department: string) {
  const used = new Map<string, number>();
  for (const t of w.business.tasks) {
    const who = t.status === 'active' ? t.owner : t.status === 'review' ? t.reviewer : null;
    if (who) used.set(who, (used.get(who) ?? 0) + t.allocated);
  }
  return Object.values(w.business.positions)
    .filter(p => p.role === 'employee' && p.capabilities.includes(department as Task['department']) && w.agents[p.id]?.status === 'active' && (used.get(p.id) ?? 0) < p.capacity)
    .map(p => personName(w, p.id));
}

export function render(code: ReasonCode, c: TemplateContext): Rendered {
  const { w, task: t, details: d } = c;
  const name = (id: string | number | null | undefined) => personName(w, id);
  const task = `“${shortTitle(t.title)}”`;
  const quote = (title: string | number | undefined) => `“${shortTitle(String(title ?? ''))}”`;
  const owner = name(t.owner) || 'nobody';
  const dept = String(d.department ?? t.department);
  const free = spareCapacity(w, dept).filter(n => n !== owner);
  const freeText = free.length ? ` (spare capacity: ${list(free)})` : '';
  const at = (tick: string | number | undefined) => clockLabel(Number(tick ?? 0));
  const staff = String(d.staff ?? '').split(',').filter(Boolean).map(s => { const [id, load] = s.split(':'); const [used, cap] = (load ?? '').split('/'); return `${name(id)} (${used} of ${cap} h)`; });
  const stuckFor = c.count > 1 ? [`No progress for ${plural(c.count, 'hour')}.`] : [];
  const depLine = `“${shortTitle(String(d.dependencyTitle ?? ''))}” (${name(d.dependencyOwner) || 'unassigned'}) is ${STATUS[d.dependencyStatus as Task['status']] ?? d.dependencyStatus}, ${d.dependencyProgress ?? 0}% done.`;
  const holdReason = (): { why: string; unblock: string } => {
    switch (d.reason) {
      case 'booked': return { why: `Everyone in ${dept} is fully booked${staff.length ? `: ${list(staff)}` : ''}.`, unblock: `Someone in ${dept} frees up capacity, or ops pauses lower-priority work.` };
      case 'no_staff': return { why: `Nobody in ${dept} is left to take it.`, unblock: `Someone joins or is moved into ${dept}.` };
      case 'supplier': return { why: `Ops is holding it until the supplier returns at ${at(d.until)}.`, unblock: `The supplier outage ends at ${at(d.until)}.` };
      case 'dependency': return { why: `It can't start yet: ${depLine}`, unblock: `${quote(d.dependencyTitle)} is done.` };
      case 'ops_decision': return { why: `Ops left it unscheduled this round, although ${dept} had capacity.`, unblock: `Ops schedules it at the next planning round${freeText}.` };
      default: return { why: `Ops hasn't assigned anyone in ${dept} yet.`, unblock: `Ops assigns someone in ${dept}${freeText}.` };
    }
  };
  switch (code) {
    case 'UNASSIGNED': {
      const r = holdReason();
      return { headline: `${task} has no owner`, why: [r.why, ...stuckFor], unblock: r.unblock };
    }
    case 'ON_HOLD': {
      const r = holdReason();
      return { headline: `${task} is on hold`, why: [`${owner} is assigned, but ops paused it. ${r.why}`, ...stuckFor], unblock: r.unblock };
    }
    case 'REJECTED_NO_CAPABILITY':
      return { headline: `Ops tried to give ${task} to ${name(d.employee)}, who doesn't do ${dept} work`, why: [`${name(d.employee)} works in ${d.employeeDepartment || 'another department'}. The ops plan was rejected and redone.`], unblock: `Assign someone in ${dept}${freeText}.` };
    case 'REJECTED_OVER_CAPACITY':
      return { headline: `Assigning ${task} would overbook ${name(d.employee)}`, why: [`${name(d.employee)} would be booked for ${d.booked} hours with capacity for ${d.capacity}. The ops plan was rejected and redone.`], unblock: `${name(d.employee)} is already booked at ${Number(d.booked) - Number(d.adding ?? 0)} of ${d.capacity} hours; pick someone with spare capacity${freeText}.` };
    case 'REJECTED_SELF_REVIEW':
      return { headline: `${name(d.employee)} can't review their own ${task}`, why: ['Reviews must be independent. The ops plan was rejected and redone.'], unblock: `Ops needs to assign a reviewer other than ${owner}.` };
    case 'REJECTED_DEPS_NOT_DONE':
      return { headline: `${task} was assigned before ${quote(d.dependencyTitle)} was done`, why: [depLine, 'The ops plan was rejected and redone.'], unblock: `Assign it once ${quote(d.dependencyTitle)} is done.` };
    case 'REJECTED_INVALID':
      return { headline: `Ops sent an invalid assignment for ${task}`, why: [`${name(d.employee) || 'The named person'} isn't an active employee, or the allocation was zero.`], unblock: `Ops assigns an active employee in ${dept} with a positive allocation.` };
    case 'CHOSE_OTHER_ACTION': {
      const topTurns = Number(d.topTurns ?? 1);
      const first = topTurns > 1 ? `${owner} spent ${topTurns} of the last ${plural(Number(d.window), 'hour')} ${d.topLabel}.` : `${owner} chose ${d.actionLabel} this hour instead.`;
      const drivers = list(String(d.drivers ?? '').split(', '));
      return { headline: `${owner} isn't working on ${task}`, why: [first, `This hour ${d.probability}% likely${drivers ? `: ${drivers} pushed toward ${d.actionLabel}` : ''}.`], unblock: `${owner} gets back to work (lower stress and burnout help), or ops reassigns ${task}.` };
    }
    case 'WORK_NOT_OFFERED':
      return { headline: `${owner} has no active work on ${task}`, why: [`${task} is ${STATUS[d.status as Task['status']] ?? d.status}, so working on it wasn't an option.`], unblock: `Ops activates ${task}.` };
    case 'STALE_ASSIGNMENT':
      return { headline: `${owner}'s hour on ${task} didn't count`, why: [`Ops changed the assignment after ${owner} picked it up.`], unblock: 'Clears next hour, once the new assignment is read.' };
    case 'DEPENDENCY_PENDING':
      return { headline: `${task} is waiting on ${quote(d.dependencyTitle)}`, why: [`Needs ${depLine.replace(/ is /, ', which is ')}`, ...stuckFor], unblock: `${quote(d.dependencyTitle)} is done.` };
    case 'INPUT_NOT_RECEIVED': {
      const producer = name(d.producer) || 'whoever takes it';
      const shared = d.inputState === 'not_shared';
      return { headline: `${task} is waiting for an input`,
        why: [shared ? `Needs the finding from ${quote(d.inputTitle)}: ${producer} has it but hasn't shared it with ${owner} yet.` : `Needs the finding from ${quote(d.inputTitle)} (${producer}), which isn't produced yet (${STATUS[d.inputStatus as Task['status']] ?? d.inputStatus}).`, ...stuckFor],
        unblock: shared ? `${producer} shares the finding with ${owner}.` : `${quote(d.inputTitle)} is done and shared with ${owner}.` };
    }
    case 'SUPPLIER_OUTAGE':
      return { headline: `${task} is stuck: waiting on a supplier outage`, why: [`${KIND[d.kind as Task['kind']] ?? 'This'} work is blocked by the supplier outage until ${at(d.until)}.`, ...stuckFor], unblock: `The outage ends at ${at(d.until)}.` };
    case 'NO_TIME_AFTER_COORDINATION':
      return { headline: `${owner} ran out of time for ${task}`, why: ['Coordinating on the objective left less than a full turn.'], unblock: 'Next hour.' };
    case 'PARTIAL_PROGRESS':
      return { headline: `${task} is moving slowly`, why: [`${owner} has ${hours(Number(d.allocated))} per hour on it with ${hours(Number(d.remaining))} left: about ${d.turns} more working hours.`], unblock: `Ops raises ${owner}'s allocation on ${task}.` };
    case 'PROGRESS_MADE':
      return { headline: `${task} advanced`, why: [`${owner} did ${hours(Number(d.progress))} of work.`], unblock: null };
    case 'HIGH_DEFECT_RISK': {
      const factor = d.factor === 'burnout' ? `${owner}'s burnout (${d.burnout})` : d.factor === 'workload' ? `${owner}'s workload (${d.workload}, over 70)` : `weak company controls (${d.controls}%)`;
      const review = d.review === 'pending' ? 'Review will check it.' : d.review === 'done' ? 'It already passed one review.' : 'It isn’t reviewed.';
      return { headline: `${task} was finished under high defect risk`, why: [`Defect risk was ${d.risk}%, mainly ${factor}.`, review], unblock: `Lighten ${owner}'s load before the next piece of work; process and support work strengthens controls.` };
    }
    case 'DEFECT_LINKED':
      return { headline: `${task} finished`, why: [], unblock: null };
    case 'DEFECT_SURFACED':
      return { headline: `A defect in ${task} surfaced as a security case`, why: [`${d.headline}: a configuration check found it after ${name(d.agent) || owner} finished ${task} on ${at(d.finished)}.`], unblock: 'Containment work on the security case.' };
    case 'AWAITING_REVIEWER': {
      const reason = d.reason === 'booked' ? ` Everyone else in ${dept} is fully booked${staff.length ? `: ${list(staff)}` : ''}.` : d.reason === 'no_staff' ? ` Nobody else in ${dept} can review it.` : '';
      return { headline: `${task} is waiting for a reviewer`, why: [`Finished by ${owner}; it needs someone else in ${dept} to review it.${reason}`, ...stuckFor], unblock: `Ops needs to assign a reviewer other than ${owner}${freeText}.` };
    }
    case 'REWORK_AFTER_REVIEW':
      return { headline: `Review sent ${task} back`, why: [`${name(d.reviewer)} found a defect: 1 hour of rework for ${owner}.${d.maxRework ? ` (${d.rework} of ${d.maxRework} reworks allowed.)` : ''}`], unblock: `${owner} reworks it and it passes review again.` };
    case 'AT_RISK': {
      const finish = Number(d.finish) > 0 ? `projected to finish ${at(d.finish)}` : 'no finish in sight at this pace';
      return { headline: `${task} will likely miss its deadline`,
        why: [`${hours(Number(d.remaining))} left; ${owner} worked ${d.worked} of the last ${plural(Number(d.window), 'hour')} at ${hours(Number(d.allocated))} per hour, so it's ${finish} against a deadline of ${at(d.deadline)}.`, ...(d.client ? [`The ${d.client} contract is on the line.`] : [])],
        unblock: `${owner} works more steadily, ops raises the allocation, or ops reassigns ${task}.` };
    }
    case 'OVERDUE':
      return { headline: `${task} is overdue`, why: [`It was due ${at(d.deadline)} with ${hours(Number(d.remaining))} still to do.`], unblock: t.owner ? `${owner} finishes it.` : `Ops assigns someone in ${dept}${freeText}.` };
    case 'CASE_FAILED':
      return { headline: `${quote(d.headline)} failed: the deadline passed`, why: [`The deadline, ${at(d.deadline)}, passed with ${task} ${STATUS[d.status as Task['status']] ?? d.status}.`, ...(d.contracts ? [`${d.contracts} contract now at risk.`] : [])], unblock: 'Too late to recover this case; the remaining work stays on the books.' };
    case 'OWNER_LEFT':
      return { headline: `${task} lost its owner`, why: [`${name(d.agent)} ${d.how === 'laid_off' ? 'was laid off' : 'quit'} at ${at(c.turn)}; the task is blocked with no owner.`, ...stuckFor], unblock: `Reassign to someone in ${dept}${freeText}.` };
    case 'SAVINGS_TARGET_MISSED':
      return { headline: `${task} missed its savings target`, why: [`It needed ${money(Number(d.target))} a day off ${d.rate === 'dailyInfrastructure' ? 'infrastructure' : 'discretionary'} spend, which was only ${money(Number(d.available))} a day. It completed as blocked.`], unblock: 'The CEO picks another option at the next review.' };
    case 'DEADLINE_INFEASIBLE':
      return { headline: `${task} can't make its deadline, even at full effort`, why: [`It needs about ${plural(Number(d.needed), 'working hour')} along its dependency chain; only ${plural(Number(d.available), 'working hour')} remain before ${at(d.deadline)}.`], unblock: 'Management moves the deadline, adds people, or cuts scope.' };
    case 'CHASED': {
      const expect = Number(d.expectRemaining) > 0 ? `at most ${hours(Number(d.expectRemaining))} left on it` : 'the task finished';
      return { headline: `${name(d.chaser)} chased ${name(d.owner)} about ${task}`, why: [`${d.why}.`, `Expected by ${at(d.dueBy)}: ${expect}.`], unblock: `${name(d.owner)} delivers by ${at(d.dueBy)}.` };
    }
    case 'CHASE_MISSED':
      return { headline: `${name(d.owner)} missed the ${at(d.dueBy)} expectation on ${task}`, why: [`${d.ownTurns} of ${plural(Number(d.counted), 'counted hour')} were ${name(d.owner)}'s own choice; ${d.blockedTurns} were blocked${d.blocker ? ` (mostly ${d.blocker})` : ''}.`, d.fault === 'owner' ? `That is ${name(d.owner)}'s fault: the CEO calls them in.` : `Not ${name(d.owner)}'s fault: the manager fixes the blocker instead.`], unblock: null };
    case 'BLOCKER_FIXED_BY_MANAGER':
      return { headline: `${name(d.manager)} fixed what was holding up ${task}`, why: [`${d.fix}.`, `Nobody was punished: the delay wasn't ${name(d.owner) || 'the owner'}'s fault.`], unblock: null };
    case 'MEETING_OUTCOME':
      return { headline: d.outcome === 'fired' ? `${name(d.agent)} was fired over ${task}` : `${name(d.boss)} gave ${name(d.agent)} a warning over ${task}`,
        why: [`${d.reason}.`, d.outcome === 'fired' ? `${name(d.agent)} has left; their work needs a new owner.` : `Another miss of their own making within ${plural(Number(d.warningDays), 'working day')} means dismissal.`, ...(Number(d.cutscene) ? [] : ['Summarised here only: a meeting already played today.'])], unblock: null };
    case 'COMPLETED': {
      const effects = [
        Number(d.revenue) > 0 ? `${money(Number(d.revenue))} revenue${d.client ? ` from ${d.client}` : ''}` : '',
        Number(d.collection) > 0 ? `${money(Number(d.collection))} cash collected` : '',
        Number(d.saving) > 0 ? `${money(Number(d.saving))} a day saved` : '',
        Number(d.controls) > 0 ? `controls up ${d.controls} points` : '',
        Number(d.contained) ? 'exposure contained' : '',
        d.followOn ? `follow-on work: ${String(d.followOn).split(' | ').map(quote).join(', ')}` : '',
      ].filter(Boolean);
      return { headline: `${task} is done`, why: [effects.length ? `Effects: ${list(effects)}.` : 'No direct business effects.'], unblock: null };
    }
  }
}

/** Short phrase for a resolved thread: what cleared. */
export const CLEARED: Partial<Record<ReasonCode, string>> = {
  UNASSIGNED: 'it got an owner', ON_HOLD: 'ops resumed it', CHOSE_OTHER_ACTION: 'work resumed', WORK_NOT_OFFERED: 'work resumed',
  STALE_ASSIGNMENT: 'the assignment was read again', DEPENDENCY_PENDING: 'the dependency finished', INPUT_NOT_RECEIVED: 'the input arrived',
  SUPPLIER_OUTAGE: 'the supplier outage ended', AWAITING_REVIEWER: 'a reviewer was assigned', REWORK_AFTER_REVIEW: 'rework resumed',
  AT_RISK: 'the projection recovered', OVERDUE: 'it was finished', OWNER_LEFT: 'it was reassigned',
  REJECTED_NO_CAPABILITY: 'it was assigned', REJECTED_OVER_CAPACITY: 'it was assigned', REJECTED_SELF_REVIEW: 'a reviewer was assigned',
  REJECTED_DEPS_NOT_DONE: 'it was assigned', REJECTED_INVALID: 'it was assigned',
};
