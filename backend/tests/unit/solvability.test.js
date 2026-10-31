import { describe, it, expect } from 'vitest';
import { analyzeSolvability, solvabilityIssues } from '../../src/services/solvabilityService.js';
import { performAction } from '../../src/services/gameEngine.js';
import { resetLoop } from '../../src/services/loopResetService.js';
import { blueprint, newSession, NOW } from '../helpers.js';

const bp = blueprint();

describe('analyzeSolvability', () => {
  it('finds that the sample is solvable and returns a plan the real engine accepts', async () => {
    const r = await analyzeSolvability(bp);
    expect(r).toMatchObject({ solvable: true, exhausted: false });
    expect(r.minLoops).toBe(2); // solver-verified; the designed route takes 3-4 but a skilled player needs only 2
    // Replay the plan through the production engine, resetting between loops.
    let s = newSession(bp);
    r.plan.forEach((loopActions, i) => {
      for (const actionId of loopActions) s = performAction(bp, s, { actionId }, { now: NOW }).session;
      if (i < r.plan.length - 1) s = resetLoop(bp, s, { reason: 'manual', now: NOW }).session;
    });
    expect(s.status).toBe('completed');
    expect(s.currentLoop).toBe(r.minLoops);
  });

  it('reports unsolvable when the time budget makes the win impossible', async () => {
    const hard = structuredClone(bp);
    hard.events.find((e) => e.id === 'r7_trips').at = '20:46';
    const r = await analyzeSolvability(hard);
    expect(r).toMatchObject({ solvable: false, exhausted: false });
  });

  it('reports unsolvable when it needs more loops than allowed', async () => {
    const tight = structuredClone(bp);
    tight.maxLoops = 1;
    expect((await analyzeSolvability(tight)).solvable).toBe(false);
  });

  it('reports "exhausted" (unknown), never "solvable", when the search budget is hit', async () => {
    const r = await analyzeSolvability(bp, { maxNodes: 50 });
    expect(r).toMatchObject({ solvable: false, exhausted: true, plan: null });
  });

  it('can plan from existing knowledge (used for hints)', async () => {
    const start = newSession(bp).persistentState;
    start.discoveredClueIds = ['clue_unusual_alarm'];
    const r = await analyzeSolvability(bp, { startPersistent: start });
    expect(r.solvable).toBe(true);
    expect(r.plan[0][0]).toBe('go_control_to_engineering');
  });

  it('solvabilityIssues turns each failure mode into a message the model can act on', async () => {
    expect((await solvabilityIssues(bp)).issues).toEqual([]);
    expect((await solvabilityIssues(bp, { maxNodes: 50 })).issues[0]).toMatch(/too complex/);
    const hard = structuredClone(bp); hard.maxLoops = 1;
    expect((await solvabilityIssues(hard)).issues[0]).toMatch(/no sequence of legal actions/);
  });
});
