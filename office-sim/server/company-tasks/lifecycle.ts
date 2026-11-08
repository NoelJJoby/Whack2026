import type { Task, WorkResult } from '../../shared/business';
import type { CompanyTask, CompanyTaskOutcome } from '../../shared/companyTasks';
import type { World } from '../engine-types';
import { managementOwners } from '../events/lifecycle';
import { createRng, hashKey } from '../rng';
import { knownInputs } from './collaboration';
import { companyLimits } from './config';
import { activeCompanyTask, addActivity } from './state';

function revealFinding(w: World, mission: CompanyTask, task: Task, producer: string) {
  const meta = mission.work[task.id];
  if (!meta.producesFinding) return;
  const rng = createRng(hashKey(w.seed, 'company-task-finding', mission.objective, task.title));
  const inputs = mission.findings.filter(f => Object.values(meta.consumedFindings).includes(f.id));
  const segments = ['small service teams', 'mid-sized operations teams', 'enterprise pilot buyers'];
  const constraints = ['onboarding time', 'integration effort', 'support coverage'];
  const priorities = ['data access', 'handover time', 'capacity for change'];
  const facts = meta.category === 'research' ? [
    { label: 'Pilot segment', value: segments[rng.int(segments.length)] },
    { label: 'Buying constraint', value: constraints[rng.int(constraints.length)] },
    { label: 'Pilot signal', value: 'interest conditional on a small trial with a measurable result' },
  ] : [
    { label: 'Decision', value: inputs.length ? 'use a limited pilot informed by the received work' : 'start with a controlled trial of the current process' },
    { label: 'Main constraint', value: inputs[0]?.facts[1]?.value ?? priorities[rng.int(priorities.length)] },
    { label: 'Acceptance check', value: 'compare the trial to the current process and document any gaps' },
  ];
  mission.findings.push({
    id: `${task.id}-finding-v1`, version: 1, taskId: task.id, producer, facts,
    summary: `For “${task.title}”, the simulated result is ${facts.map(f => `${f.label.toLowerCase()} — ${f.value}`).join('; ')}.`,
    completedTick: w.tick, knownBy: [producer],
  });
}

function observeWork(w: World, mission: CompanyTask, task: Task, result: WorkResult) {
  const meta = mission.work[task.id];
  const reviewed = result.action === 'review_work';
  if (result.progress > 0 && !reviewed) {
    meta.author = result.agent;
    meta.firstProgressTick ??= w.tick;
    for (const input of knownInputs(mission, task.id, result.agent)) meta.consumedFindings[input.taskId] = input.id;
  }
  if (reviewed && result.progress > 0 && task.status === 'pending' && task.reviewed) {
    meta.rework++;
    task.reviewed = false; // A revised submission must pass review again.
    task.version++;
  }
  if (task.status === 'done' && meta.completedTick === undefined) {
    meta.completedTick = w.tick;
    revealFinding(w, mission, task, meta.author ?? result.agent);
  }
  addActivity(mission, w.tick, {
    round: 4, actor: result.agent, recipients: [], taskId: task.id, kind: reviewed || task.status === 'review' ? 'review' : 'progress',
    location: 'work ledger', dialogue: result.outcome, result: `${result.action}: ${result.progress} units`, workResultId: result.id,
  });
}

function finish(w: World, mission: CompanyTask, state: CompanyTaskOutcome['state'], reason: string) {
  const timing = mission.deadlineTick !== undefined && w.tick > mission.deadlineTick ? 'late' : 'on_time';
  const workIds = mission.brief?.workIds ?? [];
  const news = w.eventState.cases.find(e => e.templateId === 'release_success' && e.status === 'resolved' && e.tasks.some(id => workIds.includes(id)));
  mission.status = state === 'accepted' ? 'completed' : state;
  mission.outcome = { state, timing, tick: w.tick, reason, criteria: workIds.map(id => ({
    text: mission.work[id].acceptance, accepted: mission.work[id].completedTick !== undefined, workIds: [id],
  })), ...(news ? { newsCaseId: news.id } : {}) };
  const actor = managementOwners(w).ceo;
  addActivity(mission, w.tick, {
    round: 5, actor, recipients: w.ids.filter(id => id !== actor && w.agents[id].status === 'active'),
    kind: 'outcome', location: 'executive office', dialogue: reason, result: `${state} / ${timing}`,
    ...(actor && mission.brief ? { decision: {
      authority: w.business.positions[actor].role === 'ceo' ? 'ceo' as const : 'acting' as const,
      question: 'Can the company accept the objective?', options: ['Accept verified work', 'Close with incomplete work'],
      explanation: reason, evidence: mission.activity.filter(a => ['review', 'deadline', 'priority', 'departure'].includes(a.kind)
        || a.kind === 'assignment' && a.allocation?.previous !== a.allocation?.assignee).slice(-8).map(a => a.id),
      workIds, briefVersion: mission.brief.version, source: 'rules' as const,
    } } : {}),
  });
  for (const task of w.business.tasks.filter(t => mission.work[t.id] && t.status !== 'done')) {
    task.status = 'cancelled';
    task.allocated = 0;
    delete task.reviewer;
    task.version++;
  }
  if (mission.brief) {
    for (const task of w.business.tasks) {
      const displaced = mission.displaced[task.id];
      if (!displaced || task.status !== 'paused' && !(task.status === 'review' && !task.reviewer)) continue;
      if (task.status === 'paused') {
        task.status = 'pending';
        task.version++;
      }
      addActivity(mission, w.tick, { round: 5, actor: managementOwners(w).ops, recipients: [], taskId: task.id,
        kind: 'restored', location: 'office', dialogue: `Return “${task.title}” to the scheduling pool.` });
    }
    w.eventState.lastOpsInput = undefined;
  }
}

