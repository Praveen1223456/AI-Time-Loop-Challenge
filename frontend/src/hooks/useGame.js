import { useCallback, useEffect, useRef, useState } from 'react';
import * as gameApi from '../services/gameApi.js';
import { errorMessage } from '../utils/errors.js';

/**
 * Owns one game's client state. The server is the source of truth: every mutation sends the last
 * seen `stateVersion`, and the response replaces local state wholesale.
 * Duplicate submissions are blocked with a ref (synchronous, so two rapid clicks cannot both pass).
 */
export function useGame(gameId) {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(null); // ApiError while loading
  const [actionError, setActionError] = useState(null); // string for the last failed mutation
  const [busy, setBusy] = useState(false);
  const [narration, setNarration] = useState([]);
  const [recap, setRecap] = useState(null);
  const [hints, setHints] = useState({});
  const busyRef = useRef(false);
  const versionRef = useRef(0);

  const apply = useCallback((next) => {
    versionRef.current = next.stateVersion;
    setState(next);
  }, []);

  const load = useCallback(async (signal) => {
    setLoadError(null);
    try {
      apply(await gameApi.getGame(gameId, { signal }));
    } catch (err) {
      if (err?.name !== 'AbortError') setLoadError(err);
    }
  }, [gameId, apply]);

  useEffect(() => {
    const controller = new AbortController();
    setState(null); setNarration([]); setRecap(null); setHints({}); setActionError(null);
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  /** Runs one mutation at a time. Returns the API result, or undefined if blocked/failed. */
  const run = useCallback(async (fn) => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    try {
      return await fn();
    } catch (err) {
      if (err?.name === 'AbortError') return undefined;
      setActionError(errorMessage(err));
      if (['STATE_CONFLICT', 'LOOP_ENDED', 'GAME_NOT_ACTIVE'].includes(err?.code)) {
        try { apply(await gameApi.getGame(gameId)); } catch { /* keep the error message */ }
      }
      return undefined;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [gameId, apply]);

  const perform = useCallback((action) => run(async () => {
    const res = await gameApi.performAction(gameId, { actionId: action.id, targetId: action.targetId, expectedVersion: versionRef.current });
    apply(res.state);
    setNarration((n) => [{ id: `${res.state.stateVersion}`, text: res.result.narrative, entries: res.result.entries, actionType: action.type }, ...n].slice(0, 6));
    return res;
  }), [gameId, run, apply]);

  const reset = useCallback(() => run(async () => {
    const res = await gameApi.resetLoop(gameId, { reason: 'manual', expectedVersion: versionRef.current });
    apply(res.state);
    setRecap(res.recap);
    setNarration([]);
    setHints({});
    return res;
  }), [gameId, run, apply]);

  const hint = useCallback((level) => run(async () => {
    const res = await gameApi.requestHint(gameId, level);
    apply(res.state);
    setHints((h) => ({ ...h, [level]: res.hint.text }));
    return res;
  }), [gameId, run, apply]);

  const addNote = useCallback((text) => run(async () => {
    const res = await gameApi.addNote(gameId, { text, expectedVersion: versionRef.current });
    apply(res.state);
    return res;
  }), [gameId, run, apply]);

  return {
    state, loadError, actionError, busy, narration, recap, hints,
    reload: () => load(), perform, reset, hint, addNote,
    dismissRecap: () => setRecap(null), clearError: () => setActionError(null),
  };
}
