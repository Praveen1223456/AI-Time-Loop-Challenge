import { useCallback, useEffect, useState } from 'react';
import { getHealth } from '../../services/api.js';

const COPY = {
  checking: { label: 'Checking…', tone: 'text-slate-300', dot: 'bg-slate-400' },
  ok: { label: 'Connected', tone: 'text-emerald-300', dot: 'bg-emerald-400' },
  degraded: { label: 'API reachable, database not connected', tone: 'text-amber-300', dot: 'bg-amber-400' },
  unreachable: { label: 'API unreachable', tone: 'text-rose-300', dot: 'bg-rose-400' },
};

/** Shows the real backend/database state. Never assumes success. */
export default function ApiStatus() {
  const [state, setState] = useState({ kind: 'checking', data: null });

  const check = useCallback(async (signal) => {
    setState({ kind: 'checking', data: null });
    try {
      const data = await getHealth({ signal });
      setState({ kind: data.status === 'ok' ? 'ok' : 'degraded', data });
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setState({ kind: 'unreachable', data: null });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    check(controller.signal);
    return () => controller.abort();
  }, [check]);

  const { label, tone, dot } = COPY[state.kind];
  return (
    <section aria-labelledby="api-status-heading" className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-5">
      <h2 id="api-status-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Backend status
      </h2>
      <p role="status" aria-live="polite" className={`mt-2 flex items-center gap-2 text-lg ${tone}`}>
        <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} />
        {label}
      </p>
      {state.data && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-slate-300">
          <dt className="text-slate-500">Environment</dt>
          <dd>{state.data.environment}</dd>
          <dt className="text-slate-500">Database</dt>
          <dd>{state.data.database.status}</dd>
        </dl>
      )}
      <button
        type="button"
        onClick={() => check()}
        disabled={state.kind === 'checking'}
        className="mt-4 rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Check again
      </button>
    </section>
  );
}
