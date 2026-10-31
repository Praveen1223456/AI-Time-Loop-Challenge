import { describe, it, expect } from 'vitest';
import { makeHarness } from '../apiHarness.js';
import { SESSION_A, SESSION_B, LOOP1_EXPLORE, READ_LOG, FINAL_RUN } from '../helpers.js';

const hint = (h, gameId, level, sid = SESSION_A) => h.as(sid).post(`/api/v1/games/${gameId}/hints`, { level });
const note = (h, gameId, text, sid = SESSION_A) => h.as(sid).post(`/api/v1/games/${gameId}/notes`, { text });
const lose = async (h, gameId) => { await h.actAll(gameId, ['go_control_to_reactor']); return h.act(gameId, 'interact_emergency_shutdown'); };
async function win(h, gameId) {
  await h.actAll(gameId, ['inspect_control_panel']); await h.reset(gameId);
  await h.actAll(gameId, READ_LOG); await h.reset(gameId);
  await h.actAll(gameId, FINAL_RUN);
}

describe('hints', () => {
  it('serves grounded hints at three levels and tracks usage without touching gameplay state', async () => {
    const h = await makeHarness();
    const g = await h.start();
    const before = await h.get(g.gameId);
    const texts = [];
    for (const level of [1, 2, 3]) {
      const res = await hint(h, g.gameId, level);
      expect(res.status).toBe(200);
      expect(res.body.data.hint).toMatchObject({ level, grounded: true });
      texts.push(res.body.data.hint.text);
    }
    expect(texts[0]).toMatch(/Control Room/);
    expect(texts[2]).toMatch(/Inspect the control panel/);
    const after = await h.get(g.gameId);
    expect(after.hints.used).toEqual({ 1: 1, 2: 1, 3: 1 });
    // Everything except the usage counter and version is untouched.
    const strip = ({ hints, stateVersion, ...rest }) => rest;
    expect(strip(after)).toEqual(strip(before));
    expect(after.journal.clues).toEqual([]);
    expect(h.leaks).toEqual([]);
  });

  it('is deterministic for the same state and validates the request', async () => {
    const h = await makeHarness();
    const g = await h.start();
    const a = (await hint(h, g.gameId, 2)).body.data.hint.text;
    const b = (await hint(h, g.gameId, 2)).body.data.hint.text;
    expect(a).toBe(b);
    for (const level of [0, 4, '1', 1.5, null, undefined]) expect((await hint(h, g.gameId, level)).status, String(level)).toBe(400);
    expect((await h.as().post(`/api/v1/games/${g.gameId}/hints`, { level: 1, text: 'invent a clue' })).status).toBe(400);
  });

  it('is only available to the owner and only while the game is active', async () => {
    const h = await makeHarness();
    const g = await h.start();
    expect((await hint(h, g.gameId, 1, SESSION_B)).status).toBe(403);
    await lose(h, g.gameId);
    const res = await hint(h, g.gameId, 1);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GAME_NOT_ACTIVE');
  });

  it('is rate limited per session', async () => {
    const h = await makeHarness({ rateLimits: { hints: { windowMs: 60000, limit: 2 } } });
    const g = await h.start();
    expect((await hint(h, g.gameId, 1)).status).toBe(200);
    expect((await hint(h, g.gameId, 1)).status).toBe(200);
    expect((await hint(h, g.gameId, 1)).status).toBe(429);
  });
});

