import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as gameApi from '../services/gameApi.js';
import { errorMessage } from '../utils/errors.js';
import Button from '../components/common/Button.jsx';
import Spinner from '../components/common/Spinner.jsx';
import ErrorBanner from '../components/common/ErrorBanner.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';
import ApiStatus from '../components/common/ApiStatus.jsx';

export default function HomePage() {
  usePageTitle('Break the loop');
  const navigate = useNavigate();
  const [samples, setSamples] = useState(null);
  const [error, setError] = useState(null);
  const [startingId, setStartingId] = useState(null);
  const [startError, setStartError] = useState(null);
  const starting = useRef(false);

  const load = useCallback((signal) => {
    setError(null); setSamples(null);
    gameApi.listSamples({ signal }).then(setSamples).catch((e) => { if (e?.name !== 'AbortError') setError(errorMessage(e)); });
  }, []);
  useEffect(() => { const c = new AbortController(); load(c.signal); return () => c.abort(); }, [load]);

  const play = async (scenario) => {
    if (starting.current) return; // no duplicate game creation on double-click
    starting.current = true; setStartingId(scenario.id); setStartError(null);
    try {
      const game = await gameApi.startGame(scenario.id);
      navigate(`/game/${game.gameId}`);
    } catch (e) {
      setStartError(errorMessage(e));
      starting.current = false; setStartingId(null);
    }
  };

  return (
    <div className="space-y-10">
      <section className="py-4">
        <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">Break the loop.</h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-300">
          You are trapped in a repeating stretch of time. The world resets every loop, but you keep what you learn. Use it to uncover why disaster strikes, and stop it.
        </p>
        <Link to="/create" className="mt-6 inline-block rounded-md bg-sky-400 px-5 py-3 font-semibold text-slate-950 hover:bg-sky-300">Start a Time Loop</Link>
      </section>

      <section aria-labelledby="samples-heading">
        <h2 id="samples-heading" className="text-2xl font-semibold text-white">Sample scenarios</h2>
        <div className="mt-4 space-y-3">
          <ErrorBanner message={startError} onDismiss={() => setStartError(null)} />
          {error && <ErrorBanner message={error} onRetry={() => load()} />}
          {!samples && !error && <Spinner label="Loading scenarios" />}
          {samples?.length === 0 && <EmptyState title="No sample scenarios found">The server has not been seeded yet. Run <code>npm run seed</code> in the project root.</EmptyState>}
          {samples?.length > 0 && (
            <ul className="grid gap-4 sm:grid-cols-2">
              {samples.map((s) => (
                <li key={s.id} className="flex flex-col rounded-xl border border-slate-700/60 bg-slate-900/70 p-5">
                  <h3 className="text-lg font-semibold text-white">{s.title}</h3>
                  <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">{s.theme} · {s.difficulty}</p>
                  <p className="mt-2 flex-1 text-sm text-slate-300">{s.premise}</p>
                  <Button variant="primary" className="mt-4 self-start" onClick={() => play(s)} disabled={startingId !== null}>
                    {startingId === s.id ? 'Starting…' : 'Play this scenario'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="how-heading">
        <h2 id="how-heading" className="text-2xl font-semibold text-white">How to play</h2>
        <ol className="mt-4 grid list-decimal gap-3 pl-6 text-slate-300 sm:grid-cols-2">
          <li>Every action costs minutes. When the clock runs out, the loop resets.</li>
          <li>Inspect, talk and travel to gather clues. Clues, facts and unlocks are remembered.</li>
          <li>Items and the state of the world reset each loop, so plan your route.</li>
          <li>Use what you learned to reach places and options that were closed to you before.</li>
          <li>Stuck? Hints are available, built only from what the game already contains.</li>
          <li>The server decides the outcome. Win by stopping the disaster, or run out of loops.</li>
        </ol>
      </section>
      <ApiStatus />
    </div>
  );
}
