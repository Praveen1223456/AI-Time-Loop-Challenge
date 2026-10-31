/**
 * Explicit, server-side loop reset. This is the ONLY code path that increments
 * `currentLoop`.
 */
import { AppError } from '../utils/AppError.js';
import { freshTemporaryState, logEntry } from './gameEngine.js';

/** Builds a deterministic recap of the loop that just ended from recorded events only. */
export function buildRecap(blueprint, session, endedBy) {
  const entries = session.eventLog.filter((e) => e.loop === session.currentLoop);
  const clueTitle = (id) => blueprint.clues.find((c) => c.id === id)?.title ?? id;
  return {
    loop: session.currentLoop,
    endedBy,
    endTime: session.currentTime,
    turnsTaken: session.turnCount,
    cluesDiscovered: entries.filter((e) => e.eventType === 'clue_discovered').map((e) => ({ id: e.refId, title: clueTitle(e.refId) })),
    unlocks: entries.filter((e) => e.eventType === 'unlock').map((e) => e.description),
    factsConfirmed: entries.filter((e) => e.eventType === 'fact_confirmed').map((e) => e.description),
    eventsTriggered: entries.filter((e) => e.eventType === 'event_triggered').map((e) => ({ gameTime: e.gameTime, description: e.description })),
  };
}

export function resetLoop(blueprint, session, { reason = 'manual', now }) {
  if (session.status !== 'active') throw new AppError(409, 'GAME_NOT_ACTIVE', 'This game has already ended.');
  if (reason === 'time_expired' && !session.loopExpired) {
    throw new AppError(409, 'RESET_NOT_ALLOWED', 'The loop has not run out of time.');
  }
  if (!session.loopExpired && !blueprint.reset.allowManualReset) {
    throw new AppError(409, 'RESET_NOT_ALLOWED', 'This scenario does not allow resetting before time runs out.');
  }
  const endedBy = session.loopExpired ? 'time_expired' : 'manual';

  const next = structuredClone(session);
  const recap = buildRecap(blueprint, session, endedBy);
  logEntry(next, now, { eventType: 'loop_reset', description: `Loop ${session.currentLoop} ended (${endedBy}).` });
  next.lastRecap = recap;
  next.updatedAt = now;

  if (session.currentLoop >= blueprint.maxLoops) {
    // Loop limit reached: the game ends in the scenario's loop-limit failure ending.
    next.status = 'failed';
    next.endingId = blueprint.loopLimitEndingId;
    next.completedAt = now;
    logEntry(next, now, {
      eventType: 'game_failed',
      description: blueprint.endings.find((e) => e.id === blueprint.loopLimitEndingId).title,
      refId: 'loop_limit',
    });
    return { session: next, recap };
  }

  // Restore temporary state; persistent knowledge is deliberately left untouched.
  next.currentLoop += 1;
  next.currentTime = blueprint.initialTime;
  next.currentLocationId = blueprint.startLocationId;
  next.turnCount = 0;
  next.loopExpired = false;
  next.temporaryState = freshTemporaryState(blueprint, next.persistentState.persistentItemIds);
  logEntry(next, now, { eventType: 'loop_started', description: `Loop ${next.currentLoop} begins at ${next.currentTime}.` });
  return { session: next, recap };
}
