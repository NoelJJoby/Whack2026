// One-shot sound effects. While an effect plays, background music steps aside: it pauses on
// `office-sim:sfx-start` and resumes (at its own normal volume) on `office-sim:sfx-end`.
export const SFX_START = 'office-sim:sfx-start';
export const SFX_END = 'office-sim:sfx-end';

/** The "CEO RESIGNS" headline sting, played at full volume. */
export function playCeoResignSting(): void {
  const sting = new Audio('/sounds/ceo-resign-sting.mp3');
  sting.volume = 1;
  let done = false;
  const finish = () => { if (done) return; done = true; window.dispatchEvent(new Event(SFX_END)); };
  sting.addEventListener('ended', finish);
  sting.addEventListener('error', finish);
  window.dispatchEvent(new Event(SFX_START));
  void sting.play().catch(finish);
}
