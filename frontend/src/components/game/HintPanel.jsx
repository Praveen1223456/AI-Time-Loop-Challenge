import Button from '../common/Button.jsx';

const LEVELS = [
  { level: 1, label: 'Hint 1: gentle nudge' },
  { level: 2, label: 'Hint 2: reconsider a clue' },
  { level: 3, label: 'Hint 3: next step' },
];

export default function HintPanel({ hints, used, busy, disabled, onHint }) {
  return (
    <section aria-labelledby="hints-heading">
      <h3 id="hints-heading" className="text-sm font-semibold text-slate-200">Need a hint?</h3>
      <p className="mt-1 text-xs text-slate-400">Hints only use what is already in the game. Using them is tracked.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {LEVELS.map(({ level, label }) => (
          <Button key={level} onClick={() => onHint(level)} disabled={busy || disabled}>{label}{used[level] ? ` (${used[level]})` : ''}</Button>
        ))}
      </div>
      <div aria-live="polite" className="mt-3 space-y-2">
        {LEVELS.filter(({ level }) => hints[level]).map(({ level }) => (
          <p key={level} className="rounded-md border border-sky-400/40 bg-sky-950/40 p-3 text-sm text-sky-50"><span className="font-semibold">Hint {level}:</span> {hints[level]}</p>
        ))}
      </div>
    </section>
  );
}
