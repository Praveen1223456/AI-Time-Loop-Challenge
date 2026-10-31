/**
 * Repository contract. The in-memory implementation always runs. The MongoDB
 * implementation runs only when MONGODB_TEST_URI is set (e.g. `npm run test:db` against a
 * local test database); otherwise it is skipped, never faked.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createMemoryRepositories } from '../../src/repositories/memoryRepositories.js';
import { validateBlueprint } from '../../src/services/blueprintValidator.js';
import { sampleScenario } from '../../src/data/sampleScenario.js';
import { createInitialSession, performAction } from '../../src/services/gameEngine.js';
import { resetLoop } from '../../src/services/loopResetService.js';
import { NOW } from '../helpers.js';

const bp = validateBlueprint(sampleScenario);
const MONGO_URI = process.env.MONGODB_TEST_URI;

const implementations = [{ name: 'memory', setup: async () => ({ repos: createMemoryRepositories(), cleanup: async () => {} }) }];

if (MONGO_URI) {
  implementations.push({
    name: 'mongodb',
    setup: async () => {
      const { connectDb, disconnectDb } = await import('../../src/config/db.js');
      const { createMongoRepositories } = await import('../../src/repositories/mongoRepositories.js');
      const { GameSession } = await import('../../src/models/GameSession.js');
      const { Scenario } = await import('../../src/models/Scenario.js');
      await connectDb(MONGO_URI);
      const sessionIds = new Set();
      const repos = createMongoRepositories();
      const create = repos.games.create;
      repos.games.create = async (s) => { sessionIds.add(s.sessionId); return create(s); }; // so cleanup only touches our own rows
      return {
        repos,
        cleanup: async () => {
          await GameSession.deleteMany({ sessionId: { $in: [...sessionIds] } });
          await Scenario.deleteMany({ slug: /^contract-test-/ });
          await disconnectDb();
        },
      };
    },
  });
}

describe.each(implementations)('repository contract: $name', ({ setup }) => {
  let repos, cleanup, scenario, slug;
  beforeAll(async () => {
    ({ repos, cleanup } = await setup());
    slug = `contract-test-${randomUUID().slice(0, 8)}`;
    scenario = await repos.scenarios.upsertBySlug({ ...bp, slug }, { isSample: true });
  });
  afterAll(async () => { await cleanup(); });

  const newSession = (sessionId = randomUUID()) =>
    createInitialSession(bp, { sessionId, scenarioId: scenario.id, now: NOW });

  it('stores a scenario and returns it by id with the private guide intact server-side', async () => {
    const found = await repos.scenarios.findById(scenario.id);
    expect(found.title).toBe(bp.title);
    expect(found.solutionGuide.requiredClueIds).toEqual(bp.solutionGuide.requiredClueIds);
    expect(found.actions).toHaveLength(bp.actions.length);
  });

  it('upsertBySlug is idempotent', async () => {
    const again = await repos.scenarios.upsertBySlug({ ...bp, slug, title: 'Renamed' }, { isSample: true });
    expect(again.id).toBe(scenario.id);
    expect((await repos.scenarios.findById(scenario.id)).title).toBe('Renamed');
    await repos.scenarios.upsertBySlug({ ...bp, slug }, { isSample: true });
  });

  it('returns null for unknown or malformed ids', async () => {
    expect(await repos.scenarios.findById('not-an-id')).toBeNull();
    expect(await repos.scenarios.findById('ffffffffffffffffffffffff')).toBeNull();
    expect(await repos.games.findById('not-an-id')).toBeNull();
    expect(await repos.games.findById('ffffffffffffffffffffffff')).toBeNull();
  });

  it('lists samples', async () => {
    expect((await repos.scenarios.listSamples()).some((s) => s.id === scenario.id)).toBe(true);
  });

  it('creates and reloads a game session faithfully', async () => {
    const created = await repos.games.create(newSession());
    expect(created.id).toBeTruthy();
    expect(created.stateVersion).toBe(0);
    const found = await repos.games.findById(created.id);
    expect(found).toMatchObject({ status: 'active', currentLoop: 1, currentTime: '20:45', currentLocationId: 'control_room' });
    expect(found.temporaryState).toEqual(created.temporaryState);
    expect(found.persistentState).toEqual(created.persistentState);
    expect(found.eventLog).toHaveLength(1);
    expect(new Date(found.startedAt).getTime()).toBe(NOW.getTime());
  });

  it('saves with compare-and-set on stateVersion and rejects stale writers', async () => {
    const created = await repos.games.create(newSession());
    const { session } = performAction(bp, created, { actionId: 'inspect_control_panel' }, { now: NOW });
    const saved = await repos.games.save(session, 0);
    expect(saved.stateVersion).toBe(1);
    expect(saved.persistentState.discoveredClueIds).toEqual(['clue_unusual_alarm']);

    const stale = performAction(bp, created, { actionId: 'wait_one_minute' }, { now: NOW }).session;
    await expect(repos.games.save(stale, 0)).rejects.toMatchObject({ status: 409, code: 'STATE_CONFLICT' });
    const after = await repos.games.findById(created.id);
    expect(after.stateVersion).toBe(1);
    expect(after.currentTime).toBe('20:46'); // the stale write changed nothing
  });

  it('persists a loop reset (temporary cleared, persistent kept) across a reload', async () => {
    const created = await repos.games.create(newSession());
    let s = performAction(bp, created, { actionId: 'inspect_control_panel' }, { now: NOW }).session;
    s = performAction(bp, s, { actionId: 'take_field_notebook' }, { now: NOW }).session;
    s = await repos.games.save(s, 0);
    const reset = resetLoop(bp, s, { reason: 'manual', now: NOW }).session;
    await repos.games.save(reset, s.stateVersion);
    const reloaded = await repos.games.findById(created.id);
    expect(reloaded.currentLoop).toBe(2);
    expect(reloaded.temporaryState.objectStates).toEqual({ main_breaker: 'closed' });
    expect(reloaded.temporaryState.inventory).toEqual(['field_notebook']);
    expect(reloaded.persistentState.discoveredClueIds).toEqual(['clue_unusual_alarm']);
    expect(reloaded.lastRecap.loop).toBe(1);
  });

  it('lists games per session, newest first, with pagination', async () => {
    const sid = randomUUID();
    const a = await repos.games.create(newSession(sid));
    const b = await repos.games.create(newSession(sid));
    await repos.games.create(newSession(randomUUID()));
    const later = performAction(bp, b, { actionId: 'wait_one_minute' }, { now: new Date(NOW.getTime() + 5000) }).session;
    await repos.games.save(later, 0);
    const { items, total } = await repos.games.listBySession(sid, { limit: 10, skip: 0 });
    expect(total).toBe(2);
    expect(items.map((g) => g.id)).toEqual([b.id, a.id]);
    expect((await repos.games.listBySession(sid, { limit: 1, skip: 1 })).items.map((g) => g.id)).toEqual([a.id]);
  });
});
