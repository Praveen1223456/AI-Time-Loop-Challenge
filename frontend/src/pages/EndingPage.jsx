import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as gameApi from '../services/gameApi.js';
import { errorMessage } from '../utils/errors.js';
import { usePageTitle } from '../hooks/usePageTitle.js';
import Spinner from '../components/common/Spinner.jsx';
import ErrorBanner from '../components/common/ErrorBanner.jsx';
import Button from '../components/common/Button.jsx';
import ClueCard from '../components/journal/ClueCard.jsx';

export default function EndingPage() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [ending, setEnding] = useState(null);
  const [error, setError] = useState(null);
  const [replayError, setReplayError] = useState(null);
  const [replaying, setReplaying] = useState(false);
  const replayLock = useRef(false);
  usePageTitle(ending ? ending.ending.title : 'Ending');

  const load = useCallback((signal) => {
    setError(null); setEnding(null);
    gameApi.getEnding(gameId, { signal }).then(setEnding).catch((e) => { if (e?.name !== 'AbortError') setError(e); });
  }, [gameId]);
  useEffect(() => { const c = new AbortController(); load(c.signal); return () => c.abort(); }, [load]);

  const replay = async () => {
    if (replayLock.current) return;
    replayLock.current = true; setReplaying(true); setReplayError(null);
    try { navigate(`/game/${(await gameApi.replayGame(gameId)).gameId}`); }
    catch (e) { setReplayError(errorMessage(e)); replayLock.current = false; setReplaying(false); }
  };

  if (error) {
    return (
      <div className="space-y-4">
        <ErrorBanner message={errorMessage(error)} onRetry={error.code === 'GAME_NOT_FINISHED' ? undefined : () => load()} />
        {error.code === 'GAME_NOT_FINISHED' && <Link className="text-sky-300 underline" to={`/game/${gameId}`}>Back to your game</Link>}
        <p><Link className="text-sky-300 underline" to="/history">Game history</Link></p>
      </div>
    );
  }
  if (!ending) return <Spinner label="Loading ending" />;

  const won = ending.objectiveCompleted;
  return (
    <article className="mx-auto max-w-3xl space-y-8">
      <header>
        <p className={`text-sm font-semibold uppercase tracking-wide ${won ? 'text-emerald-300' : 'text-rose-300'}`}>{won ? 'Victory' : 'Failure'}</p>
        <h1 className="mt-1 text-4xl font-bold text-white">{ending.ending.title}</h1>
        <p className="mt-4 text-lg text-slate-200">{ending.ending.narrative}</p>
        <p className="mt-4 rounded-lg bg-slate-800/70 p-3 text-slate-200" data-testid="summary">{ending.summary}</p>
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[['Objective', won ? 'Completed' : 'Not completed'], ['Loops played', ending.loopsPlayed], ['Clues found', ending.keyCluesDiscovered.length], ['Hints used', ending.hintsUsed.total]].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-slate-800/70 p-3 text-center"><dt className="text-xs uppercase tracking-wide text-slate-400">{k}</dt><dd className="text-lg font-semibold text-white">{v}</dd></div>
        ))}
      </dl>

      <section aria-labelledby="cause-heading">
        <h2 id="cause-heading" className="text-2xl font-semibold text-white">What really happened</h2>
        <ol className="mt-3 list-decimal space-y-1 pl-6 text-slate-200">{ending.causalChain.map((c) => <li key={c}>{c}</li>)}</ol>
      </section>

      {ending.decisions.length > 0 && (
        <section aria-labelledby="decisions-heading">
          <h2 id="decisions-heading" className="text-2xl font-semibold text-white">Your final loop</h2>
          <ol className="mt-3 space-y-1 text-slate-200">{ending.decisions.map((d, i) => <li key={i}><span className="font-mono text-slate-400">{d.gameTime}</span> {d.description}</li>)}</ol>
        </section>
      )}

      <section aria-labelledby="found-heading">
        <h2 id="found-heading" className="text-2xl font-semibold text-white">Clues you found</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">{ending.keyCluesDiscovered.length ? ending.keyCluesDiscovered.map((c) => <ClueCard key={c.id} headingLevel={3} clue={{ ...c, persistent: true }} />) : <p className="text-slate-400">None.</p>}</div>
      </section>
      {ending.missedClues.length > 0 && (
        <section aria-labelledby="missed-heading">
          <h2 id="missed-heading" className="text-2xl font-semibold text-white">Clues you missed</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">{ending.missedClues.map((c) => <ClueCard key={c.id} headingLevel={3} clue={{ ...c, persistent: true }} />)}</div>
        </section>
      )}

      <section aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" className="text-2xl font-semibold text-white">Timeline</h2>
        <ol className="mt-3 space-y-1 text-sm text-slate-300">{ending.timeline.map((t, i) => <li key={i}><span className="font-mono text-slate-400">L{t.loop} {t.gameTime}</span> {t.description}</li>)}</ol>
      </section>

      <div className="space-y-3 border-t border-slate-800 pt-6">
        <ErrorBanner message={replayError} onDismiss={() => setReplayError(null)} />
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={replay} disabled={replaying}>{replaying ? 'Starting…' : 'Play again'}</Button>
          <Link to="/history" className="rounded-md border border-slate-500 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800">Game history</Link>
          <Link to="/create" className="rounded-md border border-slate-500 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800">New scenario</Link>
        </div>
      </div>
    </article>
  );
}
