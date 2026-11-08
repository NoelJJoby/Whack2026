import { workdayTime, isOvertime } from '../shared/workday';
import { isFastForward, PLAYBACK_SPEEDS } from '../shared/playback';
export { workdayTime } from '../shared/workday';

export function Workday({ tick, calendarDay, speed, running, started, complete, disabled, onSpeed, onToggle }: {
  tick: number; calendarDay?: number; speed: number; running: boolean; started: boolean; complete: boolean; disabled: boolean;
  onSpeed: (speed: number) => void; onToggle: () => void;
}) {
  const { month, dayOfMonth, hour } = workdayTime(tick);
  const displayedDay = calendarDay ?? dayOfMonth;

  return <section className="clock-hud" aria-label="Time and playback">
    <div className="clock-readout"><span>M{month} · Day {displayedDay}{isOvertime(tick) ? ' · Overtime' : ''}</span><strong>{String(hour).padStart(2, '0')}:00</strong><span className="playback-status">{complete ? 'Finished' : running ? 'Running' : 'Paused'}</span></div>
    <div className="playback"><button className="play-button" disabled={disabled || complete} onClick={onToggle}><span aria-hidden="true">{running ? 'Ⅱ' : '▶'}</span> {running ? 'Pause' : started ? 'Play' : 'Start'}</button><div className="speed-controls" role="group" aria-label="Playback speed">{PLAYBACK_SPEEDS.map(value => <button key={value} aria-pressed={speed === value} disabled={disabled} title={isFastForward(value) ? 'Simulate a quarter in under two minutes using rules. Full history is retained; AI dialogue resumes at other speeds.' : undefined} onClick={() => onSpeed(value)}>{isFastForward(value) ? '2 min / quarter' : `${value}×`}</button>)}</div></div>
  </section>;
}
