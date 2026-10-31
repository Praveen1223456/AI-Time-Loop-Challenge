/**
 * Audit regression suite: adversarial and invariant tests added during the spec audit.
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { makeHarness, PRIVATE_STRINGS } from '../apiHarness.js';
import { fakeAi, validBlueprintJson, SESSION_A, SESSION_B } from '../helpers.js';
import { sampleScenario } from '../../src/data/sampleScenario.js';

// Deterministic PRNG so failures are reproducible.
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

describe('fuzz: random play through the HTTP API', () => {
  for (const seed of [1, 2, 3, 7, 42]) {
    it(`seed ${seed}: invariants hold, every offered action is accepted, nothing private leaks`, async () => {
      const h = await makeHarness();
      const rand = rng(seed);
      const g = await h.start();
      const allClueDescriptions = sampleScenario.clues.map((c) => ({ id: c.id, text: c.description }));
      let prev = await h.get(g.gameId);
      let steps = 0;
      while (steps++ < 150) {
        const cur = await h.get(g.gameId);
        if (cur.status !== 'active') break;
        // Only clues the player has discovered may appear anywhere in the state they receive.
        const known = new Set(cur.journal.clues.map((c) => c.id));
        const serialized = JSON.stringify(cur);
        for (const c of allClueDescriptions) if (!known.has(c.id)) expect(serialized, `undiscovered clue ${c.id} leaked`).not.toContain(c.text);

        const roll = rand();
        let res;
        if (cur.time.expired || roll < 0.08) res = await h.reset(g.gameId);
        else if (roll < 0.14) res = await h.as().post(`/api/v1/games/${g.gameId}/hints`, { level: 1 + Math.floor(rand() * 3) });
        else {
          const options = cur.availableActions.filter((a) => a.affordable);
          if (!options.length) { res = await h.reset(g.gameId); }
          else {
            const pick = options[Math.floor(rand() * options.length)];
            res = await h.act(g.gameId, pick.id);
            expect(res.status, `offered+affordable action ${pick.id} was rejected: ${JSON.stringify(res.body)}`).toBe(200);
          }
        }
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const next = res.body.data.state;

        // invariants
        expect(next.loop.current).toBeGreaterThanOrEqual(prev.loop.current);
        expect(next.stateVersion).toBeGreaterThan(prev.stateVersion);
        if (next.loop.current === prev.loop.current) expect(next.time.current >= prev.time.current).toBe(true);
        else expect(next.time.current).toBe('20:45');
        expect(new Set(next.journal.clues.filter((c) => c.persistent).map((c) => c.id)).size)
          .toBeGreaterThanOrEqual(prev.journal.clues.filter((c) => c.persistent).length); // knowledge is never lost
        expect(next.journal.playerNotes.length).toBeGreaterThanOrEqual(prev.journal.playerNotes.length);
        prev = next;
      }
      expect(h.leaks).toEqual([]);
    });
  }
});

describe('hostile requests', () => {
  it('rejects prototype-pollution, NoSQL-operator, array and wrong-typed payloads without side effects', async () => {
    const h = await makeHarness();
    const g = await h.start();
    const before = await h.get(g.gameId);
    const post = (url, raw) => request(h.app).post(url).set('X-Session-Id', SESSION_A).set('Content-Type', 'application/json').send(raw);
    const bodies = [
      '{"actionId":"wait_one_minute","__proto__":{"isAdmin":true}}',
      '{"actionId":{"$ne":null}}', '{"actionId":["wait_one_minute"]}', '["wait_one_minute"]', 'null', '"wait_one_minute"', '123',
      '{"actionId":"wait_one_minute","constructor":{"prototype":{"x":1}}}',
      '{"actionId":"wait_one_minute","expectedVersion":-1}', '{"actionId":"wait_one_minute","expectedVersion":"0"}', '{"actionId":"wait_one_minute","expectedVersion":1e999}',
    ];
    for (const raw of bodies) {
      const res = await post(`/api/v1/games/${g.gameId}/actions`, raw);
      expect([400, 409], `${raw} -> ${res.status}`).toContain(res.status); // 409 only for a stale-but-valid version
      expect(res.body.success).toBe(false);
    }
    expect(({}).isAdmin).toBeUndefined();
    expect(await h.get(g.gameId)).toEqual(before);
  });

  it('rejects NoSQL operators and traversal in ids and query strings', async () => {
    const h = await makeHarness();
    const a = h.as();
    expect((await a.post('/api/v1/games', { scenarioId: { $ne: null } })).status).toBe(400);
    expect((await a.post('/api/v1/games', { scenarioId: ['x'] })).status).toBe(400);
    for (const id of ['..%2F..%2Fetc%2Fpasswd', '%24where', 'a'.repeat(65), 'a%20b']) {
      const r = await request(h.app).get(`/api/v1/games/${id}`).set('X-Session-Id', SESSION_A);
      expect([400, 404], id).toContain(r.status);
    }
    for (const q of ['limit=1&limit=2', 'skip=-1', 'skip=1e9', 'limit=NaN', 'limit=', 'limit=0x10', 'limit=1e1', 'limit=1.5', 'limit=%20', 'limit=0', 'limit=51', 'skip=10001']) {
      expect((await request(h.app).get(`/api/v1/games?${q}`).set('X-Session-Id', SESSION_A)).status, q).toBe(400);
    }
    // Operator-style keys are just unknown parameters: ignored, never interpreted as query operators.
    const op = await request(h.app).get('/api/v1/games?limit[$gt]=1&foo=bar').set('X-Session-Id', SESSION_A);
    expect(op.status).toBe(200);
    expect(op.body.data).toMatchObject({ limit: 20, skip: 0 });
  });

  it('rejects malformed or duplicated session headers', async () => {
    const h = await makeHarness();
    for (const v of ['', 'x', '11111111-1111-4111-8111-11111111111', `${SESSION_A}, ${SESSION_B}`, `${SESSION_A}x`]) {
      expect((await request(h.app).get('/api/v1/games').set('X-Session-Id', v)).status, JSON.stringify(v)).toBe(400);
    }
  });

  it('unsupported methods and content types get JSON errors, not stack traces', async () => {
    const h = await makeHarness();
    const g = await h.start();
    for (const m of ['put', 'delete', 'patch']) {
      const r = await request(h.app)[m](`/api/v1/games/${g.gameId}`).set('X-Session-Id', SESSION_A);
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('NOT_FOUND');
    }
    const txt = await request(h.app).post(`/api/v1/games/${g.gameId}/actions`).set('X-Session-Id', SESSION_A).set('Content-Type', 'text/plain').send('actionId=wait_one_minute');
    expect(txt.status).toBe(400);
    expect(JSON.stringify(txt.body)).not.toMatch(/at \w+ \(|node_modules/);
  });

  it('validation errors never echo submitted values', async () => {
    const h = await makeHarness();
    const secret = 'TOP-SECRET-VALUE-123';
    const r = await h.as().post('/api/v1/games', { scenarioId: secret + '!!', extra: secret });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toContain(secret);
  });
});

describe('database failures', () => {
  it('a failing save returns a generic 500, leaks no connection details, and does NOT advance the game', async () => {
    const h = await makeHarness();
    const g = await h.start();
    const before = await h.get(g.gameId);
    const original = h.repos.games.save;
    h.repos.games.save = async () => { throw new Error('connection lost to mongodb://admin:hunter2@db.internal:27017'); };
    for (const res of [await h.act(g.gameId, 'inspect_control_panel'), await h.reset(g.gameId), await h.as().post(`/api/v1/games/${g.gameId}/hints`, { level: 1 }), await h.as().post(`/api/v1/games/${g.gameId}/notes`, { text: 'x' })]) {
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(res.body)).not.toMatch(/hunter2|mongodb|internal/);
    }
    h.repos.games.save = original;
    expect(await h.get(g.gameId)).toEqual(before); // nothing was partially applied
    expect((await h.act(g.gameId, 'inspect_control_panel')).status).toBe(200); // and the game is still playable
  });

  it('a failing read returns 500 (not a hang or a crash), and recovery works', async () => {
    const h = await makeHarness();
    const g = await h.start();
    const original = h.repos.games.findById;
    h.repos.games.findById = async () => { throw new Error('ECONNRESET'); };
    expect((await h.as().get(`/api/v1/games/${g.gameId}`)).status).toBe(500);
    expect((await h.as().get('/api/v1/health')).status).toBe(200); // the process itself is fine
    h.repos.games.findById = original;
    expect((await h.as().get(`/api/v1/games/${g.gameId}`)).status).toBe(200);
  });

  it('a failing scenario write during generation -> 500, the generation lock is released, retry works', async () => {
    const ai = fakeAi([validBlueprintJson()]);
    const h = await makeHarness({ ai, rateLimits: { generation: { windowMs: 60000, limit: 100 } } });
    const body = { prompt: 'A museum will be robbed at midnight and I keep waking up early.', theme: 'mystery', difficulty: 'medium', loopLength: 'standard' };
    const original = h.repos.scenarios.create;
    h.repos.scenarios.create = async () => { throw new Error('write failed'); };
    expect((await h.as().post('/api/v1/scenarios', body)).status).toBe(500);
    h.repos.scenarios.create = original;
    expect((await h.as().post('/api/v1/scenarios', body)).status).toBe(201);
  });

  it('health reports a dropped database as 503 degraded', async () => {
    const h = await makeHarness();
    const { createApp } = await import('../../src/app.js');
    const { loadEnv } = await import('../../src/config/env.js');
    const app = createApp({ env: loadEnv({ NODE_ENV: 'test' }), repositories: h.repos, getDbStatus: () => 'disconnected' });
    const r = await request(app).get('/api/v1/health');
    expect(r.status).toBe(503);
    expect(r.body.data.database.status).toBe('disconnected');
  });
});

describe('concurrent and conflicting updates', () => {
  it('parallel actions without expectedVersion never corrupt state: turnCount equals the number of successes', async () => {
    const h = await makeHarness();
    const g = await h.start();
    const results = await Promise.all(Array.from({ length: 8 }, () => h.act(g.gameId, 'wait_one_minute')));
    const ok = results.filter((r) => r.status === 200).length;
    const conflicts = results.filter((r) => r.status === 409);
    expect(ok + conflicts.length).toBe(8);
    expect(ok).toBeGreaterThanOrEqual(1);
    for (const c of conflicts) expect(['STATE_CONFLICT', 'LOOP_ENDED', 'INSUFFICIENT_TIME']).toContain(c.body.error.code);
    const final = await h.get(g.gameId);
    expect(final.turnCount).toBe(ok);
    expect(final.stateVersion).toBe(ok);
    expect(final.time.current).toBe(`20:${45 + ok}`);
  });

  it('a hint racing with an action leaves both consistent (hint retries once on conflict)', async () => {
    const h = await makeHarness();
    const g = await h.start();
    const [a, hint] = await Promise.all([h.act(g.gameId, 'inspect_control_panel'), h.as().post(`/api/v1/games/${g.gameId}/hints`, { level: 1 })]);
    expect(a.status).toBe(200);
    expect([200, 409]).toContain(hint.status);
    const final = await h.get(g.gameId);
    expect(final.journal.clues.map((c) => c.id)).toEqual(['clue_unusual_alarm']);
    expect(final.hints.used[1]).toBe(hint.status === 200 ? 1 : 0);
  });

  it('two tabs: the stale tab gets a conflict, refreshes, and succeeds with the new version', async () => {
    const h = await makeHarness();
    const g = await h.start();
    await h.act(g.gameId, 'wait_one_minute', { expectedVersion: 0 });             // tab A
    const stale = await h.act(g.gameId, 'wait_one_minute', { expectedVersion: 0 }); // tab B, stale
    expect(stale.body.error.code).toBe('STATE_CONFLICT');
    const fresh = await h.get(g.gameId);
    expect((await h.act(g.gameId, 'wait_one_minute', { expectedVersion: fresh.stateVersion })).status).toBe(200);
  });

  it('double reset (double-click) does not skip a loop', async () => {
    const h = await makeHarness();
    const g = await h.start();
    const [r1, r2] = await Promise.all([
      h.as().post(`/api/v1/games/${g.gameId}/reset`, { expectedVersion: 0 }),
      h.as().post(`/api/v1/games/${g.gameId}/reset`, { expectedVersion: 0 }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect((await h.get(g.gameId)).loop.current).toBe(2);
  });
});

describe('private data, exhaustively', () => {
  it('no endpoint exposes private fields while a game is active (incl. error responses)', async () => {
    const h = await makeHarness();
    const g = await h.start();
    const id = g.gameId;
    const calls = [
      h.as().get(`/api/v1/games/${id}`), h.as().get('/api/v1/games'), h.as().get('/api/v1/scenarios/samples'),
      h.as().get(`/api/v1/games/${id}/ending`),                                        // 409 while active
      h.act(id, 'interact_reset_relay'), h.act(id, 'nope'),                            // errors
      h.as().post(`/api/v1/games/${id}/hints`, { level: 3 }), h.as().post(`/api/v1/games/${id}/notes`, { text: 'n' }),
      h.reset(id),
    ];
    await Promise.all(calls);
    expect(h.leaks).toEqual([]);
  });

  it('the list of private markers actually matches the sample (guards against a stale scan list)', () => {
    expect(JSON.stringify(sampleScenario)).toContain(PRIVATE_STRINGS.at(-1).slice(0, 20));
    expect(sampleScenario.solutionGuide.causalChain[0]).toContain("Reyes' firmware 2.3.1 update disabled");
  });
});
