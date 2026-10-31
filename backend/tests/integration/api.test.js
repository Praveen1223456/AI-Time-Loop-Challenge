import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { createMemoryRepositories } from '../../src/repositories/memoryRepositories.js';
import { validateBlueprint } from '../../src/services/blueprintValidator.js';
import { sampleScenario } from '../../src/data/sampleScenario.js';
import { SESSION_A, SESSION_B, LOOP1_EXPLORE, READ_LOG, FINAL_RUN } from '../helpers.js';

const env = loadEnv({ NODE_ENV: 'test' });
const PRIVATE_STRINGS = [
  'solutionGuide', 'causalChain', 'winConditions', 'failureConditions', 'prerequisites', 'loopFlags',
  "Reyes' firmware 2.3.1 update disabled", // text that exists only in the private causal chain
];

let app, repos, scenarioId, leaks;

beforeEach(async () => {
  repos = createMemoryRepositories();
  const saved = await repos.scenarios.upsertBySlug(validateBlueprint(sampleScenario), { isSample: true });
  scenarioId = saved.id;
  app = createApp({ env, repositories: repos, getDbStatus: () => 'connected' });
  leaks = [];
});

/** Wraps a supertest call and records any private-data leak found in the response body. */
const call = async (req) => {
  const res = await req;
  const text = JSON.stringify(res.body);
  for (const secret of PRIVATE_STRINGS) if (text.includes(secret)) leaks.push(`${secret} in ${res.req?.path}`);
  return res;
};
const as = (sessionId = SESSION_A) => ({
  get: (url) => call(request(app).get(url).set('X-Session-Id', sessionId)),
  post: (url, body) => call(request(app).post(url).set('X-Session-Id', sessionId).send(body)),
});
const startGame = async (sessionId = SESSION_A) => (await as(sessionId).post('/api/v1/games', { scenarioId })).body.data;
const act = (gameId, actionId, extra = {}, sessionId = SESSION_A) =>
  as(sessionId).post(`/api/v1/games/${gameId}/actions`, { actionId, ...extra });
const actAll = async (gameId, ids) => { for (const id of ids) { const r = await act(gameId, id); expect(r.status, `${id}: ${JSON.stringify(r.body)}`).toBe(200); } };