export function observeCompanyTick(w: World, quits: string[], endOfRun: boolean) {
  const mission = activeCompanyTask(w);
  if (!mission) return;
  if (!mission.brief) {
    if (endOfRun) finish(w, mission, 'abandoned', 'The run ended before the company could brief the objective.');
    return;
  }
  const work = w.business.tasks.filter(t => mission.work[t.id]);
  for (const result of w.business.work.filter(r => r.tick === w.tick)) {
    // When an owner disengages the selected action may omit the task reference.
    // Link the delay without writing a second WorkResult or crediting any effort.
    const task = work.find(t => t.id === result.taskId);
    if (task && (result.progress > 0 || task.owner === result.agent || task.reviewer === result.agent)) observeWork(w, mission, task, result);
    else {
      for (const waiting of work.filter(t => t.status === 'active' && t.owner === result.agent || t.status === 'review' && t.reviewer === result.agent)) {
        addActivity(mission, w.tick, { round: 4, actor: result.agent, recipients: [], taskId: waiting.id, kind: 'progress',
          location: 'work ledger', dialogue: `No progress on “${waiting.title}” during this turn.`,
          result: result.action, workResultId: result.id });
      }
    }
  }
  const departed = new Set([...quits, ...w.ids.filter(id => w.agents[id].quitTick === w.tick)]);
  for (const task of work) {
    const lastAssignment = [...mission.activity].reverse().find(a => a.kind === 'assignment' && a.taskId === task.id);
    const lost = [...departed].find(id => task.owner === id || task.reviewer === id || !task.owner && lastAssignment?.recipients[0] === id);
    if (lost && task.status !== 'done') addActivity(mission, w.tick, {
      round: 4, actor: lost, recipients: [], taskId: task.id, kind: 'departure', location: 'office',
      dialogue: `${w.agents[lost].profile.name} left the company. Ops must review coverage for “${task.title}”.`,
    });
    if (w.tick > task.deadline && !mission.work[task.id].missedDeadlineTick
      && (mission.work[task.id].completedTick ?? w.tick) > task.deadline) {
      mission.work[task.id].missedDeadlineTick = w.tick;
      addActivity(mission, w.tick, { round: 4, actor: null, recipients: [], taskId: task.id, kind: 'deadline',
        location: 'work ledger', dialogue: `“${task.title}” missed its checkpoint at tick ${task.deadline}.` });
    }
  }
  if (w.tick > mission.brief.deadlineTick && !mission.missedDeadlineTick) {
    mission.missedDeadlineTick = w.tick;
    addActivity(mission, w.tick, { round: 4, actor: null, recipients: [], kind: 'deadline', location: 'work ledger',
      dialogue: `The company objective missed its deadline at tick ${mission.brief.deadlineTick}.` });
  }
  const exhaustedReview = work.find(t => mission.work[t.id].rework >= companyLimits.maxRework);
  if (work.every(t => t.status === 'done')) {
    finish(w, mission, 'accepted', mission.missedDeadlineTick ? 'Independent acceptance passed after the deadline. The objective is complete.' : 'Independent acceptance passed. The objective is complete on time.');
  } else if (exhaustedReview) {
    finish(w, mission, 'failed', `“${exhaustedReview.title}” exhausted the rework allowance without passing acceptance.`);
  } else if (w.tick >= mission.brief.deadlineTick + companyLimits.graceTicks) {
    finish(w, mission, 'failed', 'The delivery window and recovery period expired with acceptance work incomplete.');
  } else if (endOfRun || !managementOwners(w).ceo) {
    finish(w, mission, 'abandoned', endOfRun ? 'The run ended with acceptance work incomplete.' : 'No manager remains to oversee the objective.');
  } else {
    mission.status = work.some(t => t.status === 'review') ? 'review'
      : work.some(t => t.status === 'active' && t.owner && canAdvance(w, mission, t)) ? 'in_progress'
      : 'blocked';
  }
}

function canAdvance(w: World, mission: CompanyTask, task: Task) {
  return mission.work[task.id].requiredInputs.every(id =>
    w.business.tasks.some(t => t.id === id && t.status === 'done') && mission.findings.some(f => f.taskId === id && f.knownBy.includes(task.owner!)));
}
