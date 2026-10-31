import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createMemoryRepositories } from '../src/repositories/memoryRepositories.js';
import { validateBlueprint } from '../src/services/blueprintValidator.js';
import { sampleScenario } from '../src/data/sampleScenario.js';
import { SESSION_A, silentLogger } from './helpers.js';

export const PRIVATE_STRINGS = [
  'solutionGuide', 'causalChain', 'requiredClueIds', 'winConditions', 'failureConditions', 'prerequisites', 'loopFlags',
  "Reyes' firmware 2.3.1 update disabled", // text that exists only in the private causal chain
];

/** Full HTTP stack on in-memory repositories (no database), optionally with a scripted fake Gemini client. */
export async function makeHarness({ ai, rateLimits, generatorOptions = {}, repos = createMemoryRepositories(), env = loadEnv({ NODE_ENV: 'test' }) } = {}) {
  let sampleId = (await repos.scenarios.listSamples())[0]?.id;
  if (!sampleId) sampleId = (await repos.scenarios.upsertBySlug(validateBlueprint(sampleScenario), { isSample: true })).id;
  const build = () => createApp({ env, repositories: repos, getDbStatus: () => 'connected', ai, rateLimits, generatorOptions: { retryDelayMs: 0, logger: silentLogger, ...generatorOptions } });
  let app = build();
  const leaks = [];

  const call = async (req) => {
    const res = await req;
    const text = JSON.stringify(res.body);
    for (const secret of PRIVATE_STRINGS) if (text.includes(secret)) leaks.push(`${secret} in ${req.url}`);
    return res;
  };
  const as = (sessionId = SESSION_A) => ({
    get: (url) => call(request(app).get(url).set('X-Session-Id', sessionId)),
    post: (url, body) => call(request(app).post(url).set('X-Session-Id', sessionId).send(body)),
  });
  const start = async (sessionId = SESSION_A, scenarioId = sampleId) => (await as(sessionId).post('/api/v1/games', { scenarioId })).body.data;
  const act = (gameId, actionId, extra = {}, sessionId = SESSION_A) => as(sessionId).post(`/api/v1/games/${gameId}/actions`, { actionId, ...extra });
  const actAll = async (gameId, ids, sessionId = SESSION_A) => {
    for (const id of ids) { const r = await act(gameId, id, {}, sessionId); if (r.status !== 200) throw new Error(`${id}: ${r.status} ${JSON.stringify(r.body)}`); }
  };
  const reset = (gameId, sessionId = SESSION_A) => as(sessionId).post(`/api/v1/games/${gameId}/reset`, {});
  const get = async (gameId, sessionId = SESSION_A) => (await as(sessionId).get(`/api/v1/games/${gameId}`)).body.data;
  return { get app() { return app; }, repos, sampleId, as, start, act, actAll, reset, get, leaks, restart: () => { app = build(); return app; } };
}
