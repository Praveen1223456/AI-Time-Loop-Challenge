import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as gameApi from '../services/gameApi.js';
import { errorMessage } from '../utils/errors.js';
import Spinner from '../components/common/Spinner.jsx';
import ErrorBanner from '../components/common/ErrorBanner.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';
import Button from '../components/common/Button.jsx';

const PAGE = 10;
const STATUS = { active: ['In progress', 'text-sky-200 border-sky-400/50'], completed: ['Won', 'text-emerald-200 border-emerald-400/50'], failed: ['Lost', 'text-rose-200 border-rose-400/50'] };

export default function HistoryPage() {
  usePageTitle('Game history');
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (skip, signal) => {
    try {
      const page = await gameApi.listGames({ limit: PAGE, skip }, { signal });
      setItems((prev) => (skip === 0 ? page.items : [...(prev ?? []), ...page.items]));
      setTotal(page.total); setError(null);
    } catch (e) { if (e?.name !== 'AbortError') setError(errorMessage(e)); }
  }, []);
  useEffect(() => { const c = new AbortController(); load(0, c.signal); return () => c.abort(); }, [load]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-bold text-white">Game history</h1>
      <div className="mt-6 space-y-4">
        {error && <ErrorBanner message={error} onRetry={() => load(items?.length ?? 0)} />}
        {!items && !error && <Spinner label="Loading your games" />}
        {items?.length === 0 && <EmptyState title="No games yet"><Link className="text-sky-300 underline" to="/">Start your first time loop</Link></EmptyState>}
        {items?.length > 0 && (
          <ul className="space-y-3">
            {items.map((g) => {
              const [label, tone] = STATUS[g.status] ?? [g.status, 'text-slate-200 border-slate-500'];
              return (
                <li key={g.gameId} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-900/70 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-white">{g.title ?? 'Unknown scenario'}</p>
                    <p className="text-sm text-slate-400">Loop {g.currentLoop} · last played {new Date(g.updatedAt).toLocaleString()}</p>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${tone}`}>{label}</span>
                  <Link className="rounded-md border border-slate-500 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-800" to={g.status === 'active' ? `/game/${g.gameId}` : `/game/${g.gameId}/ending`}>
                    {g.status === 'active' ? 'Resume' : 'View ending'}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {items && items.length < total && (
          <Button disabled={loadingMore} onClick={async () => { setLoadingMore(true); await load(items.length); setLoadingMore(false); }}>{loadingMore ? 'Loading…' : 'Load more'}</Button>
        )}
      </div>
    </div>
  );
}
