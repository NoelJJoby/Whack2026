import { useEffect, useState } from 'react';
import { workdayTime, isOvertime } from '../shared/workday';
export { workdayTime } from '../shared/workday';

export function Workday({ tick, speed, running, started, complete, disabled, onSpeed, onToggle }: {
  tick: number; speed: number; running: boolean; started: boolean; complete: boolean; disabled: boolean;
  onSpeed: (speed: number) => void; onToggle: () => void;
}) {
  const { month, dayOfMonth, fillerDays, hour } = workdayTime(tick);
  const [fillerOffset, setFillerOffset] = useState(0);

  useEffect(() => {
    setFillerOffset(0);
    if (fillerDays.length === 0 || !started) return;
    // Smoothly roll through the 2 routine filler days after 17:00 so each month counts Days 1..30.
    const stepMs = Math.max(60, Math.round(250 / (speed || 1)));
    const t1 = setTimeout(() => setFillerOffset(1), stepMs);
    const t2 = setTimeout(() => setFillerOffset(2), stepMs * 2);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [tick, speed, started, fillerDays.length]);

  const displayedDay = fillerOffset > 0 && fillerDays[fillerOffset - 1] ? fillerDays[fillerOffset - 1] : dayOfMonth;

  return <section className="clock-hud" aria-label="Time and playback">
    <div className="clock-readout"><span>M{month} · Day {displayedDay}{isOvertime(tick) ? ' · Overtime' : ''}</span><strong>{String(hour).padStart(2, '0')}:00</strong><span className="playback-status">{complete ? 'Finished' : running ? 'Running' : 'Paused'}</span></div>
    <div className="playback"><button className="play-button" disabled={disabled || complete} onClick={onToggle}><span aria-hidden="true">{running ? 'Ⅱ' : '▶'}</span> {running ? 'Pause' : started ? 'Play' : 'Start'}</button><div className="speed-controls" role="group" aria-label="Playback speed">{[0.5, 1, 2, 4].map(value => <button key={value} aria-pressed={speed === value} disabled={disabled} onClick={() => onSpeed(value)}>{value}×</button>)}</div></div>
  </section>;
}
