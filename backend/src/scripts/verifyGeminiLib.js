/**
 * Dry-run verification of the REAL Gemini integration. Nothing is written to MongoDB: generated
 * scenarios go to a throwaway in-memory sink. Exported (with an injectable SDK) so the logic itself
 * is unit-tested; the CLI wrapper (verifyGemini.js) supplies the real @google/genai SDK.
 */
import { createGeminiClient } from '../services/geminiClient.js';
import { createScenarioGenerator } from '../services/scenarioGenerator.js';

const SAMPLE_PROMPT = 'A deep-sea research station floods at nine tonight and I must work out why before the loop resets.';

export async function runGeminiVerification({ env, sdk, prompt = SAMPLE_PROMPT, write = console.log }) {
  const steps = [];
  const record = (name, ok, detail) => { steps.push({ name, ok, detail }); write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); return ok; };

  const missing = ['GEMINI_API_KEY', 'GEMINI_MODEL'].filter((k) => !env[k]);
  if (missing.length) {
    record('configuration', false, `missing ${missing.join(', ')} in backend/.env`);
    return { ok: false, steps };
  }
  record('configuration', true, `model "${env.GEMINI_MODEL}", timeout ${env.GEMINI_TIMEOUT_MS}ms, max retries ${env.GEMINI_MAX_RETRIES}`);

  const logger = { info: () => {}, warn: (m) => write(`      ${m}`) };
  const ai = createGeminiClient({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, sdk, logger });

  // 1. Credentials, model name, network and JSON mode: the smallest possible request.
  try {
    const started = Date.now();
    const text = await ai.generateJson({
      system: 'Reply with JSON only.', prompt: 'Return {"ok": true}.', timeoutMs: env.GEMINI_TIMEOUT_MS,
      jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
    });
    record('connectivity + JSON mode', JSON.parse(text).ok === true, `${Date.now() - started}ms`);
  } catch (err) {
    record('connectivity + JSON mode', false, `${err.code ?? err.name}: ${err.message}`);
    write('      Check GEMINI_API_KEY, GEMINI_MODEL (use a current model id from Google AI docs), and network access.');
    return { ok: false, steps };
  }

  // 2. The full pipeline: prompt -> Gemini -> parse -> Zod -> semantic checks -> solver. No DB writes.
  const rejected = [];
  const sink = { create: async (blueprint) => ({ ...blueprint, id: 'dry-run' }) };
  const generator = createScenarioGenerator({
    ai, scenarios: sink, maxRetries: env.GEMINI_MAX_RETRIES, timeoutMs: env.GEMINI_TIMEOUT_MS, logger,
    onAttemptRejected: (r) => { rejected.push(r); write(`      attempt ${r.attempt}/${r.attempts} rejected:`); r.issues.slice(0, 8).forEach((i) => write(`        - ${i}`)); },
  });
  const started = Date.now();
  try {
    const saved = await generator.generate({ prompt, theme: 'sci-fi', difficulty: 'medium', loopLength: 'standard', sessionId: 'verify-script' });
    record('scenario generation + validation', true,
      `"${saved.title}": ${saved.locations.length} locations, ${saved.characters.length} characters, ${saved.clues.length} clues, ${saved.actions.length} actions; ${rejected.length} rejected attempt(s); ${Date.now() - started}ms`);
  } catch (err) {
    record('scenario generation + validation', false, `${err.code ?? err.name} after ${rejected.length} rejected attempt(s)`);
    write('      If every attempt is rejected for the same reason, that issue list shows what to adjust (see README: "Tuning generation").');
    return { ok: false, steps };
  }
  record('structured output (responseJsonSchema)', ai.structuredOutputSupported, ai.structuredOutputSupported ? 'accepted by the API' : 'rejected; fell back to schema-less JSON mode (still validated by Zod)');
  return { ok: steps.every((s) => s.ok), steps };
}
