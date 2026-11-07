interface ControlsProps {
  running?: boolean;
  started?: boolean;
  complete?: boolean;
  disabled?: boolean;
  onStart?: () => void;
  onPlayPause?: () => void;
  onStep?: () => void;
  onReset?: () => void;
}

export function Controls({
  running = false,
  started = false,
  complete = false,
  disabled = false,
  onStart,
  onPlayPause,
  onStep,
  onReset,
}: ControlsProps) {
  return (
    <div className="chart-tabs" role="group" aria-label="Simulation controls">
      {started ? (
        <button type="button" className={running ? 'chosen' : ''} aria-pressed={running} disabled={disabled || complete} onClick={onPlayPause}>{running ? '❚❚ Pause' : '▶ Play'}</button>
      ) : (
        <button type="button" disabled={disabled || complete} onClick={onStart}>▶ Start</button>
      )}
      <button type="button" disabled={disabled || running || complete} onClick={onStep}>Step →</button>
      <button type="button" disabled={disabled} onClick={onReset}>↺ Reset</button>
    </div>
  );
}
