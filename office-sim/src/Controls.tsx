function durationLabel(ticks: number) {
  if (ticks === 25) return '1 week (5d)';
  if (ticks === 50) return '1 month (10d)';
  if (ticks === 100) return '2 months (20d)';
  if (ticks === 150) return '1 quarter (30d)';
  return `${ticks} hours`;
}
interface ControlsProps {
  running?: boolean; complete?: boolean; disabled?: boolean; tick?: number; runLength?: number; runLengths?: number[];
  onRunLength?: (hours: number) => void; onStep?: () => void; onReset?: () => void; onNewSeed?: () => void;
}
export function Controls({ running, complete, disabled, tick = 0, runLength, runLengths = [], onRunLength, onStep, onReset, onNewSeed }: ControlsProps) {
  return <div className="simulation-controls">
    <fieldset><legend>Run duration</legend><div className="duration-options">{runLengths.map(n => <button key={n} aria-pressed={runLength === n} disabled={disabled || n < tick} onClick={() => onRunLength?.(n)}>{durationLabel(n)}</button>)}</div></fieldset>
    <p>{Math.floor(tick / 5)} of {Math.floor((runLength ?? 150) / 5)} days completed ({tick} of {runLength} hours)</p>
    <button disabled={disabled || running || complete} onClick={onStep}>Advance one hour</button>
    <div className="reset-controls"><button disabled={disabled} onClick={onReset}>Reset run</button><button disabled={disabled} onClick={onNewSeed}>New run</button></div>
  </div>;
}
