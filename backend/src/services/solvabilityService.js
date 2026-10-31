/**
 * Time-aware solvability analysis. Searches the REAL engine (same rules, same clock) so a
 * scenario is only "solvable" if an actual sequence of legal actions wins within maxLoops.
 *
 * Search structure:
 *   - within a loop: breadth-first over full game states (memoized), so the first win is the shortest;
 *   - across loops: breadth-first over distinct *persistent* states (what survives a reset).
 * Bounded by `maxNodes`; if the bound is hit the result is `exhausted` (unknown), never "solvable".
 * Async with periodic yields so a large search cannot starve the HTTP server.
 */
import { parseClock, minutesBetween } from './rules.js';
import { createInitialSession, getAvailableActions, performAction, freshTemporaryState } from './gameEngine.js';

const EPOCH = new Date(0);
const emptyPersistent = () => ({
  discoveredClueIds: [], unlockedActionIds: [], unlockedLocationIds: [],
  confirmedFacts: [], playerNotes: [], persistentItemIds: [],
});
const sorted = (a) => [...a].sort();
export const persistentKey = (p) => JSON.stringify([
  sorted(p.discoveredClueIds), sorted(p.unlockedActionIds), sorted(p.unlockedLocationIds),
  sorted(p.confirmedFacts), sorted(p.persistentItemIds),
]);
const sortedEntries = (o) => Object.keys(o).sort().map((k) => [k, o[k]]);
function stateKey(s) {
  const t = s.temporaryState;
  return [
    s.currentLocationId, s.currentTime, sorted(t.inventory).join(','), sorted(t.loopFlags).join(','),
    JSON.stringify(sortedEntries(t.characterLocations)), JSON.stringify(sortedEntries(t.objectStates)),
    persistentKey(s.persistentState),
  ].join('|');
}

/** Everything a reset preserves, as a flat token set (for subset/dominance tests). */
function knowledgeTokens(p) {
  return new Set([
    ...p.discoveredClueIds.map((x) => `c:${x}`), ...p.unlockedActionIds.map((x) => `a:${x}`),
    ...p.unlockedLocationIds.map((x) => `l:${x}`), ...p.confirmedFacts.map((x) => `f:${x}`),
    ...p.persistentItemIds.map((x) => `i:${x}`),
  ]);
}
const isSuperset = (big, small) => { for (const t of small) if (!big.has(t)) return false; return true; };

/** Same situation ignoring persistent knowledge AND the clock (the clock is compared separately). */
function envKey(s) {
  const t = s.temporaryState;
  return [
    s.currentLocationId, sorted(t.inventory).join(','), sorted(t.loopFlags).join(','),
    JSON.stringify(sortedEntries(t.characterLocations)), JSON.stringify(sortedEntries(t.objectStates)),
  ].join('|');
}

export function loopStart(bp, persistent) {
  const s = createInitialSession(bp, { sessionId: 'solver', scenarioId: 'solver', now: EPOCH });
  s.eventLog = [];
  s.persistentState = structuredClone(persistent);
  s.temporaryState = freshTemporaryState(bp, s.persistentState.persistentItemIds);
  return s;
}

const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

async function exploreLoop(bp, persistent, budget) {
  const start = loopStart(bp, persistent);
  const queue = [{ session: start, actions: [] }];
  // Dominance pruning: a state is skipped if another state in the SAME situation already holds
  // at least as much persistent knowledge. Only ever prunes (never invents a win), so the cost is
  // possible false rejections, not false approvals.
  // Time dominance too: an earlier-or-equal state with identical situation (same location, items, flags,
  // fired events, character/object states) and a superset of knowledge is at least as good. Heuristic:
  // it can reject an exotic scenario that needs to burn time to open a clock-only gate, never approve a bad one.
  const clock = (s) => minutesBetween(bp.initialTime, s.currentTime);
  const seenByEnv = new Map();
  const dominated = (session) => {
    const key = envKey(session);
    const tokens = knowledgeTokens(session.persistentState);
    const time = clock(session);
    const kept = seenByEnv.get(key) ?? [];
    if (kept.some((k) => k.time <= time && isSuperset(k.tokens, tokens))) return true;
    seenByEnv.set(key, [...kept.filter((k) => !(time <= k.time && isSuperset(tokens, k.tokens))), { time, tokens }]);
    return false;
  };
  dominated(start);
  const endStates = new Map(); // persistentKey -> { persistent, actions }
  const record = (session, actions) => {
    const key = persistentKey(session.persistentState);
    if (!endStates.has(key)) endStates.set(key, { persistent: structuredClone(session.persistentState), actions });
  };
  for (let head = 0; head < queue.length; head++) {
    if (budget.nodes >= budget.maxNodes) { budget.exhausted = true; break; }
    if (++budget.nodes % 500 === 0) await yieldToEventLoop();
    const { session, actions } = queue[head];
    if (bp.reset.allowManualReset || session.loopExpired) record(session, actions);
    if (session.loopExpired) continue;
    for (const a of getAvailableActions(bp, session)) {
      if (!a.affordable) continue;
      let next;
      try {
        next = performAction(bp, session, { actionId: a.id }, { now: EPOCH }).session;
      } catch { continue; }
      next.eventLog = [];
      const route = [...actions, a.id];
      if (next.status === 'completed') return { win: route, endStates, exhausted: false };
      if (next.status !== 'active') continue; // failure ending: dead branch
      if (dominated(next)) continue;
      queue.push({ session: next, actions: route });
    }
  }
  return { win: null, endStates, exhausted: budget.exhausted };
}

/**
 * @returns {Promise<{solvable: boolean, exhausted: boolean, minLoops: number|null, plan: string[][]|null, nodes: number}>}
 *   plan[i] is the action list to play in loop i+1 (the last entry ends in the winning action).
 */
export async function analyzeSolvability(bp, { startPersistent = emptyPersistent(), maxLoops = bp.maxLoops, maxNodes = 20000 } = {}) {
  const budget = { nodes: 0, maxNodes, exhausted: false };
  let frontier = [{ persistent: startPersistent, route: [] }];
  const seenPersistent = [knowledgeTokens(startPersistent)];
  for (let loop = 1; loop <= maxLoops && frontier.length; loop++) {
    const next = [];
    for (const { persistent, route } of frontier) {
      const res = await exploreLoop(bp, persistent, budget);
      if (res.win) return { solvable: true, exhausted: false, minLoops: loop, plan: [...route, res.win], nodes: budget.nodes };
      if (budget.exhausted) return { solvable: false, exhausted: true, minLoops: null, plan: null, nodes: budget.nodes };
      for (const end of res.endStates.values()) {
        const tokens = knowledgeTokens(end.persistent);
        if (seenPersistent.some((k) => isSuperset(k, tokens))) continue;
        seenPersistent.push(tokens);
        next.push({ persistent: end.persistent, route: [...route, end.actions] });
      }
    }
    frontier = next;
  }
  return { solvable: false, exhausted: false, minLoops: null, plan: null, nodes: budget.nodes };
}

/** Semantic issues derived from the analysis, in the same string form validateBlueprint uses. */
export async function solvabilityIssues(bp, options) {
  const result = await analyzeSolvability(bp, options);
  if (result.exhausted) return { result, issues: ['scenario is too complex to verify as solvable; simplify it (fewer actions/states)'] };
  if (!result.solvable) return { result, issues: [`no sequence of legal actions wins within ${bp.maxLoops} loops (check time costs, travel times, and event timing)`] };
  if (result.minLoops < 2) return { result, issues: ['scenario can be won in loop 1; it must require knowledge carried from an earlier loop'] };
  return { result, issues: [] };
}
