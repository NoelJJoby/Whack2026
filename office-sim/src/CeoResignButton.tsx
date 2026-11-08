// "CEO resign": a fun one-way button under the stock ticker. The first click arms it, the second
// confirms; the server then runs the collapse (cutscene, panic, resignations, end-of-quarter report).
import { useEffect, useState } from 'react';

export function CeoResignButton({ disabled, onResign }: { disabled: boolean; onResign: () => Promise<boolean> }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(id);
  }, [armed]);
  const click = async () => {
    if (!armed) { setArmed(true); return; }
    setBusy(true); setArmed(false);
    try { await onResign(); } finally { setBusy(false); }
  };
  return <button className={`ceo-resign${armed ? ' armed' : ''}`} disabled={disabled || busy} onClick={() => void click()}
    title="The CEO walks out, the office panics, and everyone eventually resigns. Ends the run.">
    {busy ? 'Resigning…' : armed ? 'Click again to confirm' : 'CEO resign'}
  </button>;
}
