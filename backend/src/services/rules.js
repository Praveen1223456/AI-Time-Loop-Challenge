/**
 * Deterministic rule primitives shared by the engine and the blueprint validator:
 * clock helpers, the prerequisite mini-language, and allowlisted effect handlers.
 *
 * Prerequisite tokens (each optionally prefixed with "!" for negation):
 *   clue:<clueId>             clue known (persistent, or discovered this loop)
 *   item:<itemId>             item currently in inventory
 *   flag:<flag>               loop flag set (temporary; cleared on reset)
 *   fact:<factId>             fact confirmed (persistent)
 *   loc:<locationId>          player is in this location
 *   char:<characterId>@<loc>  character is currently in that location
 *   object:<objectId>=<state> object is currently in that state
 *   time_before:HH:MM         current in-game time is earlier than HH:MM
 *   time_at_or_after:HH:MM    current in-game time is HH:MM or later
 */
import { AppError } from '../utils/AppError.js';

const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseClock(value) {
  const m = CLOCK_RE.exec(value ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function formatClock(minutes) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const h = String(Math.floor(normalized / 60)).padStart(2, '0');
  const m = String(normalized % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Returns forward minutes between two clocks, wrapping across midnight.
 * Returns null if either clock string is invalid.
 */
export function minutesBetween(fromClock, toClock) {
  const fromMin = typeof fromClock === 'number' ? fromClock : parseClock(fromClock);
  const toMin = typeof toClock === 'number' ? toClock : parseClock(toClock);
  if (fromMin === null || toMin === null) return null;
  return ((toMin - fromMin) % 1440 + 1440) % 1440;
}

/** Adds minutes to a clock (HH:MM string or minute integer) and returns HH:MM. */
export function addMinutesToClock(clock, minutes) {
  const current = typeof clock === 'number' ? clock : parseClock(clock);
  if (current === null) return null;
  return formatClock(current + minutes);
}

/** Returns a parsed prerequisite, or null if the token is malformed / not allowlisted. */
export function parsePrerequisite(token) {
  if (typeof token !== 'string') return null;
  let body = token;
  let negated = false;
  if (body.startsWith('!')) {
    negated = true;
    body = body.slice(1);
  }
  const idx = body.indexOf(':');
  if (idx <= 0) return null;
  const kind = body.slice(0, idx);
  const value = body.slice(idx + 1);
  if (!value) return null;
  switch (kind) {
    case 'clue':
    case 'item':
    case 'flag':
    case 'fact':
    case 'loc':
      return { kind, value, negated };
    case 'char': {
      const parts = value.split('@');
      return parts.length === 2 && parts[0] && parts[1]
        ? { kind, characterId: parts[0], locationId: parts[1], negated }
        : null;
    }
    case 'object': {
      const parts = value.split('=');
      return parts.length === 2 && parts[0] && parts[1]
        ? { kind, objectId: parts[0], state: parts[1], negated }
        : null;
    }
    case 'time_before':
    case 'time_at_or_after': {
      const minutes = parseClock(value);
      return minutes === null ? null : { kind, minutes, negated };
    }
    default:
      return null;
  }
}

export function hasClue(session, clueId) {
  return (
    session.persistentState.discoveredClueIds.includes(clueId) ||
    session.temporaryState.loopFlags.includes(`clue:${clueId}`)
  );
}

export function hasFlag(session, flag) {
  return session.temporaryState.loopFlags.includes(`flag:${flag}`);
}

function evaluateParsed(p, session) {
  let result;
  switch (p.kind) {
    case 'clue': result = hasClue(session, p.value); break;
    case 'item': result = session.temporaryState.inventory.includes(p.value); break;
    case 'flag': result = hasFlag(session, p.value); break;
    case 'fact': result = session.persistentState.confirmedFacts.includes(p.value); break;
    case 'loc': result = session.currentLocationId === p.value; break;
    case 'char': result = session.temporaryState.characterLocations[p.characterId] === p.locationId; break;
    case 'object': result = session.temporaryState.objectStates[p.objectId] === p.state; break;
    case 'time_before': {
      if (session?.initialTime) {
        const currentOffset = minutesBetween(session.initialTime, session.currentTime);
        const targetOffset = minutesBetween(session.initialTime, formatClock(p.minutes));
        result = currentOffset !== null && targetOffset !== null && currentOffset < targetOffset;
      } else {
        result = parseClock(session.currentTime) < p.minutes;
      }
      break;
    }
    case 'time_at_or_after': {
      if (session?.initialTime) {
        const currentOffset = minutesBetween(session.initialTime, session.currentTime);
        const targetOffset = minutesBetween(session.initialTime, formatClock(p.minutes));
        result = currentOffset !== null && targetOffset !== null && currentOffset >= targetOffset;
      } else {
        result = parseClock(session.currentTime) >= p.minutes;
      }
      break;
    }
    default: result = false;
  }
  return p.negated ? !result : result;
}

/** All tokens must hold. An unparseable token fails closed (never grants access). */
export function allPrerequisitesMet(tokens, session) {
  return tokens.every((token) => {
    const parsed = parsePrerequisite(token);
    return parsed !== null && evaluateParsed(parsed, session);
  });
}

export function isLocationAccessible(blueprint, session, locationId) {
  const location = blueprint.locations.find((l) => l.id === locationId);
  if (!location) return false;
  return !location.lockedByDefault || session.persistentState.unlockedLocationIds.includes(locationId);
}

/** Effect types the engine is willing to execute. Anything else is rejected by the schema. */
export const EFFECT_TYPES = Object.freeze([
  'discover_clue',
  'add_item',
  'remove_item',
  'set_flag',
  'set_object_state',
  'move_character',
  'unlock_action',
  'unlock_location',
  'confirm_fact',
]);

function pushUnique(list, value) {
  if (list.includes(value)) return false;
  list.push(value);
  return true;
}

/**
 * Applies one allowlisted effect to `session` (which the caller has already cloned).
 * `ctx.log(eventType, description, refId)` records to the event log.
 */
export function applyEffect(effect, session, blueprint, ctx) {
  const byId = (list, id) => list.find((x) => x.id === id);
  switch (effect.type) {
    case 'discover_clue': {
      const clue = byId(blueprint.clues, effect.clueId);
      const added =
        clue.persistence === 'persistent'
          ? pushUnique(session.persistentState.discoveredClueIds, clue.id)
          : pushUnique(session.temporaryState.loopFlags, `clue:${clue.id}`);
      if (added) ctx.log('clue_discovered', `Discovered clue: ${clue.title}`, clue.id);
      break;
    }
    case 'add_item': {
      const item = byId(blueprint.items, effect.itemId);
      const added = pushUnique(session.temporaryState.inventory, item.id);
      if (item.persistent) pushUnique(session.persistentState.persistentItemIds, item.id);
      if (added) ctx.log('item_gained', `Picked up: ${item.name}`, item.id);
      break;
    }
    case 'remove_item': {
      const item = byId(blueprint.items, effect.itemId);
      const inv = session.temporaryState.inventory;
      const i = inv.indexOf(item.id);
      if (i !== -1) {
        inv.splice(i, 1);
        ctx.log('item_lost', `Used up: ${item.name}`, item.id);
      }
      const pi = session.persistentState.persistentItemIds.indexOf(item.id);
      if (pi !== -1) session.persistentState.persistentItemIds.splice(pi, 1);
      break;
    }
    case 'set_flag':
      pushUnique(session.temporaryState.loopFlags, `flag:${effect.flag}`);
      break;
    case 'set_object_state':
      session.temporaryState.objectStates[effect.objectId] = effect.state;
      break;
    case 'move_character':
      session.temporaryState.characterLocations[effect.characterId] = effect.locationId;
      break;
    case 'unlock_action':
      if (pushUnique(session.persistentState.unlockedActionIds, effect.actionId)) {
        const action = byId(blueprint.actions, effect.actionId);
        ctx.log('unlock', `New option unlocked: ${action.label}`, action.id);
      }
      break;
    case 'unlock_location':
      if (pushUnique(session.persistentState.unlockedLocationIds, effect.locationId)) {
        const loc = byId(blueprint.locations, effect.locationId);
        ctx.log('unlock', `New location unlocked: ${loc.name}`, loc.id);
      }
      break;
    case 'confirm_fact': {
      const fact = byId(blueprint.facts, effect.factId);
      if (pushUnique(session.persistentState.confirmedFacts, fact.id)) {
        ctx.log('fact_confirmed', `Confirmed: ${fact.text}`, fact.id);
      }
      break;
    }
    default:
      // Unreachable for validated blueprints; fail loudly rather than silently skipping.
      throw new AppError(500, 'UNSUPPORTED_EFFECT', `Unsupported effect type: ${effect.type}`);
  }
}
