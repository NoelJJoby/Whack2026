export function workdayTime(tick: number) {
  const elapsed = tick > 0 ? (tick - 1) % 16 + 1 : 0;
  return { day: tick > 0 ? Math.floor((tick - 1) / 16) + 1 : 1, hour: 8 + elapsed, progress: elapsed / 16 * 100 };
}

export function Workday({ tick, speed, running, complete, disabled, onSpeed }: {
  tick: number; speed: number; running: boolean; complete: boolean; disabled: boolean; onSpeed: (speed: number) => void;
}) {
  const { day, hour, progress } = workdayTime(tick);
  const period = hour >= 17 ? 'OVERTIME' : hour === 12 ? 'LUNCHTIME' : 'WORKDAY';
  return <section className="workday-panel" aria-label="Workday progress and speed">
    <div className="workday-top"><div className="workday-clock"><span>DAY {String(day).padStart(2, '0')}</span><strong>{String(hour).padStart(2, '0')}:00</strong><span className={hour >= 17 ? 'gold' : 'mint'}>{period}</span></div>
      <div className="speed-controls" role="group" aria-label="Time multiplier"><span>{complete ? 'FINISHED' : running ? 'TIME SPEED' : 'PAUSED'}</span>{[0.5, 1, 2, 4].map(value => <button type="button" key={value} aria-pressed={speed === value} className={speed === value ? 'chosen' : ''} disabled={disabled} onClick={() => onSpeed(value)}>{value}×</button>)}</div>
    </div>
    <div className="day-track" role="progressbar" aria-label={`Day ${day}, ${hour}:00`} aria-valuemin={8} aria-valuemax={24} aria-valuenow={hour}>
      <div className="overtime-zone"/><div className="day-fill" style={{ width: `${progress}%` }}/><div className="day-cursor" style={{ left: `${progress}%` }}/>
      {[25, 56.25, 81.25].map(position => <span key={position} className="day-checkpoint" style={{ left: `${position}%` }}/>)}</div>
    <div className="day-labels"><span>08:00<small>Clock in</small></span><span style={{ left: '25%' }}>12:00<small>Lunch</small></span><span style={{ left: '56.25%' }}>17:00<small>Home time</small></span><span style={{ left: '81.25%' }}>21:00<small>Night shift</small></span><span>24:00<small>Day ends</small></span></div>
    <p className="day-note">1 tick = 1 hour · Speed adjusts the wait between ticks; agent decisions may take longer.</p>
  </section>;
}
