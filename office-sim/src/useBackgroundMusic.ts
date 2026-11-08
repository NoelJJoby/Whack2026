// Looping background music. Browsers block autoplay, so it starts on the first click or key press.
// The on/off choice is remembered per browser.
import { useEffect, useRef, useState } from 'react';

const SRC = '/sounds/background-music.mp3';
const VOLUME = 0.25;
const KEY = 'office-sim:music';

function stored(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function useBackgroundMusic() {
  const [enabled, setEnabled] = useState(stored);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const track = new Audio(SRC);
    track.loop = true;
    track.volume = VOLUME;
    audio.current = track;
    return () => { track.pause(); audio.current = null; };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch { /* storage unavailable */ }
    const track = audio.current;
    if (!track) return;
    if (!enabled) { track.pause(); return; }
    const start = () => { void track.play().catch(() => undefined); };
    start();
    // If autoplay was blocked, the first interaction starts it.
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
    return () => { window.removeEventListener('pointerdown', start); window.removeEventListener('keydown', start); };
  }, [enabled]);

  return { enabled, setEnabled };
}
