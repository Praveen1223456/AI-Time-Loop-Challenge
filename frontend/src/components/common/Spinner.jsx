export default function Spinner({ label = 'Loading' }) {
  return (
    <p role="status" className="flex items-center gap-2 text-slate-300">
      <span aria-hidden="true" className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-500 border-t-sky-300" />
      {label}…
    </p>
  );
}
