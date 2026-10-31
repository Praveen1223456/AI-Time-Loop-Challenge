import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as gameApi from '../services/gameApi.js';
import { getHealth } from '../services/api.js';
import { errorMessage } from '../utils/errors.js';
import { usePageTitle } from '../hooks/usePageTitle.js';
import Button from '../components/common/Button.jsx';
import ErrorBanner from '../components/common/ErrorBanner.jsx';

const THEMES = [['sci-fi', 'Sci-Fi'], ['mystery', 'Mystery'], ['fantasy', 'Fantasy'], ['disaster', 'Disaster'], ['historical', 'Historical Fiction'], ['custom', 'Custom']];
const DIFFICULTIES = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];
const LOOPS = [['short', 'Short (10 minutes per loop)'], ['standard', 'Standard (15 minutes per loop)'], ['long', 'Long (20 minutes per loop)']];
export const PROMPT_MIN = 30;
export const PROMPT_MAX = 1000;

const field = 'mt-1 w-full rounded-md border border-slate-600 bg-slate-950 p-2 text-slate-100';

export default function CreateScenarioPage() {
  usePageTitle('Create a scenario');
  const navigate = useNavigate();
  const [form, setForm] = useState({ prompt: '', theme: 'sci-fi', difficulty: 'medium', loopLength: 'standard' });
  const [touched, setTouched] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | generating | starting
  const [error, setError] = useState(null);
  const [aiConfigured, setAiConfigured] = useState(null); // null = unknown
  const submitting = useRef(false);
  const controller = useRef(null);

  useEffect(() => {
    const c = new AbortController();
    getHealth({ signal: c.signal }).then((h) => setAiConfigured(h.ai?.configured ?? null)).catch(() => {});
    return () => { c.abort(); controller.current?.abort(); };
  }, []);

  const length = form.prompt.trim().length;
  const promptError = length < PROMPT_MIN ? `Describe your idea in at least ${PROMPT_MIN} characters (${length} so far).`
    : length > PROMPT_MAX ? `Please keep it under ${PROMPT_MAX} characters.` : null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const busy = phase !== 'idle';

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (promptError || submitting.current) return; // validation + no duplicate submissions
    submitting.current = true; setError(null); setPhase('generating');
    controller.current = new AbortController();
    try {
      const scenario = await gameApi.createScenario({ ...form, prompt: form.prompt.trim() }, { signal: controller.current.signal });
      setPhase('starting');
      const game = await gameApi.startGame(scenario.scenarioId, { signal: controller.current.signal });
      navigate(`/game/${game.gameId}`);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setError(errorMessage(err)); setPhase('idle'); submitting.current = false;
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-bold text-white">Create a scenario</h1>
      <p className="mt-2 text-slate-300">Describe a time-loop story. The AI writes it; the game rules keep it fair and solvable.</p>
      {aiConfigured === false && (
        <p role="note" className="mt-4 rounded-lg border border-amber-400/50 bg-amber-950/40 p-3 text-amber-100">Scenario generation is not configured on this server. You can still play the sample scenarios from the home page.</p>
      )}
      <form onSubmit={submit} noValidate className="mt-6 space-y-5" aria-busy={busy}>
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
        <div>
          <label htmlFor="prompt" className="block font-medium text-slate-100">Your idea</label>
          <textarea
            id="prompt" rows={5} value={form.prompt} onChange={set('prompt')} disabled={busy}
            aria-describedby="prompt-help" aria-invalid={touched && promptError ? 'true' : 'false'} className={field}
            placeholder="A museum will be robbed at midnight, and I keep waking up an hour before it happens…"
          />
          <p id="prompt-help" className="mt-1 flex justify-between text-sm">
            <span className={touched && promptError ? 'text-rose-300' : 'text-slate-400'}>{touched && promptError ? promptError : `${PROMPT_MIN}-${PROMPT_MAX} characters.`}</span>
            <span className="text-slate-400">{length}/{PROMPT_MAX}</span>
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="theme" className="block font-medium text-slate-100">Theme</label>
            <select id="theme" value={form.theme} onChange={set('theme')} disabled={busy} className={field}>{THEMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </div>
          <div>
            <label htmlFor="difficulty" className="block font-medium text-slate-100">Difficulty</label>
            <select id="difficulty" value={form.difficulty} onChange={set('difficulty')} disabled={busy} className={field}>{DIFFICULTIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </div>
          <div>
            <label htmlFor="loopLength" className="block font-medium text-slate-100">Loop length</label>
            <select id="loopLength" value={form.loopLength} onChange={set('loopLength')} disabled={busy} className={field}>{LOOPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Button type="submit" variant="primary" disabled={busy || aiConfigured === false}>{busy ? 'Working…' : 'Generate and play'}</Button>
          {busy && (
            <p role="status" className="text-slate-300">
              {phase === 'generating' ? 'Writing and checking your scenario. This can take up to a minute…' : 'Starting your game…'}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
