/**
 * Blueprint validation: Zod schema + semantic checks (references, allowlists,
 * quality minimums, and relaxed reachability). Used for the hand-authored sample
 * now and for AI-generated blueprints in Phase 3. AI output is untrusted until
 * it passes this.
 */
import { blueprintSchema } from '../validators/scenarioSchemas.js';
import { parsePrerequisite, parseClock, minutesBetween } from './rules.js';

export class BlueprintValidationError extends Error {
  constructor(issues) {
    super(`Blueprint validation failed (${issues.length} issue${issues.length === 1 ? '' : 's'}): ${issues.join('; ')}`);
    this.name = 'BlueprintValidationError';
    this.issues = issues;
  }
}

export const QUALITY_MINIMUMS = Object.freeze({ locations: 3, characters: 3, clues: 6 });

const duplicates = (ids) => ids.filter((id, i) => ids.indexOf(id) !== i);

export function validateBlueprint(raw) {
  const parsed = blueprintSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BlueprintValidationError(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'blueprint'}: ${i.message}`),
    );
  }
  const bp = parsed.data;
  const issues = [];
  const ids = (list) => new Set(list.map((x) => x.id));
  const locationIds = ids(bp.locations);
  const characterIds = ids(bp.characters);
  const clueIds = ids(bp.clues);
  const itemIds = ids(bp.items);
  const factIds = ids(bp.facts);
  const actionIds = ids(bp.actions);
  const endingIds = ids(bp.endings);
  const objectById = new Map(bp.objects.map((o) => [o.id, o]));

  // --- uniqueness ---
  for (const [name, list] of Object.entries({
    locations: bp.locations, characters: bp.characters, objects: bp.objects, items: bp.items,
    facts: bp.facts, clues: bp.clues, actions: bp.actions, events: bp.events,
    endings: bp.endings, winConditions: bp.winConditions, failureConditions: bp.failureConditions,
  })) {
    for (const id of duplicates(list.map((x) => x.id))) issues.push(`duplicate ${name} id "${id}"`);
  }

  // --- time window ---
  const start = parseClock(bp.initialTime);
  const end = parseClock(bp.loopEndTime);
  if (start === null || end === null) {
    issues.push('initialTime and loopEndTime must be valid HH:MM clocks');
  } else {
    const elapsed = minutesBetween(bp.initialTime, bp.loopEndTime);
    const isLater = (end > start) || (end < start && elapsed === bp.loopLength);
    if (!isLater || elapsed === 0) {
      issues.push('loopEndTime must be later than initialTime');
    } else if (bp.loopLength !== elapsed) {
      issues.push(`loopLength (${bp.loopLength}) must equal loopEndTime - initialTime (${elapsed} minutes)`);
    }
  }

  // --- quality minimums (spec section 13) ---
  if (bp.locations.length < QUALITY_MINIMUMS.locations) issues.push(`at least ${QUALITY_MINIMUMS.locations} locations required`);
  if (bp.characters.length < QUALITY_MINIMUMS.characters) issues.push(`at least ${QUALITY_MINIMUMS.characters} characters required`);
  if (bp.clues.length < QUALITY_MINIMUMS.clues) issues.push(`at least ${QUALITY_MINIMUMS.clues} clues required`);

  // --- simple references ---
  if (!locationIds.has(bp.startLocationId)) issues.push(`startLocationId "${bp.startLocationId}" does not exist`);
  const startLoc = bp.locations.find((l) => l.id === bp.startLocationId);
  if (startLoc?.lockedByDefault) issues.push('start location cannot be lockedByDefault');
  for (const c of bp.characters) if (!locationIds.has(c.initialLocationId)) issues.push(`character "${c.id}" has unknown initialLocationId "${c.initialLocationId}"`);
  for (const o of bp.objects) {
    if (!locationIds.has(o.locationId)) issues.push(`object "${o.id}" has unknown locationId "${o.locationId}"`);
    if (!o.states.includes(o.initialState)) issues.push(`object "${o.id}" initialState is not in its states`);
  }

  // --- prerequisite tokens ---
  const flagsSet = new Set();
  const checkTokens = (tokens, where) => {
    for (const token of tokens) {
      const p = parsePrerequisite(token);
      if (!p) { issues.push(`${where}: unsupported prerequisite "${token}"`); continue; }
      const need = (ok, what) => { if (!ok) issues.push(`${where}: prerequisite "${token}" references unknown ${what}`); };
      switch (p.kind) {
        case 'clue': need(clueIds.has(p.value), 'clue'); break;
        case 'item': need(itemIds.has(p.value), 'item'); break;
        case 'fact': need(factIds.has(p.value), 'fact'); break;
        case 'loc': need(locationIds.has(p.value), 'location'); break;
        case 'char': need(characterIds.has(p.characterId), 'character'); need(locationIds.has(p.locationId), 'location'); break;
        case 'object': {
          const obj = objectById.get(p.objectId);
          need(!!obj, 'object');
          if (obj) need(obj.states.includes(p.state), 'object state');
          break;
        }
        default: break;
      }
    }
  };

  // --- effects ---
  const unlockedActionTargets = new Set();
  const unlockedLocationTargets = new Set();
  const discoverable = new Set();
  const checkEffects = (effects, where) => {
    for (const e of effects) {
      const need = (ok, what) => { if (!ok) issues.push(`${where}: effect "${e.type}" references unknown ${what}`); };
      switch (e.type) {
        case 'discover_clue': need(clueIds.has(e.clueId), 'clue'); discoverable.add(e.clueId); break;
        case 'add_item': case 'remove_item': need(itemIds.has(e.itemId), 'item'); break;
        case 'set_flag': flagsSet.add(e.flag); break;
        case 'set_object_state': {
          const obj = objectById.get(e.objectId);
          need(!!obj, 'object');
          if (obj) need(obj.states.includes(e.state), 'object state');
          break;
        }
        case 'move_character': need(characterIds.has(e.characterId), 'character'); need(locationIds.has(e.locationId), 'location'); break;
        case 'unlock_action': need(actionIds.has(e.actionId), 'action'); unlockedActionTargets.add(e.actionId); break;
        case 'unlock_location': need(locationIds.has(e.locationId), 'location'); unlockedLocationTargets.add(e.locationId); break;
        case 'confirm_fact': need(factIds.has(e.factId), 'fact'); break;
        default: break;
      }
    }
  };

  // --- actions ---
  for (const a of bp.actions) {
    const where = `action "${a.id}"`;
    if (a.locationId !== '*' && !locationIds.has(a.locationId)) issues.push(`${where}: unknown locationId "${a.locationId}"`);
    if (a.type === 'travel') {
      if (!a.destinationId || !locationIds.has(a.destinationId)) issues.push(`${where}: travel needs a valid destinationId`);
      else if (a.destinationId === a.locationId) issues.push(`${where}: travel destination equals origin`);
      if (a.locationId === '*') issues.push(`${where}: travel cannot be location "*"`);
    } else if (a.destinationId) {
      issues.push(`${where}: only travel actions may set destinationId`);
    }
    if (a.type === 'use_item' && !a.prerequisites.some((t) => t.replace(/^!/, '').startsWith('item:'))) {
      issues.push(`${where}: use_item must require an item: prerequisite`);
    }
    if (a.locationId === '*' && a.type !== 'wait') issues.push(`${where}: only wait actions may use location "*"`);
    checkTokens(a.prerequisites, where);
    checkEffects(a.effects, where);
  }
  for (const e of bp.events) {
    const at = parseClock(e.at);
    if (at === null) {
      issues.push(`event "${e.id}": time ${e.at} is not a valid clock (must be HH:MM)`);
      continue;
    }
    const offset = minutesBetween(bp.initialTime, e.at);
    if (offset === null || offset <= 0 || offset > bp.loopLength) {
      issues.push(`event "${e.id}": time ${e.at} must be after initialTime and no later than loopEndTime`);
    }
    checkTokens(e.conditions, `event "${e.id}"`);
    checkEffects(e.effects, `event "${e.id}"`);
  }
  for (const w of [...bp.winConditions, ...bp.failureConditions]) checkTokens(w.conditions, `condition "${w.id}"`);

  // --- flags must be settable ---
  const flagsReferenced = [
    ...bp.actions.flatMap((a) => a.prerequisites),
    ...bp.events.flatMap((e) => e.conditions),
    ...[...bp.winConditions, ...bp.failureConditions].flatMap((c) => c.conditions),
  ].map(parsePrerequisite).filter((p) => p?.kind === 'flag');
  for (const p of flagsReferenced) if (!flagsSet.has(p.value)) issues.push(`flag "${p.value}" is required but never set by any effect`);

  // --- locks ---
  for (const a of bp.actions) {
    if (a.lockedByDefault && !unlockedActionTargets.has(a.id)) issues.push(`action "${a.id}" is lockedByDefault but nothing unlocks it`);
  }
  for (const l of bp.locations) {
    if (l.lockedByDefault && !unlockedLocationTargets.has(l.id)) issues.push(`location "${l.id}" is lockedByDefault but nothing unlocks it`);
  }
  for (const id of unlockedActionTargets) {
    if (!bp.actions.find((a) => a.id === id)?.lockedByDefault) issues.push(`unlock_action target "${id}" is not lockedByDefault`);
  }
  for (const id of unlockedLocationTargets) {
    if (!bp.locations.find((l) => l.id === id)?.lockedByDefault) issues.push(`unlock_location target "${id}" is not lockedByDefault`);
  }

  // --- clues discoverable ---
  for (const c of bp.clues) if (!discoverable.has(c.id)) issues.push(`clue "${c.id}" can never be discovered`);

  // --- endings & solution guide ---
  const endingOf = (id) => bp.endings.find((e) => e.id === id);
  for (const w of bp.winConditions) {
    if (!endingIds.has(w.endingId)) issues.push(`win condition "${w.id}" references unknown ending "${w.endingId}"`);
    else if (endingOf(w.endingId).type !== 'victory') issues.push(`win condition "${w.id}" must point at a victory ending`);
  }
  for (const f of bp.failureConditions) {
    if (!endingIds.has(f.endingId)) issues.push(`failure condition "${f.id}" references unknown ending "${f.endingId}"`);
    else if (endingOf(f.endingId).type !== 'failure') issues.push(`failure condition "${f.id}" must point at a failure ending`);
  }
  if (!endingIds.has(bp.loopLimitEndingId)) issues.push(`loopLimitEndingId "${bp.loopLimitEndingId}" does not exist`);
  else if (endingOf(bp.loopLimitEndingId).type !== 'failure') issues.push('loopLimitEndingId must be a failure ending');
  if (!endingIds.has(bp.solutionGuide.intendedEndingId)) issues.push('solutionGuide.intendedEndingId does not exist');
  for (const id of bp.solutionGuide.requiredClueIds) if (!clueIds.has(id)) issues.push(`solutionGuide references unknown clue "${id}"`);

  issues.push(...checkRelaxedReachability(bp));

  if (issues.length) throw new BlueprintValidationError(issues);
  return bp;
}

/**
 * Relaxed solvability: ignores time, negation, and character/object state, and
 * asks only whether the positive clue/item/flag/fact prerequisites can ever be
 * satisfied. Catches prerequisite cycles and dead ends. It does NOT prove that a
 * solution fits inside the time budget; that is covered by scripted playthrough tests.
 */
export function checkRelaxedReachability(bp) {
  const have = { clue: new Set(), item: new Set(), flag: new Set(), fact: new Set() };
  const unlockedActions = new Set();
  const reachableLocations = new Set([bp.startLocationId]);
  const lockedLocations = new Set(bp.locations.filter((l) => l.lockedByDefault).map((l) => l.id));
  const unlockedLocations = new Set();

  const satisfiable = (tokens) =>
    tokens.every((t) => {
      const p = parsePrerequisite(t);
      if (!p || p.negated) return true;
      return have[p.kind] ? have[p.kind].has(p.value) : true;
    });

  const grant = (effects) => {
    let changed = false;
    const add = (set, v) => { if (!set.has(v)) { set.add(v); changed = true; } };
    for (const e of effects) {
      if (e.type === 'discover_clue') add(have.clue, e.clueId);
      else if (e.type === 'add_item') add(have.item, e.itemId);
      else if (e.type === 'set_flag') add(have.flag, e.flag);
      else if (e.type === 'confirm_fact') add(have.fact, e.factId);
      else if (e.type === 'unlock_action') add(unlockedActions, e.actionId);
      else if (e.type === 'unlock_location') add(unlockedLocations, e.locationId);
    }
    return changed;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const a of bp.actions) {
      const placeOk = a.locationId === '*' || reachableLocations.has(a.locationId);
      const unlockedOk = !a.lockedByDefault || unlockedActions.has(a.id);
      if (!placeOk || !unlockedOk || !satisfiable(a.prerequisites)) continue;
      if (a.type === 'travel' && a.destinationId) {
        const open = !lockedLocations.has(a.destinationId) || unlockedLocations.has(a.destinationId);
        if (open && !reachableLocations.has(a.destinationId)) { reachableLocations.add(a.destinationId); changed = true; }
      }
      if (grant(a.effects)) changed = true;
    }
    for (const e of bp.events) {
      if (satisfiable(e.conditions) && grant(e.effects)) changed = true;
    }
  }

  const issues = [];
  for (const a of bp.actions) {
    if (a.locationId !== '*' && !reachableLocations.has(a.locationId)) issues.push(`action "${a.id}" is in a location the player can never reach`);
  }
  for (const c of bp.clues) {
    if (!have.clue.has(c.id)) issues.push(`clue "${c.id}" is unreachable (prerequisite cycle or dead end)`);
  }
  const winnable = bp.winConditions.some((w) => satisfiable(w.conditions));
  if (!winnable) issues.push('no win condition can be satisfied (prerequisite cycle or dead end)');
  return issues;
}
