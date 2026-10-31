export default function EmptyState({ title, children }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-600 p-6 text-center">
      <p className="font-medium text-slate-200">{title}</p>
      {children && <div className="mt-2 text-sm text-slate-400">{children}</div>}
    </div>
  );
}
