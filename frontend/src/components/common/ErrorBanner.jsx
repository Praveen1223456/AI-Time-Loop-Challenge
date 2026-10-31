export default function ErrorBanner({ message, onRetry, onDismiss }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-rose-500/50 bg-rose-950/60 px-4 py-3 text-rose-100">
      <p className="flex-1">{message}</p>
      {onRetry && <button type="button" onClick={onRetry} className="rounded-md border border-rose-300/60 px-3 py-1 text-sm hover:bg-rose-900">Try again</button>}
      {onDismiss && <button type="button" onClick={onDismiss} className="rounded-md border border-rose-300/60 px-3 py-1 text-sm hover:bg-rose-900">Dismiss</button>}
    </div>
  );
}
