import { useState } from 'react';
import Button from '../common/Button.jsx';

export default function LoopControls({ state, busy, onReset }) {
  const [confirming, setConfirming] = useState(false);
  if (state.status !== 'active') return null;
  const expired = state.time.expired;
  const next = state.loop.current < state.loop.max ? state.loop.current + 1 : null;
  const label = expired ? (next ? `Start loop ${next}` : 'Accept the outcome') : 'Reset the loop';

  if (expired) {
    return (
      <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-400/50 bg-amber-950/40 p-4">
        <p className="flex-1 text-amber-100">Time has run out. The world snaps back.</p>
        <Button variant="primary" onClick={() => onReset()} disabled={busy}>{label}</Button>
      </div>
    );
  }
  return confirming ? (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-600 p-3">
      <p className="flex-1 text-sm text-slate-200">End this loop now? Temporary progress is lost; knowledge stays.</p>
      <Button variant="danger" disabled={busy} onClick={async () => { await onReset(); setConfirming(false); }}>Yes, reset</Button>
      <Button onClick={() => setConfirming(false)}>Keep playing</Button>
    </div>
  ) : (
    <Button onClick={() => setConfirming(true)} disabled={busy}>{label}</Button>
  );
}
