export default function GameHeader({ state }) {
  const { scenario, loop, time } = state;
  const total = Math.max(1, time.length);
  const used = Math.min(100, Math.max(0, Math.round(((total - time.remainingMinutes) / total) * 100)));
  return (
    <header aria-label="Game status" className="rounded-xl border border-slate-700/60 bg-slate-900/70 p-4">
      <p className="text-sm text-slate-400">{scenario.title}</p>
      <p className="mt-1 text-slate-200">
        <span className="font-semibold text-sky-200">Objective:</span> {scenario.objective}
      </p>
      <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-slate-800/70 p-2">
          <dt className="text-xs uppercase tracking-wide text-slate-400">Loop</dt>
          <dd className="text-xl font-semibold text-white" data-testid="loop-indicator">{loop.current} <span className="text-sm font-normal text-slate-400">of {loop.max}</span></dd>
        </div>
        <div className="rounded-lg bg-slate-800/70 p-2">
          <dt className="text-xs uppercase tracking-wide text-slate-400">Clock</dt>
          <dd className="text-xl font-semibold text-white" data-testid="clock">{time.current}</dd>
        </div>
        <div className="rounded-lg bg-slate-800/70 p-2">
          <dt className="text-xs uppercase tracking-wide text-slate-400">Time left</dt>
          <dd className={`text-xl font-semibold ${time.remainingMinutes <= 3 ? 'text-amber-300' : 'text-white'}`} data-testid="remaining">{time.remainingMinutes} min</dd>
        </div>
      </dl>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-label="Loop time used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={used}>
        <div className={`h-full ${time.expired ? 'bg-rose-400' : 'bg-sky-400'}`} style={{ width: `${used}%` }} />
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        Loop {loop.current} of {loop.max}. Clock {time.current}. {time.remainingMinutes} minutes left.{time.expired ? ' Time has run out.' : ''}
      </p>
    </header>
  );
}
