import { Scenario } from '../models/Scenario.js';
import { GameSession } from '../models/GameSession.js';
import { AppError } from '../utils/AppError.js';

// NOTE: IDs are checked with a strict 24-hex regex rather than mongoose.isValidObjectId,
// which also accepts arbitrary 12-character strings.
const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

function toPlain(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  const out = { id: String(_id), ...rest };
  if (out.scenarioId) out.scenarioId = String(out.scenarioId);
  return out;
}

export function createMongoRepositories() {
  const scenarios = {
    async findById(id) {
      if (!OBJECT_ID_RE.test(String(id))) return null;
      return toPlain(await Scenario.findById(id).lean());
    },
    async listSamples() {
      return (await Scenario.find({ isSample: true }).sort({ createdAt: 1 }).lean()).map(toPlain);
    },
    /** Callers must pass an already-validated blueprint (see scenarioGenerator). */
    async create(blueprint, { ownerSessionId = null } = {}) {
      const doc = await Scenario.create({ ...blueprint, isSample: false, ownerSessionId });
      return toPlain(doc.toObject());
    },
    async upsertBySlug(blueprint, { isSample = false } = {}) {
      const doc = await Scenario.findOneAndUpdate(
        { slug: blueprint.slug },
        { $set: { ...blueprint, isSample, ownerSessionId: null } },
        { upsert: true, returnDocument: 'after', lean: true, setDefaultsOnInsert: true },
      );
      return toPlain(doc);
    },
  };

  const games = {
    async create(session) {
      const { id: _ignored, ...fields } = session;
      const doc = await GameSession.create({ ...fields, stateVersion: 0 });
      return toPlain(doc.toObject());
    },
    async findById(id) {
      if (!OBJECT_ID_RE.test(String(id))) return null;
      return toPlain(await GameSession.findById(id).lean());
    },
    /** Atomic compare-and-set on stateVersion: a stale writer matches nothing and gets a 409. */
    async save(session, expectedVersion) {
      const {
        id, scenarioId: _s, sessionId: _sid, startedAt: _st, ...mutable
      } = session;
      const updated = await GameSession.findOneAndUpdate(
        { _id: id, stateVersion: expectedVersion },
        { $set: { ...mutable, stateVersion: expectedVersion + 1 } },
        { returnDocument: 'after', lean: true },
      );
      if (!updated) {
        throw new AppError(409, 'STATE_CONFLICT', 'The game changed since it was loaded. Refresh and try again.');
      }
      return toPlain(updated);
    },
    async listBySession(sessionId, { limit = 20, skip = 0 } = {}) {
      const [items, total] = await Promise.all([
        GameSession.find({ sessionId }).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
        GameSession.countDocuments({ sessionId }),
      ]);
      return { items: items.map(toPlain), total };
    },
  };

  return { scenarios, games };
}
