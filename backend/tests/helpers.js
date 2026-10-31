import { sampleScenario } from '../src/data/sampleScenario.js';
import { validateBlueprint } from '../src/services/blueprintValidator.js';
import { createInitialSession, performAction } from '../src/services/gameEngine.js';
import { resetLoop } from '../src/services/loopResetService.js';

export const NOW = new Date('2026-10-28T10:00:00.000Z');
export const SESSION_A = '11111111-1111-4111-8111-111111111111';
export const SESSION_B = '22222222-2222-4222-8222-222222222222';

export const blueprint = () => structuredClone(validateBlueprint(sampleScenario));

export const newSession = (bp = blueprint()) =>
  createInitialSession(bp, { sessionId: SESSION_A, scenarioId: 'scn-1', now: NOW });

/** Runs action IDs in order through the real engine; throws if any is rejected. */
export function play(bp, session, actionIds) {
  let s = session;
  for (const actionId of actionIds) s = performAction(bp, s, { actionId }, { now: NOW }).session;
  return s;
}

export const reset = (bp, s, reason = 'manual') => resetLoop(bp, s, { reason, now: NOW }).session;

export function expectRejected(fn, code, status) {
  let error;
  try { fn(); } catch (e) { error = e; }
  if (!error) throw new Error(`Expected rejection with ${code} but call succeeded`);
  if (error.code !== code) throw new Error(`Expected ${code} but got ${error.code}: ${error.message}`);
  if (status && error.status !== status) throw new Error(`Expected status ${status} but got ${error.status}`);
}

// Intended route pieces (see sampleScenario.js header)
export const LOOP1_EXPLORE = [
  'inspect_control_panel', 'inspect_status_board', 'talk_director', 'take_field_notebook',
  'go_control_to_reactor', 'inspect_relay_r7', 'inspect_thermal_gauge',
]; // 20:45 -> 20:55 (7 actions, cost 1+1+2+1+3+1+1 = 10)
export const GET_KEYCARD = ['go_control_to_engineering', 'talk_engineer_about_alarm']; // -> 20:49
export const READ_LOG = [...GET_KEYCARD, 'go_engineering_to_corridor', 'inspect_maintenance_log']; // -> 20:52
export const FINAL_RUN = [...GET_KEYCARD, 'go_engineering_to_reactor', 'interact_reset_relay']; // -> 20:54

// ---- Gemini mocking -------------------------------------------------------------------------
import { AppError } from '../src/utils/AppError.js';

/** What a well-behaved model would return (the sample is a valid, solvable blueprint). */
export const validBlueprintJson = (mutate) => {
  const bp = structuredClone(sampleScenario);
  bp.title = 'Generated: ' + bp.title;
  delete bp.slug;
  mutate?.(bp);
  return JSON.stringify(bp);
};

export const providerError = (code, retryable, status = 502) =>
  Object.assign(new AppError(status, code, 'provider failure'), { retryable });

/**
 * Scripted stand-in for the Gemini client. `responses` is consumed in order; an Error (or function)
 * entry is thrown/called. Records every request so tests can assert on prompts.
 */
export function fakeAi(responses) {
  const calls = [];
  const queue = [...responses];
  return {
    calls,
    async generateJson(req) {
      calls.push(req);
      const next = queue.length > 1 ? queue.shift() : queue[0];
      const value = typeof next === 'function' ? await next(req) : next;
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

export const silentLogger = { info() {}, warn() {}, error() {} };