describe('notes (player hypotheses)', () => {
  it('are stored in the journal, survive resets, and are never promoted to confirmed facts', async () => {
    const h = await makeHarness();
    const g = await h.start();
    const res = await note(h, g.gameId, 'Maybe Reyes sabotaged the relay?');
    expect(res.status).toBe(201);
    expect(res.body.data.state.journal.playerNotes).toEqual(['Maybe Reyes sabotaged the relay?']);
    expect(res.body.data.state.journal.confirmedFacts).toEqual([]);
    await h.reset(g.gameId);
    const after = await h.get(g.gameId);
    expect(after.journal.playerNotes).toEqual(['Maybe Reyes sabotaged the relay?']);
    expect(after.journal.confirmedFacts).toEqual([]);
  });

  it('validates, sanitizes, and caps notes', async () => {
    const h = await makeHarness();
    const g = await h.start();
    expect((await note(h, g.gameId, '')).status).toBe(400);
    expect((await note(h, g.gameId, '   ')).status).toBe(400);
    expect((await note(h, g.gameId, 'x'.repeat(301))).status).toBe(400);
    expect((await h.as().post(`/api/v1/games/${g.gameId}/notes`, { text: 'ok', state: {} })).status).toBe(400);
    const clean = await note(h, g.gameId, 'a\u0000b\u0007c');
    expect(clean.body.data.state.journal.playerNotes[0]).toBe('a b c');
    for (let i = 1; i < 20; i++) expect((await note(h, g.gameId, `note ${i}`)).status).toBe(201);
    const over = await note(h, g.gameId, 'one too many');
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('NOTES_LIMIT');
  });

  it('are owner-only', async () => {
    const h = await makeHarness();
    const g = await h.start();
    expect((await note(h, g.gameId, 'sneaky', SESSION_B)).status).toBe(403);
  });
});

describe('finished games cannot be modified (AC-10)', () => {
  it('rejects actions, resets, hints and notes after a loss, and after a win, leaving state byte-identical', async () => {
    for (const finish of [lose, async (h, id) => win(h, id)]) {
      const h = await makeHarness();
      const g = await h.start();
      await finish(h, g.gameId);
      const frozen = await h.get(g.gameId);
      expect(frozen.status).not.toBe('active');
      const attempts = [
        h.act(g.gameId, 'wait_one_minute'),
        h.reset(g.gameId),
        hint(h, g.gameId, 1),
        note(h, g.gameId, 'late note'),
      ];
      for (const r of await Promise.all(attempts)) {
        expect(r.status).toBe(409);
        expect(r.body.error.code).toBe('GAME_NOT_ACTIVE');
      }
      expect(await h.get(g.gameId)).toEqual(frozen);
    }
  });
});

describe('ending authorization and grounding (AC-11, AC-12)', () => {
  it('is blocked while active, blocked for other sessions, and complete once finished', async () => {
    const h = await makeHarness();
    const g = await h.start();
    expect((await h.as().get(`/api/v1/games/${g.gameId}/ending`)).body.error.code).toBe('GAME_NOT_FINISHED');
    await hint(h, g.gameId, 1);
    await win(h, g.gameId);
    expect((await h.as(SESSION_B).get(`/api/v1/games/${g.gameId}/ending`)).status).toBe(403);
    const res = await h.as().get(`/api/v1/games/${g.gameId}/ending`);
    expect(res.status).toBe(200);
    const e = res.body.data;
    expect(e).toMatchObject({ objectiveCompleted: true, loopsPlayed: 3, ending: { id: 'ending_lights_stay_on', type: 'victory' } });
    expect(e.hintsUsed).toEqual({ level1: 1, level2: 0, level3: 0, total: 1 });
    expect(e.summary).toBe('You broke the loop in 3 loops, discovering 3 of 6 lasting clues and using 1 hint.');
    expect(e.decisions.map((d) => d.description)).toEqual(['Go to the Engineering Bay', 'Ask Reyes about the silenced alarm', 'Go to the Reactor Hall', 'Run the R-7 revert procedure']);
    expect(e.keyCluesDiscovered.map((c) => c.id)).toEqual(['clue_unusual_alarm', 'clue_r7_patch', 'clue_patch_log']);
    expect(e.missedClues.map((c) => c.id)).toEqual(['clue_blackout_time', 'clue_director_remark', 'clue_relay_scorch']); // honest about what was missed
    expect(e.causalChain.length).toBeGreaterThan(0);
  });

  it('every sentence in the ending is built from recorded state or blueprint text (loss case)', async () => {
    const h = await makeHarness();
    const g = await h.start();
    await lose(h, g.gameId);
    const e = (await h.as().get(`/api/v1/games/${g.gameId}/ending`)).body.data;
    expect(e.objectiveCompleted).toBe(false);
    expect(e.ending.id).toBe('ending_panic_shutdown');
    expect(e.summary).toMatch(/^The loop was not broken after 1 loop\. You discovered 0 of 6 lasting clues and used 0 hints\.$/);
  });
});

