/**
 * Public projections. These whitelist fields explicitly so that private data
 * (solutionGuide, win/failure conditions, event definitions, prerequisites,
 * loop flags) cannot leak by accident when the blueprint grows new fields.
 */
import { getAvailableActions, remainingMinutes } from './gameEngine.js';
import { hasClue, isLocationAccessible } from './rules.js';

export function toPublicScenarioSummary(scenario) {
  return {
    id: scenario.id,
    slug: scenario.slug ?? null,
    title: scenario.title,
    premise: scenario.premise,
    theme: scenario.theme,
    difficulty: scenario.difficulty,
  };
}

export function toPublicState(blueprint, session, scenarioId = session.scenarioId) {
  const location = blueprint.locations.find((l) => l.id === session.currentLocationId);
  const persistentClues = session.persistentState.discoveredClueIds;
  const knownClues = blueprint.clues.filter((c) => hasClue(session, c.id));
  const finished = session.status !== 'active';
  return {
    gameId: session.id,
    scenario: { id: String(scenarioId), title: blueprint.title, premise: blueprint.premise, objective: blueprint.objective },
    status: session.status,
    stateVersion: session.stateVersion,
    loop: { current: session.currentLoop, max: blueprint.maxLoops },
    time: {
      current: session.currentTime,
      end: blueprint.loopEndTime,
      length: blueprint.loopLength,
      remainingMinutes: remainingMinutes(blueprint, session),
      expired: session.loopExpired,
    },
    turnCount: session.turnCount,
    location: { id: location.id, name: location.name, description: location.description },
    accessibleLocations: blueprint.locations
      .filter((l) => isLocationAccessible(blueprint, session, l.id))
      .map((l) => ({ id: l.id, name: l.name })),
    charactersHere: blueprint.characters
      .filter((c) => session.temporaryState.characterLocations[c.id] === session.currentLocationId)
      .map((c) => ({ id: c.id, name: c.name, role: c.role, publicFacts: c.publicFacts })),
    availableActions: getAvailableActions(blueprint, session),
    inventory: session.temporaryState.inventory.map((id) => {
      const item = blueprint.items.find((i) => i.id === id);
      return { id, name: item.name, persistent: item.persistent };
    }),
    journal: {
      clues: knownClues.map((c) => ({
        id: c.id, title: c.title, description: c.description,
        persistent: c.persistence === 'persistent' && persistentClues.includes(c.id),
      })),
      confirmedFacts: session.persistentState.confirmedFacts.map((id) => ({
        id, text: blueprint.facts.find((f) => f.id === id).text,
      })),
      playerNotes: session.persistentState.playerNotes,
    },
    recentEvents: session.eventLog
      .filter((e) => e.loop === session.currentLoop)
      .slice(-10)
      .map((e) => ({ gameTime: e.gameTime, eventType: e.eventType, description: e.description })),
    hints: {
      used: { 1: session.hintsUsed?.level1 ?? 0, 2: session.hintsUsed?.level2 ?? 0, 3: session.hintsUsed?.level3 ?? 0 },
      available: session.status === 'active',
    },
    recap: session.lastRecap,
    endingId: finished ? session.endingId : null,
  };
}

export function toGameSummary(blueprint, session) {
  return {
    gameId: session.id,
    scenarioId: String(session.scenarioId),
    title: blueprint?.title ?? null,
    status: session.status,
    currentLoop: session.currentLoop,
    updatedAt: session.updatedAt,
  };
}
