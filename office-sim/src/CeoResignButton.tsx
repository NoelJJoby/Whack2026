// "CEO resign": a fun one-way button under the stock ticker. One click; the server then runs the
// collapse (cutscene, panic, resignations, end-of-quarter report).
import { useState } from 'react';

export function CeoResignButton({ disabled, onResign }: { disabled: boolean; onResign: () => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  const click = async () => {
    setBusy(true);
    try { await onResign(); } finally { setBusy(false); }
  };
  return <button className="ceo-resign" disabled={disabled || busy} onClick={() => void click()}
    title="The CEO walks out, the office panics, and everyone eventually resigns. Ends the run.">
    {busy ? 'Resigning…' : 'CEO resign'}
  </button>;
}
