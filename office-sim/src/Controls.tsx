interface ControlsProps {
  running?: boolean; complete?: boolean; disabled?: boolean; tick?: number; runLength?: number; runLengths?: number[];
  onRunLength?: (hours: number) => void; onStep?: () => void; onReset?: () => void; onNewSeed?: () => void;
}
export function Controls({ running, complete, disabled, tick = 0, runLength, runLengths = [], onRunLength, onStep, onReset, onNewSeed }: ControlsProps) {
  return <div className="simulation-controls">
    <fieldset><legend>Run duration</legend><div className="duration-options">{runLengths.map(n => <button key={n} aria-pressed={runLength === n} disabled={disabled || n < tick} onClick={() => onRunLength?.(n)}>{n} hours</button>)}</div></fieldset>
    <p>{tick} of {runLength} hours completed</p>
    <button disabled={disabled || running || complete} onClick={onStep}>Advance one hour</button>
    <div className="reset-controls"><button disabled={disabled} onClick={onReset}>Reset run</button><button disabled={disabled} onClick={onNewSeed}>New run</button></div>
  </div>;
}
