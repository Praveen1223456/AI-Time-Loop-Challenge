import { AppError } from '../utils/AppError.js';

/**
 * Builds the ending explanation. The solution guide is only exposed here, and only
 * once the game is over; everything else comes from recorded events.
 */
export function buildEnding(blueprint, session) {
  if (session.status === 'active') {
    throw new AppError(409, 'GAME_NOT_FINISHED', 'The ending is only available once the game is over.');
  }
  const ending = blueprint.endings.find((e) => e.id === session.endingId);
  const discovered = new Set(session.persistentState.discoveredClueIds);
  const clueView = (c) => ({ id: c.id, title: c.title, description: c.description });
  const decisions = session.eventLog
    .filter((e) => e.loop === session.currentLoop && e.eventType === 'action')
    .map((e) => ({ gameTime: e.gameTime, description: e.description }));
  const persistentTotal = blueprint.clues.filter((c) => c.persistence === 'persistent').length;
  const keyClues = blueprint.clues.filter((c) => discovered.has(c.id));
  const hints = session.hintsUsed ?? { level1: 0, level2: 0, level3: 0 };
  const hintTotal = hints.level1 + hints.level2 + hints.level3;
  // Composed only from recorded state: no generated text can add facts here.
  const summary = ending.type === 'victory'
    ? `You broke the loop in ${session.currentLoop} loop${session.currentLoop === 1 ? '' : 's'}, discovering ${keyClues.length} of ${persistentTotal} lasting clues and using ${hintTotal} hint${hintTotal === 1 ? '' : 's'}.`
    : `The loop was not broken after ${session.currentLoop} loop${session.currentLoop === 1 ? '' : 's'}. You discovered ${keyClues.length} of ${persistentTotal} lasting clues and used ${hintTotal} hint${hintTotal === 1 ? '' : 's'}.`;
  return {
    scenarioId: String(session.scenarioId),
    summary,
    hintsUsed: { ...hints, total: hintTotal },
    decisions,
    ending: { id: ending.id, title: ending.title, narrative: ending.narrative, type: ending.type },
    objectiveCompleted: ending.type === 'victory',
    loopsPlayed: session.currentLoop,
    keyCluesDiscovered: blueprint.clues.filter((c) => discovered.has(c.id)).map(clueView),
    missedClues: blueprint.clues.filter((c) => c.persistence === 'persistent' && !discovered.has(c.id)).map(clueView),
    causalChain: blueprint.solutionGuide.causalChain,
    timeline: session.eventLog
      .filter((e) => ['clue_discovered', 'unlock', 'fact_confirmed', 'event_triggered', 'loop_reset', 'game_won', 'game_failed'].includes(e.eventType))
      .map((e) => ({ loop: e.loop, gameTime: e.gameTime, eventType: e.eventType, description: e.description })),
  };
}
