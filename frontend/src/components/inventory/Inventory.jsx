import EmptyState from '../common/EmptyState.jsx';

export default function Inventory({ items }) {
  if (items.length === 0) return <EmptyState title="You are carrying nothing" />;
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-600 bg-slate-800/60 p-2 text-slate-100">
          <span>{i.name}</span>
          <span className="rounded-full border border-slate-500 px-2 py-0.5 text-xs text-slate-300">{i.persistent ? 'Kept across loops' : 'Resets each loop'}</span>
        </li>
      ))}
    </ul>
  );
}
