/**
 * Orchestrates repositories + the deterministic engine. The client only ever
 * supplies an action ID / reset reason; it can never submit replacement state.
 */
import { AppError } from '../utils/AppError.js';
import { createInitialSession, performAction, addPlayerNote } from './gameEngine.js';
import { buildHint } from './hintService.js';
import { resetLoop } from './loopResetService.js';
import { buildEnding } from './endingService.js';
import { toPublicState, toGameSummary, toPublicScenarioSummary } from './publicView.js';

export function createGameService({ scenarios, games, clock = () => new Date() }) {
  /** Samples are public; generated scenarios are playable only by the session that created them. */
  async function loadPlayableScenario(scenarioId, sessionId) {
    const scenario = await scenarios.findById(scenarioId);
    if (!scenario || !(scenario.isSample || scenario.ownerSessionId === sessionId)) {
      throw new AppError(404, 'SCENARIO_NOT_FOUND', 'Scenario not found.'); // same answer for "missing" and "not yours"
    }
    return scenario;
  }

  async function startGame(scenarioId, sessionId) {
    const blueprint = await loadPlayableScenario(scenarioId, sessionId);
    const session = createInitialSession(blueprint, { sessionId, scenarioId: blueprint.id, now: clock() });
    const saved = await games.create(session);
    return toPublicState(blueprint, saved);
  }

  /** Runs `fn(game, blueprint)` and saves the result; retries once if another write got in first. */
  async function mutate(gameId, sessionId, fn) {
    for (let attempt = 1; ; attempt++) {
      const { game, blueprint } = await loadOwnedGame(gameId, sessionId);
      const out = await fn(game, blueprint);
      try {
        const saved = await games.save(out.session, game.stateVersion);
        return { ...out.extra, state: toPublicState(blueprint, saved) };
      } catch (err) {
        if (!(err instanceof AppError && err.code === 'STATE_CONFLICT') || attempt >= 2) throw err;
      }
    }
  }

  async function loadOwnedGame(gameId, sessionId) {
    const game = await games.findById(gameId);
    if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found.');
    if (game.sessionId !== sessionId) throw new AppError(403, 'FORBIDDEN', 'This game belongs to a different session.');
    const blueprint = await scenarios.findById(game.scenarioId);
    if (!blueprint) throw new AppError(500, 'SCENARIO_MISSING', 'The scenario for this game is unavailable.');
    return { game, blueprint };
  }

  function assertExpectedVersion(game, expectedVersion) {
    if (expectedVersion !== undefined && expectedVersion !== game.stateVersion) {
      throw new AppError(409, 'STATE_CONFLICT', 'The game changed since you last loaded it. Refresh and try again.');
    }
  }

  return {
    async listSampleScenarios() {
      return (await scenarios.listSamples()).map(toPublicScenarioSummary);
    },

    createGame: ({ scenarioId, sessionId }) => startGame(scenarioId, sessionId),

    /** Replay: a brand-new game on the same scenario. The old game is left exactly as it was. */
    async replay({ gameId, sessionId }) {
      const { game } = await loadOwnedGame(gameId, sessionId);
      return startGame(String(game.scenarioId), sessionId);
    },

    async hint({ gameId, sessionId, level }) {
      return mutate(gameId, sessionId, async (game, blueprint) => {
        if (game.status !== 'active') throw new AppError(409, 'GAME_NOT_ACTIVE', 'Hints are only available while a game is in progress.');
        const hint = await buildHint(blueprint, game, level);
        const next = structuredClone(game);
        next.hintsUsed[`level${level}`] += 1; // usage tracking only; hints never change gameplay state
        next.updatedAt = clock();
        return { session: next, extra: { hint } };
      });
    },

    async addNote({ gameId, sessionId, text, expectedVersion }) {
      return mutate(gameId, sessionId, async (game) => {
        assertExpectedVersion(game, expectedVersion);
        return { session: addPlayerNote(game, text, { now: clock() }), extra: {} };
      });
    },

    async getGame({ gameId, sessionId }) {
      const { game, blueprint } = await loadOwnedGame(gameId, sessionId);
      return toPublicState(blueprint, game);
    },

    async listGames({ sessionId, limit, skip }) {
      const { items, total } = await games.listBySession(sessionId, { limit, skip });
      const cache = new Map();
      const summaries = [];
      for (const game of items) {
        const key = String(game.scenarioId);
        if (!cache.has(key)) cache.set(key, await scenarios.findById(key));
        summaries.push(toGameSummary(cache.get(key), game));
      }
      return { items: summaries, total, limit, skip };
    },

    async act({ gameId, sessionId, actionId, targetId, expectedVersion }) {
      const { game, blueprint } = await loadOwnedGame(gameId, sessionId);
      assertExpectedVersion(game, expectedVersion);
      const { session, result } = performAction(blueprint, game, { actionId, targetId }, { now: clock() });
      const saved = await games.save(session, game.stateVersion);
      return { result, state: toPublicState(blueprint, saved) };
    },

    async reset({ gameId, sessionId, reason, expectedVersion }) {
      const { game, blueprint } = await loadOwnedGame(gameId, sessionId);
      assertExpectedVersion(game, expectedVersion);
      const { session, recap } = resetLoop(blueprint, game, { reason, now: clock() });
      const saved = await games.save(session, game.stateVersion);
      return { recap, state: toPublicState(blueprint, saved) };
    },

    async getEnding({ gameId, sessionId }) {
      const { game, blueprint } = await loadOwnedGame(gameId, sessionId);
      return buildEnding(blueprint, game);
    },
  };
}
