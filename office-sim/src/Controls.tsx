import { calendarDaysElapsed } from '../shared/workday';

function durationLabel(ticks: number) {
  if (ticks === 25) return '2 weeks (15d)';
  if (ticks === 50) return '1 month (30d)';
  if (ticks === 100) return '2 months (60d)';
  if (ticks === 150) return '1 quarter (90d)';
  return `${ticks} work periods`;
}
interface ControlsProps {
  running?: boolean; complete?: boolean; disabled?: boolean; tick?: number; runLength?: number; runLengths?: number[];
  onRunLength?: (hours: number) => void; onStep?: () => void; onReset?: () => void; onNewSeed?: () => void;
}
export function Controls({ running, complete, disabled, tick = 0, runLength, runLengths = [], onRunLength, onStep, onReset, onNewSeed }: ControlsProps) {
  return <div className="simulation-controls">
    <fieldset><legend>Run duration</legend><div className="duration-options">{runLengths.map(n => <button key={n} aria-pressed={runLength === n} disabled={disabled || n < tick} onClick={() => onRunLength?.(n)}>{durationLabel(n)}</button>)}</div></fieldset>
    <p>{calendarDaysElapsed(tick)} of {calendarDaysElapsed(runLength ?? 150)} calendar days completed ({tick} of {runLength} work periods)</p>
    <button disabled={disabled || running || complete} onClick={onStep}>Advance one work period</button>
    <div className="reset-controls"><button onClick={onReset}>Reset run</button><button onClick={onNewSeed}>New run</button></div>
  </div>;
}