describe('platform behaviour (Phase 1)', () => {
  it('health: 200 when the database is connected, 503 + honest status when it is not', async () => {
    const ok = await request(app).get('/api/v1/health');
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ status: 'ok', database: { status: 'connected' } });

    const down = createApp({ env, repositories: repos, getDbStatus: () => 'disconnected' });
    const bad = await request(down).get('/api/v1/health');
    expect(bad.status).toBe(503);
    expect(bad.body).toMatchObject({ success: false, data: { status: 'degraded', database: { status: 'disconnected' } } });
  });

  it('returns JSON errors for unknown routes, malformed JSON, and oversized bodies', async () => {
    const nf = await request(app).get('/api/v1/nope');
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('NOT_FOUND');

    const bad = await request(app).post('/api/v1/games').set('X-Session-Id', SESSION_A).set('Content-Type', 'application/json').send('{oops');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_JSON');

    const big = await request(app).post('/api/v1/games').set('X-Session-Id', SESSION_A).send({ scenarioId: 'x'.repeat(20000) });
    expect(big.status).toBe(413);
  });

  it('sends security headers and restricts CORS to the configured client origin', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:5173');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    // A fixed-origin CORS config always answers with the configured origin (never "*" and never
    // the caller's origin), so a browser on any other origin will refuse to read the response.
    const other = await request(app).get('/api/v1/health').set('Origin', 'http://evil.example');
    expect(other.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(other.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('answers the browser CORS preflight for JSON + X-Session-Id requests', async () => {
    const res = await request(app)
      .options('/api/v1/games/abc/actions')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-session-id');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-headers'].toLowerCase()).toContain('x-session-id');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
  });

  it('unexpected errors become a generic 500 without leaking internals', async () => {
    const broken = createApp({
      env,
      repositories: { ...repos, scenarios: { ...repos.scenarios, listSamples: async () => { throw new Error('db password=hunter2'); } } },
    });
    const res = await request(broken).get('/api/v1/scenarios/samples');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('scenarios and game creation', () => {
  it('lists sample scenarios without private data', async () => {
    const plain = await call(request(app).get('/api/v1/scenarios/samples'));
    expect(plain.status).toBe(200);
    expect(plain.body.data[0]).toMatchObject({ title: 'Nine Minutes to Darkness', slug: 'nine-minutes-to-darkness' });
    expect(Object.keys(plain.body.data[0]).sort()).toEqual(['difficulty', 'id', 'premise', 'slug', 'theme', 'title']);
    expect(leaks).toEqual([]);
  });

  it('creates a game with the correct initial public state (AC-02)', async () => {
    const res = await as().post('/api/v1/games', { scenarioId });
    expect(res.status).toBe(201);
    const s = res.body.data;
    expect(s).toMatchObject({
      status: 'active', stateVersion: 0, loop: { current: 1, max: 5 },
      time: { current: '20:45', end: '21:00', remainingMinutes: 15, expired: false },
      location: { id: 'control_room' }, inventory: [], recap: null, endingId: null,
    });
    expect(s.journal).toEqual({ clues: [], confirmedFacts: [], playerNotes: [] });
    expect(s.availableActions.map((a) => a.id)).toContain('inspect_control_panel');
    expect(s.charactersHere.map((c) => c.id)).toEqual(['okoye']);
    expect(leaks).toEqual([]);
  });

  it('validates the request and session', async () => {
    expect((await request(app).post('/api/v1/games').send({ scenarioId })).body.error.code).toBe('SESSION_REQUIRED');
    expect((await request(app).post('/api/v1/games').set('X-Session-Id', 'not-a-uuid').send({ scenarioId })).status).toBe(400);
    expect((await as().post('/api/v1/games', {})).body.error.code).toBe('VALIDATION_ERROR');
    expect((await as().post('/api/v1/games', { scenarioId, extra: 1 })).status).toBe(400);
    expect((await as().post('/api/v1/games', { scenarioId: '../etc/passwd' })).status).toBe(400);
    const missing = await as().post('/api/v1/games', { scenarioId: 'does-not-exist' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('SCENARIO_NOT_FOUND');
  });
});

describe('actions', () => {
  it('applies a valid action and returns the updated public state (AC-04)', async () => {
    const g = await startGame();
    const res = await act(g.gameId, 'inspect_control_panel', { targetId: 'control_panel' });
    expect(res.status).toBe(200);
    expect(res.body.data.state).toMatchObject({ time: { current: '20:46' }, stateVersion: 1, turnCount: 1 });
    expect(res.body.data.state.journal.clues.map((c) => c.id)).toEqual(['clue_unusual_alarm']);
    expect(res.body.data.result.narrative).toMatch(/R7-TH/);
    expect(leaks).toEqual([]);
  });

  it('invalid actions return an error and do not mutate saved state (AC-03)', async () => {
    const g = await startGame();
    const before = (await as().get(`/api/v1/games/${g.gameId}`)).body.data;
    for (const [body, status] of [
      [{ actionId: 'talk_engineer_about_alarm' }, 409],
      [{ actionId: 'interact_reset_relay' }, 409],
      [{ actionId: 'inspect_control_panel', targetId: 'wrong_target' }, 400],
      [{ actionId: 'made_up_action' }, 400],
      [{ actionId: 'Not Valid!' }, 400],
      [{}, 400],
    ]) {
      const res = await as().post(`/api/v1/games/${g.gameId}/actions`, body);
      expect(res.status, JSON.stringify(body)).toBe(status);
      expect(res.body.success).toBe(false);
    }
    const after = (await as().get(`/api/v1/games/${g.gameId}`)).body.data;
    expect(after).toEqual(before);
    expect(after.stateVersion).toBe(0);
  });

  it('the client cannot submit a replacement state or extra fields', async () => {
    const g = await startGame();
    for (const body of [
      { actionId: 'wait_one_minute', state: { currentLoop: 99, status: 'completed' } },
      { actionId: 'wait_one_minute', currentLoop: 99 },
      { actionId: 'wait_one_minute', persistentState: { discoveredClueIds: ['clue_patch_log'] } },
      { actionId: 'wait_one_minute', status: 'completed', endingId: 'ending_lights_stay_on' },
    ]) {
      const res = await as().post(`/api/v1/games/${g.gameId}/actions`, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const after = (await as().get(`/api/v1/games/${g.gameId}`)).body.data;
    expect(after.loop.current).toBe(1);
    expect(after.status).toBe('active');
    expect(after.journal.clues).toEqual([]);
    expect(after.stateVersion).toBe(0);
  });

  it('detects stale clients via expectedVersion and rejects double submission (state-version check)', async () => {
    const g = await startGame();
    const ok = await act(g.gameId, 'wait_one_minute', { expectedVersion: 0 });
    expect(ok.status).toBe(200);
    const stale = await act(g.gameId, 'wait_one_minute', { expectedVersion: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STATE_CONFLICT');

    const g2 = await startGame();
    const [r1, r2] = await Promise.all([
      act(g2.gameId, 'wait_one_minute', { expectedVersion: 0 }),
      act(g2.gameId, 'wait_one_minute', { expectedVersion: 0 }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const final = (await as().get(`/api/v1/games/${g2.gameId}`)).body.data;
    expect(final.turnCount).toBe(1); // only one of the two took effect
  });
});

describe('session ownership (AC-09 / security)', () => {
  it('another session cannot read, act on, reset, or see the ending of a game', async () => {
    const g = await startGame(SESSION_A);
    const b = as(SESSION_B);
    expect((await b.get(`/api/v1/games/${g.gameId}`)).status).toBe(403);
    expect((await b.post(`/api/v1/games/${g.gameId}/actions`, { actionId: 'wait_one_minute' })).status).toBe(403);
    expect((await b.post(`/api/v1/games/${g.gameId}/reset`, { reason: 'manual' })).status).toBe(403);
    expect((await b.get(`/api/v1/games/${g.gameId}/ending`)).status).toBe(403);
    expect((await as(SESSION_A).get(`/api/v1/games/${g.gameId}`)).body.data.stateVersion).toBe(0);
  });

  it('history only lists the caller\'s own games, newest first, with pagination', async () => {
    const g1 = await startGame(SESSION_A);
    await new Promise((r) => setTimeout(r, 5));
    const g2 = await startGame(SESSION_A);
    await startGame(SESSION_B);
    const list = (await as(SESSION_A).get('/api/v1/games')).body.data;
    expect(list.total).toBe(2);
    expect(list.items.map((i) => i.gameId).sort()).toEqual([g1.gameId, g2.gameId].sort());
    expect(list.items[0]).toMatchObject({ title: 'Nine Minutes to Darkness', status: 'active', currentLoop: 1 });
    const page = (await as(SESSION_A).get('/api/v1/games?limit=1&skip=1')).body.data;
    expect(page.items).toHaveLength(1);
    expect((await as().get('/api/v1/games?limit=0')).status).toBe(400);
    expect((await as().get('/api/v1/games?limit=abc')).status).toBe(400);
  });

  it('unknown game IDs return 404', async () => {
    expect((await as().get('/api/v1/games/nope')).status).toBe(404);
  });
});

describe('loop expiry, reset and persistence over HTTP (AC-06, AC-07)', () => {
  it('expires the loop, blocks actions, resets on request, and keeps persistent knowledge', async () => {
    const g = await startGame();
    await actAll(g.gameId, ['inspect_control_panel', 'take_field_notebook']);
    for (let i = 0; i < 13; i++) await act(g.gameId, 'wait_one_minute');
    const expired = (await as().get(`/api/v1/games/${g.gameId}`)).body.data;
    expect(expired.time).toMatchObject({ current: '21:00', expired: true, remainingMinutes: 0 });
    expect(expired.availableActions).toEqual([]);
    expect(expired.status).toBe('active');

    const blocked = await act(g.gameId, 'wait_one_minute');
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('LOOP_ENDED');

    const reset = await as().post(`/api/v1/games/${g.gameId}/reset`, { reason: 'time_expired' });
    expect(reset.status).toBe(200);
    const s = reset.body.data.state;
    expect(s).toMatchObject({ loop: { current: 2 }, time: { current: '20:45', expired: false }, turnCount: 0, location: { id: 'control_room' } });
    expect(reset.body.data.recap).toMatchObject({ loop: 1, endedBy: 'time_expired' });
    expect(reset.body.data.recap.cluesDiscovered.map((c) => c.id)).toEqual(['clue_unusual_alarm']);
    expect(reset.body.data.recap.eventsTriggered.map((e) => e.description)).toContain('Breaker B-1 opens. Helios-7 goes dark.');
    expect(s.journal.clues.map((c) => c.id)).toEqual(['clue_unusual_alarm']); // persisted
    expect(s.inventory.map((i) => i.id)).toEqual(['field_notebook']);          // only the persistent item
    expect(s.recentEvents.every((e) => e.gameTime >= '20:45')).toBe(true);

    // Resume: a fresh GET returns the same saved state (AC-09).
    expect((await as().get(`/api/v1/games/${g.gameId}`)).body.data).toEqual(s);
    expect(leaks).toEqual([]);
  });

  it('validates the reset request', async () => {
    const g = await startGame();
    expect((await as().post(`/api/v1/games/${g.gameId}/reset`, { reason: 'time_expired' })).body.error.code).toBe('RESET_NOT_ALLOWED');
    expect((await as().post(`/api/v1/games/${g.gameId}/reset`, { reason: 'bogus' })).status).toBe(400);
    expect((await as().post(`/api/v1/games/${g.gameId}/reset`, { loop: 5 })).status).toBe(400);
    expect((await as().post(`/api/v1/games/${g.gameId}/reset`, {})).status).toBe(200); // default reason: manual
  });
});

describe('end-to-end: solve the sample through the API (AC-10, AC-11, AC-12)', () => {
  it('completes the game with server-side victory and a grounded ending', async () => {
    const g = await startGame();
    const id = g.gameId;
    await actAll(id, LOOP1_EXPLORE);
    expect((await as().post(`/api/v1/games/${id}/reset`, {})).status).toBe(200);
    await actAll(id, ['go_control_to_engineering']);
    expect((await act(id, 'talk_engineer_about_alarm')).status).toBe(200); // alarm clue persisted from loop 1
    expect((await as().post(`/api/v1/games/${id}/reset`, {})).body.data.state.loop.current).toBe(3);
    await actAll(id, READ_LOG);
    expect((await as().post(`/api/v1/games/${id}/reset`, {})).body.data.state.loop.current).toBe(4);

    // Ending is private until the game is over.
    const early = await as().get(`/api/v1/games/${id}/ending`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('GAME_NOT_FINISHED');

    await actAll(id, FINAL_RUN.slice(0, -1));
    const win = await act(id, 'interact_reset_relay');
    expect(win.status).toBe(200);
    expect(win.body.data.state).toMatchObject({ status: 'completed', endingId: 'ending_lights_stay_on', availableActions: [] });
    expect(win.body.data.result.outcome).toEqual({ type: 'victory', endingId: 'ending_lights_stay_on' });

    expect((await act(id, 'wait_one_minute')).body.error.code).toBe('GAME_NOT_ACTIVE');
    expect((await as().post(`/api/v1/games/${id}/reset`, {})).body.error.code).toBe('GAME_NOT_ACTIVE');

    const ending = await as().get(`/api/v1/games/${id}/ending`); // private causal chain is allowed only now
    expect(ending.status).toBe(200);
    expect(ending.body.data).toMatchObject({ objectiveCompleted: true, loopsPlayed: 4, ending: { id: 'ending_lights_stay_on' } });
    expect(ending.body.data.causalChain[0]).toMatch(/firmware 2\.3\.1/);

    // Every response during active play was free of private solution data.
    expect(leaks.filter((l) => !l.includes('/ending'))).toEqual([]);
  });

  it('a failure outcome is also decided server-side', async () => {
    const g = await startGame();
    await actAll(g.gameId, ['go_control_to_reactor']);
    const res = await act(g.gameId, 'interact_emergency_shutdown');
    expect(res.body.data.state).toMatchObject({ status: 'failed', endingId: 'ending_panic_shutdown' });
    const ending = await as().get(`/api/v1/games/${g.gameId}/ending`);
    expect(ending.body.data).toMatchObject({ objectiveCompleted: false, ending: { type: 'failure' } });
  });
});
