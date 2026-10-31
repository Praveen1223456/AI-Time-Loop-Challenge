/**
 * Grounded hints. Hints are COMPOSED, never generated: every word comes from the validated blueprint
 * (location/character names, clue titles + descriptions the player already holds, action labels) and the
 * route comes from the same deterministic solver the generator uses. Nothing here can add a fact,
 * a clue, or change the solution, and it never reads the private solution guide.
 *
 *   level 1: gentle direction toward a place or person
 *   level 2: a clue the player already has that deserves a second look
 *   level 3: the next concrete step
 */
import { analyzeSolvability, loopStart, persistentKey } from './solvabilityService.js';
import { performAction } from './gameEngine.js';
import { hasClue, parsePrerequisite } from './rules.js';

const EPOCH = new Date(0);
export const HINT_LEVELS = [1, 2, 3];

/** The first action of the route that teaches the player something new (or wins). */
function keyAction(bp, persistent, route) {
  let s = loopStart(bp, persistent);
  const before = persistentKey(s.persistentState);
  for (const id of route) {
    try { s = performAction(bp, s, { actionId: id }, { now: EPOCH }).session; } catch { break; }
    s.eventLog = [];
    if (s.status === 'completed' || persistentKey(s.persistentState) !== before) return id;
  }
  return route.at(-1);
}

export async function buildHint(bp, session, level, { maxNodes = 15000 } = {}) {
  const loc = (id) => bp.locations.find((l) => l.id === id);
  const act = (id) => bp.actions.find((a) => a.id === id);
  const remainingLoops = Math.max(1, bp.maxLoops - session.currentLoop + 1);
  const solved = await analyzeSolvability(bp, { startPersistent: session.persistentState, maxLoops: remainingLoops, maxNodes });
  const route = solved.plan?.[0];

  if (!route?.length) {
    return { level, grounded: false, text: 'Review your journal and think about what you have not yet explained.' };
  }
  const key = act(keyAction(bp, session.persistentState, route));

  if (level === 1) {
    const person = key.type === 'talk' ? bp.characters.find((c) => c.id === key.targetId) : null;
    const place = key.locationId === '*' ? null : loc(key.locationId);
    const text = person
      ? `You might learn something by speaking with ${person.name}.`
      : place ? `Something worth a closer look can be found at ${place.name}.`
        : 'Pay attention to how the minutes pass.';
    return { level, grounded: true, text };
  }

  if (level === 2) {
    const wanted = route
      .flatMap((id) => act(id).prerequisites.map(parsePrerequisite))
      .filter((p) => p && !p.negated && p.kind === 'clue')
      .map((p) => p.value);
    const known = wanted.find((id) => hasClue(session, id)) ?? [...session.persistentState.discoveredClueIds].reverse()[0];
    const clue = bp.clues.find((c) => c.id === known);
    return clue
      ? { level, grounded: true, text: `Reconsider "${clue.title}": ${clue.description}` }
      : { level, grounded: true, text: 'You have no leads yet. Examine your surroundings carefully.' };
  }

  const done = new Set(
    session.eventLog.filter((e) => e.loop === session.currentLoop && e.eventType === 'action').map((e) => e.refId),
  );
  const next = act(route.find((id) => !done.has(id)) ?? key.id);
  const place = next.locationId === '*' ? '' : ` (at ${loc(next.locationId).name})`;
  const deadline = next.prerequisites.map(parsePrerequisite).find((p) => p && !p.negated && p.kind === 'time_before');
  const by = deadline ? ` Do it before ${String(Math.floor(deadline.minutes / 60)).padStart(2, '0')}:${String(deadline.minutes % 60).padStart(2, '0')}.` : '';
  return { level, grounded: true, text: `Next step: ${next.label}${place}.${by}` };
}
