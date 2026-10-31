/**
 * Deterministic game engine. Pure functions: (blueprint, session, request, clock) -> new session.
 * The input session is never mutated; a rejected request throws before any clone is modified.
 * Nothing here consults an AI or randomness.
 */
import { AppError } from '../utils/AppError.js';
import {
  parseClock, formatClock, minutesBetween, addMinutesToClock, allPrerequisitesMet, isLocationAccessible, applyEffect,
} from './rules.js';

const INVALID_STATE_MESSAGE = 'That action is not available in the current state.';

export function freshTemporaryState(blueprint, persistentItemIds) {
  return {
    characterLocations: Object.fromEntries(blueprint.characters.map((c) => [c.id, c.initialLocationId])),
    inventory: [...persistentItemIds],
    objectStates: Object.fromEntries(blueprint.objects.map((o) => [o.id, o.initialState])),
    loopFlags: [],
  };
}

/** Appends an entry to the session event log. */
export function logEntry(session, now, { actionId = null, eventType, description, refId = null }) {
  session.eventLog.push({
    loop: session.currentLoop,
    turn: session.turnCount,
    gameTime: session.currentTime,
    actionId,
    eventType,
    refId,
    description,
    timestamp: now,
  });
}

export function createInitialSession(blueprint, { sessionId, scenarioId, now }) {
  const session = {
    scenarioId,
    sessionId,
    status: 'active',
    currentLoop: 1,
    currentTime: blueprint.initialTime,
    currentLocationId: blueprint.startLocationId,
    turnCount: 0,
    loopExpired: false,
    temporaryState: freshTemporaryState(blueprint, []),
    persistentState: {
      discoveredClueIds: [],
      unlockedActionIds: [],
      unlockedLocationIds: [],
      confirmedFacts: [],
      playerNotes: [],
      persistentItemIds: [],
    },
    hintsUsed: { level1: 0, level2: 0, level3: 0 },
    eventLog: [],
    lastRecap: null,
    endingId: null,
    stateVersion: 0,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
  };
  logEntry(session, now, { eventType: 'game_started', description: `Loop 1 begins at ${session.currentTime}.` });
  return session;
}

export function remainingMinutes(blueprint, session) {
  if (session.loopExpired) return 0;
  const elapsed = minutesBetween(blueprint.initialTime, session.currentTime);
  if (elapsed === null || elapsed >= blueprint.loopLength) return 0;
  return Math.max(0, blueprint.loopLength - elapsed);
}

export function isActionAvailable(blueprint, session, action) {
  if (action.locationId !== '*' && action.locationId !== session.currentLocationId) return false;
  if (action.lockedByDefault && !session.persistentState.unlockedActionIds.includes(action.id)) return false;
  if (action.type === 'travel' && !isLocationAccessible(blueprint, session, action.destinationId)) return false;
  return allPrerequisitesMet(action.prerequisites, session);
}

/** Actions the player can currently choose (empty once the loop has ended or the game is over). */
export function getAvailableActions(blueprint, session) {
  if (session.status !== 'active' || session.loopExpired) return [];
  const remaining = remainingMinutes(blueprint, session);
  return blueprint.actions
    .filter((a) => isActionAvailable(blueprint, session, a))
    .map((a) => ({
      id: a.id, type: a.type, label: a.label, timeCost: a.timeCost,
      ...(a.targetId ? { targetId: a.targetId } : {}),
      affordable: a.timeCost <= remaining,
    }));
}

/** Failure is evaluated before victory (a catastrophic outcome cancels a win). */
export function evaluateOutcome(blueprint, session) {
  for (const f of blueprint.failureConditions) {
    if (allPrerequisitesMet(f.conditions, session)) return { type: 'failure', endingId: f.endingId, conditionId: f.id };
  }
  for (const w of blueprint.winConditions) {
    if (allPrerequisitesMet(w.conditions, session)) return { type: 'victory', endingId: w.endingId, conditionId: w.id };
  }
  return null;
}

/** Fires events with fromOffset < at <= toOffset, ordered by (offset, declaration index). Each fires at most once per loop. */
function fireScheduledEvents(blueprint, session, ctx, fromOffset, toOffset) {
  const due = blueprint.events
    .map((event, index) => ({
      event,
      index,
      offset: minutesBetween(blueprint.initialTime, event.at),
    }))
    .filter((e) => e.offset !== null && e.offset > fromOffset && e.offset <= toOffset)
    .sort((a, b) => a.offset - b.offset || a.index - b.index);
  for (const { event } of due) {
    const key = `event:${event.id}`;
    if (session.temporaryState.loopFlags.includes(key)) continue;
    session.temporaryState.loopFlags.push(key);
    session.currentTime = event.at; // evaluate conditions as of the event's own time
    if (!allPrerequisitesMet(event.conditions, session)) continue;
    ctx.log('event_triggered', event.description, event.id);
    for (const effect of event.effects) applyEffect(effect, session, blueprint, ctx);
  }
}