describe('save, resume, history, replay', () => {
  it('resumes the exact saved state after a server restart', async () => {
    const h = await makeHarness();
    const g = await h.start();
    await h.actAll(g.gameId, LOOP1_EXPLORE);
    await h.reset(g.gameId);
    await note(h, g.gameId, 'remember this');
    const before = await h.get(g.gameId);
    h.restart(); // new app instance over the same persistent repositories
    expect(await h.get(g.gameId)).toEqual(before);
    expect((await h.act(g.gameId, 'wait_one_minute')).status).toBe(200); // and it is still playable
  });

  it('lists history with status and supports pagination, newest first', async () => {
    const h = await makeHarness();
    const a = await h.start(); await new Promise((r) => setTimeout(r, 5));
    const b = await h.start(); await lose(h, b.gameId);
    const list = (await h.as().get('/api/v1/games')).body.data;
    expect(list.total).toBe(2);
    expect(list.items.map((i) => [i.gameId, i.status])).toEqual([[b.gameId, 'failed'], [a.gameId, 'active']]);
  });

  it('replay starts a fresh game on the same scenario and leaves the finished game untouched', async () => {
    const h = await makeHarness();
    const g = await h.start();
    await win(h, g.gameId);
    const finished = await h.get(g.gameId);
    const res = await h.as().post(`/api/v1/games/${g.gameId}/replay`, {});
    expect(res.status).toBe(201);
    const fresh = res.body.data;
    expect(fresh.gameId).not.toBe(g.gameId);
    expect(fresh).toMatchObject({ status: 'active', loop: { current: 1 }, stateVersion: 0, inventory: [], endingId: null, scenario: { id: finished.scenario.id } });
    expect(fresh.journal).toEqual({ clues: [], confirmedFacts: [], playerNotes: [] }); // knowledge does not leak into a replay
    expect(fresh.hints.used).toEqual({ 1: 0, 2: 0, 3: 0 });
    expect(await h.get(g.gameId)).toEqual(finished);
    expect((await h.as().get('/api/v1/games')).body.data.total).toBe(2);
    expect((await h.act(fresh.gameId, 'inspect_control_panel')).status).toBe(200);
  });

  it('replay is owner-only', async () => {
    const h = await makeHarness();
    const g = await h.start();
    expect((await h.as(SESSION_B).post(`/api/v1/games/${g.gameId}/replay`, {})).status).toBe(403);
    expect((await h.as().post('/api/v1/games/nope/replay', {})).status).toBe(404);
  });

  it('ownership holds for every game endpoint', async () => {
    const h = await makeHarness();
    const g = await h.start(SESSION_A);
    const id = g.gameId;
    const b = h.as(SESSION_B);
    const results = await Promise.all([
      b.get(`/api/v1/games/${id}`), b.get(`/api/v1/games/${id}/ending`),
      b.post(`/api/v1/games/${id}/actions`, { actionId: 'wait_one_minute' }), b.post(`/api/v1/games/${id}/reset`, {}),
      b.post(`/api/v1/games/${id}/hints`, { level: 1 }), b.post(`/api/v1/games/${id}/notes`, { text: 'hi' }),
      b.post(`/api/v1/games/${id}/replay`, {}),
    ]);
    expect(results.map((r) => r.status)).toEqual(Array(7).fill(403));
    expect((await h.as(SESSION_B).get('/api/v1/games')).body.data.total).toBe(0);
    expect((await h.get(id)).stateVersion).toBe(0);
  });
});
