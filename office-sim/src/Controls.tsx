interface ControlsProps {
  running?: boolean;
  started?: boolean;
  onStart?: () => void;
  onPlayPause?: () => void;
  onStep?: () => void;
  onReset?: () => void;
}

export function Controls({
  running = false,
  started = false,
  onStart,
  onPlayPause,
  onStep,
  onReset,
}: ControlsProps) {
  return (
    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
      <button type="button" onClick={onStart}>Start</button>
      <button type="button" onClick={onPlayPause}>{running ? 'Pause' : started ? 'Play' : 'Play'}</button>
      <button type="button" onClick={onStep}>Step</button>
      <button type="button" onClick={onReset}>Reset</button>
    </div>
  );
}
