/**
 * In-memory repositories implementing the same contract as the Mongo ones.
 * Used by automated tests (no database required) and nothing else. Values are
 * cloned on the way in and out, mimicking a database boundary.
 */
import { randomUUID } from 'node:crypto';
import { AppError } from '../utils/AppError.js';

export function createMemoryRepositories() {
  const scenarioStore = new Map();
  const gameStore = new Map();

  const scenarios = {
    async findById(id) {
      const s = scenarioStore.get(String(id));
      return s ? structuredClone(s) : null;
    },
    async listSamples() {
      return [...scenarioStore.values()].filter((s) => s.isSample).map((s) => structuredClone(s));
    },
    /** Callers must pass an already-validated blueprint (see scenarioGenerator). */
    async create(blueprint, { ownerSessionId = null } = {}) {
      const id = randomUUID();
      const record = { ...structuredClone(blueprint), id, isSample: false, ownerSessionId };
      scenarioStore.set(id, record);
      return structuredClone(record);
    },
    async upsertBySlug(blueprint, { isSample = false } = {}) {
      const existing = [...scenarioStore.values()].find((s) => s.slug === blueprint.slug);
      const id = existing?.id ?? randomUUID();
      const record = { ...structuredClone(blueprint), id, isSample, ownerSessionId: null };
      scenarioStore.set(id, record);
      return structuredClone(record);
    },
  };

  const games = {
    async create(session) {
      const id = randomUUID();
      const record = { ...structuredClone(session), id, stateVersion: 0 };
      gameStore.set(id, record);
      return structuredClone(record);
    },
    async findById(id) {
      const g = gameStore.get(String(id));
      return g ? structuredClone(g) : null;
    },
    /** Compare-and-set on stateVersion. */
    async save(session, expectedVersion) {
      const current = gameStore.get(session.id);
      if (!current) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found.');
      if (current.stateVersion !== expectedVersion) {
        throw new AppError(409, 'STATE_CONFLICT', 'The game changed since it was loaded. Refresh and try again.');
      }
      const record = { ...structuredClone(session), stateVersion: expectedVersion + 1 };
      gameStore.set(session.id, record);
      return structuredClone(record);
    },
    async listBySession(sessionId, { limit = 20, skip = 0 } = {}) {
      const all = [...gameStore.values()]
        .filter((g) => g.sessionId === sessionId)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return { items: all.slice(skip, skip + limit).map((g) => structuredClone(g)), total: all.length };
    },
  };

  return { scenarios, games };
}
