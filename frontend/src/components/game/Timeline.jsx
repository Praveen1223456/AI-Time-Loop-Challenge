import EmptyState from '../common/EmptyState.jsx';

const SKIP = new Set(['action']);

export default function Timeline({ events }) {
  const shown = events.filter((e) => !SKIP.has(e.eventType));
  if (shown.length === 0) return <EmptyState title="Nothing notable yet in this loop" />;
  return (
    <ol className="space-y-2">
      {shown.map((e, i) => (
        <li key={i} className="flex gap-3 text-sm text-slate-200">
          <span className="w-12 shrink-0 font-mono text-slate-400">{e.gameTime}</span>
          <span>{e.description}</span>
        </li>
      ))}
    </ol>
  );
}
