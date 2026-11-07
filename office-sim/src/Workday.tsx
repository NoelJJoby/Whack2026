export function workdayTime(tick: number) {
  const elapsed = tick > 0 ? (tick - 1) % 16 + 1 : 0;
  return { day: tick > 0 ? Math.floor((tick - 1) / 16) + 1 : 1, hour: 8 + elapsed, progress: elapsed / 16 * 100 };
}
export function Workday({ tick, speed, running, started, complete, disabled, onSpeed, onToggle }: {
  tick: number; speed: number; running: boolean; started: boolean; complete: boolean; disabled: boolean;
  onSpeed: (speed: number) => void; onToggle: () => void;
}) {
  const { day, hour } = workdayTime(tick);
  return <section className="clock-hud" aria-label="Time and playback">
    <div className="clock-readout"><span>Day {day}</span><strong>{String(hour).padStart(2, '0')}:00</strong><span className="playback-status">{complete ? 'Finished' : running ? 'Running' : 'Paused'}</span></div>
    <div className="playback"><button className="play-button" disabled={disabled || complete} onClick={onToggle}><span aria-hidden="true">{running ? 'Ⅱ' : '▶'}</span> {running ? 'Pause' : started ? 'Play' : 'Start'}</button><div className="speed-controls" role="group" aria-label="Playback speed">{[0.5, 1, 2, 4].map(value => <button key={value} aria-pressed={speed === value} disabled={disabled} onClick={() => onSpeed(value)}>{value}×</button>)}</div></div>
  </section>;
}
