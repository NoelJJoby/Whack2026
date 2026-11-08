import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  companyObjectiveLimits, isCompanyObjectiveText,
  type CompanyTaskStatus, type CompanyTaskSummary, type SubmitCompanyTask,
} from '../shared/companyTasks';
import { playerText } from './hudModel';
import { api } from './useSimulation';

const statusLabel: Record<CompanyTaskStatus, string> = {
  queued: 'Queued',
  delegated: 'Assigned',
  in_progress: 'In progress',
  blocked: 'Waiting on work',
  review: 'In review',
  completed: 'Accepted',
  failed: 'Failed',
  abandoned: 'Abandoned',
};

interface Props {
  runId?: string;
  tasks: CompanyTaskSummary[];
  connected: boolean;
  complete: boolean;
  running: boolean;
}

export function CompanyTaskComposer({ runId, tasks, connected, complete, running }: Props) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<CompanyTaskSummary>();
  const pending = useRef<SubmitCompanyTask>();
  const inFlight = useRef(false);
  const receiptFocus = useRef<HTMLDivElement>(null);
  const objective = draft.trim();
  const { minLength, maxLength } = companyObjectiveLimits;
  const validText = isCompanyObjectiveText(objective);
  const invalid = Boolean(objective) && (objective.length < minLength || !validText);
  // The POST receipt covers the gap before SSE delivers the same task. After
  // that, the run snapshot owns the status, including completion and reset.
  const latest = receipt && !tasks.some(task => task.id === receipt.id) ? receipt : tasks.at(-1);
  const active = latest && !latest.outcome;
  const unavailable = !connected || !runId || complete;

  useEffect(() => {
    if (receipt) receiptFocus.current?.focus({ preventScroll: true });
  }, [receipt]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unavailable || !runId || inFlight.current || active || invalid || !objective) return;
    if (pending.current?.objective !== objective) {
      pending.current = {
        run_id: runId,
        idempotency_key: crypto.getRandomValues(new Uint32Array(4)).join('-'),
        objective,
      };
    }
    inFlight.current = true;
    setSending(true);
    setError('');
    try {
      const task = await api<CompanyTaskSummary>('/sim/company-tasks', { method: 'POST', body: pending.current });
      setReceipt(task);
      setDraft('');
      pending.current = undefined;
    } catch (failure) {
      setError(playerText(failure instanceof Error ? failure.message : 'Could not queue the task. Try again.'));
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return <div className="task-composer">
      {latest && <div className="event-panel task-receipt" ref={receiptFocus} tabIndex={-1} role="status">
        <div className="task-receipt-heading">
          <h3>{active ? 'Current objective' : 'Last objective'}</h3>
          <span className={latest.status === 'failed' || latest.status === 'abandoned' ? 'coral' : active ? 'gold' : 'mint'}>
            {latest.status === 'completed' && latest.outcome?.timing === 'late' ? 'Accepted late' : statusLabel[latest.status]}
          </span>
        </div>
        <p className="task-objective">{latest.objective}</p>
        {latest.status === 'queued' && <p className="task-note">{running ? 'The CEO will pick this up during office hours.' : 'Close this panel and use Play or Step to begin.'}</p>}
      </div>}
      {!active && <form className="event-panel task-form" onSubmit={submit} aria-busy={sending}>
        <p className="task-intro">Give the company something to work on. The CEO will plan the work and Ops will assign it.</p>
        <div>
          <label className="event-headline-label" htmlFor="company-objective">
            Objective <span aria-hidden="true">{draft.length}/{maxLength}</span>
          </label>
          <textarea id="company-objective" className="event-headline" rows={4} value={draft} maxLength={maxLength}
            placeholder="Investigate demand for a new service and plan its launch."
            aria-invalid={invalid} aria-describedby="company-objective-help" readOnly={sending}
            onChange={event => { setDraft(event.target.value); setError(''); }}/>
          <p id="company-objective-help" className="event-headline-check">
            {invalid ? <span className="coral">{validText ? `Use at least ${minLength} characters.` : 'Enter an objective in plain text.'}</span> : 'The CEO will set the plan in motion during office hours.'}
          </p>
        </div>
        <div className="task-form-footer">
          <p className={error ? 'task-note coral' : 'task-note'} role="status">
            {error || (complete ? 'Reset the simulation or extend the run to queue another task.'
              : unavailable ? 'Connect to the simulation to queue a task.' : 'One objective at a time.')}
          </p>
          <button className="post-event" type="submit" disabled={unavailable || sending || invalid || !objective}>
            {sending ? 'Queueing…' : 'Queue task'}
          </button>
        </div>
      </form>}
    </div>;
}
