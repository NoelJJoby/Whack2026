interface ControlsProps {
  running?: boolean;
  started?: boolean;
  complete?: boolean;
  disabled?: boolean;
  /** Current tick and run length; run lengths below the current tick are disabled. */
  tick?: number;
  runLength?: number;
  runLengths?: number[];
  onRunLength?: (ticks: number) => void;
  onStart?: () => void;
  onPlayPause?: () => void;
  onStep?: () => void;
  onReset?: () => void;
  onNewSeed?: () => void;
}

export function Controls({
  running = false,
  started = false,
  complete = false,
  disabled = false,
  tick = 0,
  runLength,
  runLengths = [],
  onRunLength,
  onStart,
  onPlayPause,
  onStep,
  onReset,
  onNewSeed,
}: ControlsProps) {
  return (
    <>
    {runLengths.length > 0 && <div className="chart-tabs" role="group" aria-label="Run length in ticks">
      {runLengths.map((n) => <button type="button" key={n} title={`Run for ${n} ticks`} className={runLength === n ? 'chosen' : ''} aria-pressed={runLength === n} disabled={disabled || n < tick} onClick={() => onRunLength?.(n)}>{n}</button>)}
    </div>}
    <div className="chart-tabs" role="group" aria-label="Simulation controls">
      {started ? (
        <button type="button" className={running ? 'chosen' : ''} aria-pressed={running} disabled={disabled || complete} onClick={onPlayPause}>{running ? '❚❚ Pause' : '▶ Play'}</button>
      ) : (
        <button type="button" disabled={disabled || complete} onClick={onStart}>▶ Start</button>
      )}
      <button type="button" disabled={disabled || running || complete} onClick={onStep}>Step →</button>
      <button type="button" disabled={disabled} onClick={onReset}>↺ Reset</button>
      <button type="button" disabled={disabled} onClick={onNewSeed}>⟳ New seed</button>
    </div>
    </>
  );
}