export function performAction(blueprint, session, request, { now }) {
  if (session.status !== 'active') throw new AppError(409, 'GAME_NOT_ACTIVE', 'This game has already ended.');
  if (session.loopExpired) throw new AppError(409, 'LOOP_ENDED', 'Time has run out. Reset the loop to continue.');

  const action = blueprint.actions.find((a) => a.id === request.actionId);
  if (!action) throw new AppError(400, 'INVALID_ACTION', 'Unknown action.');
  if (request.targetId !== undefined && request.targetId !== action.targetId) {
    throw new AppError(400, 'INVALID_ACTION', 'That target does not match the action.');
  }
  if (!isActionAvailable(blueprint, session, action)) {
    throw new AppError(409, 'INVALID_ACTION', INVALID_STATE_MESSAGE); // intentionally vague: don't leak hidden prerequisites
  }
  if (action.timeCost > remainingMinutes(blueprint, session)) {
    throw new AppError(409, 'INSUFFICIENT_TIME', 'There is not enough time left in this loop for that action.');
  }

  // Everything below operates on a clone so the caller's session is untouched.
  const next = structuredClone(session);
  const startLogLength = next.eventLog.length;
  const ctx = {
    log: (eventType, description, refId = null) =>
      logEntry(next, now, { actionId: action.id, eventType, description, refId }),
  };

  ctx.log('action', action.label, action.id);
  if (action.type === 'travel') next.currentLocationId = action.destinationId;
  for (const effect of action.effects) applyEffect(effect, next, blueprint, ctx);

  const fromOffset = minutesBetween(blueprint.initialTime, next.currentTime);
  const toOffset = fromOffset + action.timeCost;
  next.turnCount += 1;
  const nextClock = addMinutesToClock(blueprint.initialTime, toOffset);
  next.currentTime = nextClock;
  const eventCtx = {
    log: (eventType, description, refId = null) =>
      logEntry(next, now, { actionId: null, eventType, description, refId }),
  };
  fireScheduledEvents(blueprint, next, { ...ctx, log: eventCtx.log }, fromOffset, toOffset);
  next.currentTime = nextClock; // events may have temporarily set the clock

  const outcome = evaluateOutcome(blueprint, next);
  if (outcome?.type === 'victory') {
    next.status = 'completed';
    next.endingId = outcome.endingId;
    next.completedAt = now;
    logEntry(next, now, {
      eventType: 'game_won',
      description: blueprint.endings.find((e) => e.id === outcome.endingId).title,
      refId: outcome.conditionId,
    });
  } else if (toOffset >= blueprint.loopLength) {
    // Loop time has expired: the world snaps back, ready for resetLoop
    next.loopExpired = true;
    logEntry(next, now, { eventType: 'time_expired', description: `Time expired at ${next.currentTime}.` });
  } else if (outcome?.type === 'failure') {
    // Immediate mid-loop catastrophic failure caused by player action
    next.status = 'failed';
    next.endingId = outcome.endingId;
    next.completedAt = now;
    logEntry(next, now, {
      eventType: 'game_failed',
      description: blueprint.endings.find((e) => e.id === outcome.endingId).title,
      refId: outcome.conditionId,
    });
  }
  next.updatedAt = now;

  return {
    session: next,
    result: {
      actionId: action.id,
      narrative: action.narrative,
      timeCost: action.timeCost,
      entries: next.eventLog.slice(startLogLength).map((e) => ({
        eventType: e.eventType, gameTime: e.gameTime, description: e.description,
      })),
      outcome: outcome ? { type: outcome.type, endingId: outcome.endingId } : null,
      loopExpired: next.loopExpired,
    },
  };
}

export const MAX_NOTES = 20;
export const MAX_NOTE_LENGTH = 300;

/** Player notes are the journal's "hypotheses": persistent, never treated as confirmed facts. */
export function addPlayerNote(session, text, { now }) {
  if (session.status !== 'active') throw new AppError(409, 'GAME_NOT_ACTIVE', 'This game has already ended.');
  const clean = String(text).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, MAX_NOTE_LENGTH);
  if (!clean) throw new AppError(400, 'VALIDATION_ERROR', 'Note cannot be empty.');
  if (session.persistentState.playerNotes.length >= MAX_NOTES) {
    throw new AppError(409, 'NOTES_LIMIT', `You can keep at most ${MAX_NOTES} notes.`);
  }
  const next = structuredClone(session);
  next.persistentState.playerNotes.push(clean);
  next.updatedAt = now;
  return next;
}
