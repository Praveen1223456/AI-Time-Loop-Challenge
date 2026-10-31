import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { makeHarness } from '../apiHarness.js';
import { analyzeSolvability } from '../../src/services/solvabilityService.js';
import { fakeAi, validBlueprintJson, providerError, SESSION_A, SESSION_B } from '../helpers.js';

const BODY = { prompt: 'A museum will be robbed at midnight and I keep waking up an hour before it happens.', theme: 'mystery', difficulty: 'medium', loopLength: 'standard' };

describe('POST /scenarios (Gemini generation)', () => {
  it('creates a validated scenario and returns ONLY the public representation', async () => {
    const h = await makeHarness({ ai: fakeAi([validBlueprintJson()]) });
    const res = await h.as().post('/api/v1/scenarios', BODY);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ title: 'Generated: Nine Minutes to Darkness', theme: 'mystery', difficulty: 'medium' });
    expect(res.body.data.scenarioId).toBeTruthy();
    expect(Object.keys(res.body.data).sort()).toEqual(['difficulty', 'id', 'objective', 'premise', 'scenarioId', 'slug', 'theme', 'title']);
    expect(h.leaks).toEqual([]);
  });

  it('the generated scenario is playable to victory through the API, and nothing private leaks while playing', async () => {
    const h = await makeHarness({ ai: fakeAi([validBlueprintJson()]) });
    const { scenarioId } = (await h.as().post('/api/v1/scenarios', BODY)).body.data;
    const stored = await h.repos.scenarios.findById(scenarioId);
    const { plan } = await analyzeSolvability(stored);
    const game = await h.start(SESSION_A, scenarioId);
    expect(game.status).toBe('active');
    for (let i = 0; i < plan.length; i++) {
      await h.actAll(game.gameId, plan[i]);
      if (i < plan.length - 1) expect((await h.reset(game.gameId)).status).toBe(200);
    }
    const done = await h.get(game.gameId);
    expect(done.status).toBe('completed');
    expect(h.leaks).toEqual([]);
    const ending = await h.as().get(`/api/v1/games/${game.gameId}/ending`);
    expect(ending.status).toBe(200);
  });

  it('a generated scenario is private to the session that created it', async () => {
    const h = await makeHarness({ ai: fakeAi([validBlueprintJson()]) });
    const { scenarioId } = (await h.as(SESSION_A).post('/api/v1/scenarios', BODY)).body.data;
    expect((await h.as(SESSION_B).post('/api/v1/games', { scenarioId })).status).toBe(404);
    expect((await h.as(SESSION_A).post('/api/v1/games', { scenarioId })).status).toBe(201);
    const samples = (await request(h.app).get('/api/v1/scenarios/samples')).body.data;
    expect(samples.map((s) => s.id)).not.toContain(scenarioId); // only samples are listed publicly
  });

  it('validates input (FR-02: 30-1000 chars, enums, no extra fields) and requires a session', async () => {
    const h = await makeHarness({ ai: fakeAi([validBlueprintJson()]), rateLimits: { generation: { windowMs: 60000, limit: 100 } } });
    const bad = [
      { ...BODY, prompt: 'too short' }, { ...BODY, prompt: 'x'.repeat(1001) }, { ...BODY, prompt: '   ' + 'a'.repeat(20) + '   ' },
      { ...BODY, theme: 'cyberpunk' }, { ...BODY, difficulty: 'nightmare' }, { ...BODY, loopLength: 'forever' },
      { ...BODY, extra: true }, { ...BODY, prompt: undefined }, {},
    ];
    for (const body of bad) expect((await h.as().post('/api/v1/scenarios', body)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    expect((await request(h.app).post('/api/v1/scenarios').send(BODY)).body.error.code).toBe('SESSION_REQUIRED');
    expect((await h.as().post('/api/v1/scenarios', { ...BODY, prompt: 'a'.repeat(30) })).status).toBe(201); // boundary: exactly 30
  });

  it('returns 503 AI_NOT_CONFIGURED without Gemini, while the sample game still works', async () => {
    const h = await makeHarness({ ai: undefined });
    const res = await h.as().post('/api/v1/scenarios', BODY);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_NOT_CONFIGURED');
    expect((await h.start()).status).toBe('active');
    expect((await request(h.app).get('/api/v1/health')).body.data.ai).toEqual({ configured: false });
  });

  it('reports AI configuration in /health', async () => {
    const h = await makeHarness({ ai: fakeAi([validBlueprintJson()]) });
    expect((await request(h.app).get('/api/v1/health')).body.data.ai).toEqual({ configured: true });
  });

  it('malformed / invalid AI output -> 502 with a safe message, and NOTHING is stored', async () => {
    for (const output of ['{"broken', JSON.stringify({ title: 'x' }), validBlueprintJson((b) => { b.actions[0].effects = [{ type: 'nuke', all: true }]; })]) {
      const h = await makeHarness({ ai: fakeAi([output]) });
      const createSpy = vi.spyOn(h.repos.scenarios, 'create');
      const res = await h.as().post('/api/v1/scenarios', BODY);
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('SCENARIO_GENERATION_FAILED');
      expect(JSON.stringify(res.body)).not.toMatch(/nuke|broken|title/);
      expect(createSpy).not.toHaveBeenCalled();
    }
  });

  it('provider failures and timeouts -> 502 with classified code, no provider details', async () => {
    for (const code of ['AI_TIMEOUT', 'AI_PROVIDER_ERROR', 'AI_AUTH_ERROR', 'AI_REQUEST_REJECTED', 'AI_QUOTA_EXCEEDED']) {
      const retryable = !['AI_AUTH_ERROR', 'AI_REQUEST_REJECTED', 'AI_QUOTA_EXCEEDED'].includes(code);
      const h = await makeHarness({ ai: fakeAi([providerError(code, retryable)]) });
      const res = await h.as().post('/api/v1/scenarios', BODY);
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe(code);
    }
  });

  it('rejects a duplicate submission while one is generating (409)', async () => {
    let release; const gate = new Promise((r) => { release = r; });
    const h = await makeHarness({ ai: fakeAi([async () => { await gate; return validBlueprintJson(); }]) });
    const first = h.as().post('/api/v1/scenarios', BODY);
    await new Promise((r) => setTimeout(r, 30));
    const dup = await h.as().post('/api/v1/scenarios', BODY);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('GENERATION_IN_PROGRESS');
    release();
    expect((await first).status).toBe(201);
  });

  it('is rate limited per session (429), without affecting other sessions', async () => {
    const h = await makeHarness({ ai: fakeAi([validBlueprintJson()]), rateLimits: { generation: { windowMs: 60000, limit: 2 } } });
    expect((await h.as(SESSION_A).post('/api/v1/scenarios', BODY)).status).toBe(201);
    expect((await h.as(SESSION_A).post('/api/v1/scenarios', BODY)).status).toBe(201);
    const limited = await h.as(SESSION_A).post('/api/v1/scenarios', BODY);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect((await h.as(SESSION_B).post('/api/v1/scenarios', BODY)).status).toBe(201);
  });
});
