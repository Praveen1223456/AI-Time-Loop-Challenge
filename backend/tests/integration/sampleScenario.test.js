/**
 * Proves the hand-authored sample is completable, that it genuinely needs knowledge
 * carried across loops, and that every loop resets temporary state while keeping
 * explicitly persistent discoveries. Uses the real engine, no mocks.
 */
import { describe, it, expect } from 'vitest';
import { performAction, getAvailableActions } from '../../src/services/gameEngine.js';
import { buildEnding } from '../../src/services/endingService.js';
import {
  blueprint, newSession, play, reset, expectRejected, NOW,
  LOOP1_EXPLORE, GET_KEYCARD, READ_LOG, FINAL_RUN,
} from '../helpers.js';

const bp = blueprint();
const availableIds = (s) => getAvailableActions(bp, s).map((a) => a.id);

describe('sample scenario: full playthrough (spec example, 4 loops)', () => {
  it('loop 1 explore -> loop 2 question engineer -> loop 3 read log -> loop 4 win', () => {
    // Loop 1: explore and expire the loop naturally (blackout).
    let s = play(bp, newSession(bp), LOOP1_EXPLORE);
    expect(s.currentTime).toBe('20:55');
    for (let i = 0; i < 5; i++) s = play(bp, s, ['wait_one_minute']);
    expect(s.loopExpired).toBe(true);
    expect(s.temporaryState.objectStates.main_breaker).toBe('open');
    s = reset(bp, s, 'time_expired');
    expect(s.currentLoop).toBe(2);

    // Loop 2: the alarm clue from loop 1 unlocks the engineer's real dialogue.
    s = play(bp, s, GET_KEYCARD);
    expect(s.persistentState.discoveredClueIds).toContain('clue_r7_patch');
    expect(s.persistentState.unlockedLocationIds).toEqual(['maintenance_corridor']);
    expect(s.temporaryState.inventory).toContain('maintenance_keycard');
    s = reset(bp, s);
    expect(s.currentLoop).toBe(3);
    expect(s.temporaryState.inventory).not.toContain('maintenance_keycard'); // temporary item gone
    expect(s.persistentState.unlockedLocationIds).toEqual(['maintenance_corridor']); // unlock kept

    // Loop 3: restricted maintenance log (location persisted from loop 2, keycard must be re-earned).
    s = play(bp, s, READ_LOG);
    expect(s.persistentState.confirmedFacts).toContain('fact_cutoff_disabled');
    expect(s.persistentState.unlockedActionIds).toEqual(['interact_reset_relay']);
    s = reset(bp, s);
    expect(s.currentLoop).toBe(4);

    // Final loop: the correct sequence prevents the outage.
    s = play(bp, s, FINAL_RUN);
    expect(s.status).toBe('completed');
    expect(s.endingId).toBe('ending_lights_stay_on');
    expect(s.currentTime).toBe('20:54'); // before the 20:55 trip
    expect(s.temporaryState.loopFlags).not.toContain('flag:r7_tripped');
    expect(s.temporaryState.objectStates.main_breaker).toBe('closed');
    expect(s.currentLoop).toBe(4);

    // Ending explanation is grounded in what actually happened.
    const ending = buildEnding(bp, s);
    expect(ending.objectiveCompleted).toBe(true);
    expect(ending.loopsPlayed).toBe(4);
    expect(ending.keyCluesDiscovered.map((c) => c.id)).toEqual(expect.arrayContaining(['clue_unusual_alarm', 'clue_r7_patch', 'clue_patch_log']));
    expect(ending.timeline.filter((e) => e.eventType === 'loop_reset')).toHaveLength(3);
    expect(ending.causalChain.length).toBeGreaterThan(0);
    expectRejected(() => performAction(bp, s, { actionId: 'wait_one_minute' }, { now: NOW }), 'GAME_NOT_ACTIVE', 409);
  });

  it('is completable in 3 loops via the designed route', () => {
    let s = play(bp, newSession(bp), ['inspect_control_panel']);
    s = reset(bp, s);
    s = play(bp, s, READ_LOG); // loop 2: talk, corridor, read log
    s = reset(bp, s);
    s = play(bp, s, FINAL_RUN);
    expect(s.status).toBe('completed');
    expect(s.currentLoop).toBe(3);
  });

  it('a slow route fails: reading the log in loop 2 and walking back arrives after R-7 trips', () => {
    // NOTE: this proves ONE specific 2-loop route fails. It does NOT prove 2 loops are insufficient
    // (the solver shows a faster 2-loop route exists; see solvability.test.js).
    let s = play(bp, newSession(bp), ['inspect_control_panel']);
    s = reset(bp, s);
    s = play(bp, s, [...READ_LOG, 'go_corridor_to_engineering', 'go_engineering_to_reactor']); // arrives 20:57
    expect(s.temporaryState.loopFlags).toContain('flag:r7_tripped');
    expect(availableIds(s)).not.toContain('interact_reset_relay'); // unlocked, but too late
    expect(s.persistentState.unlockedActionIds).toContain('interact_reset_relay');
    expect(s.status).toBe('active');
  });

  it('cannot be won in loop 1 by any order of actions that looks plausible', () => {
    let s = play(bp, newSession(bp), ['go_control_to_engineering', 'talk_engineer_generic', 'go_engineering_to_reactor']);
    expect(availableIds(s)).not.toContain('interact_reset_relay');
    expectRejected(() => performAction(bp, s, { actionId: 'interact_reset_relay' }, { now: NOW }), 'INVALID_ACTION', 409);
    expect(s.status).toBe('active');
  });

  it('cannot skip the knowledge chain: the keycard needs the alarm clue', () => {
    const s = play(bp, newSession(bp), ['go_control_to_engineering']);
    expectRejected(() => performAction(bp, s, { actionId: 'talk_engineer_about_alarm' }, { now: NOW }), 'INVALID_ACTION', 409);
  });

  it('ends in the loop-limit failure if the player never solves it', () => {
    let s = newSession(bp);
    for (let loop = 1; loop <= bp.maxLoops; loop++) s = reset(bp, s);
    expect(s.status).toBe('failed');
    expect(s.endingId).toBe('ending_lost_in_the_loop');
    expect(buildEnding(bp, s).objectiveCompleted).toBe(false);
  });

  it('the ending is not available while the game is active', () => {
    expectRejected(() => buildEnding(bp, newSession(bp)), 'GAME_NOT_FINISHED', 409);
  });

  it('replaying the whole script yields an identical final state (determinism)', () => {
    const run = () => {
      let s = play(bp, newSession(bp), LOOP1_EXPLORE);
      s = reset(bp, s);
      s = play(bp, s, GET_KEYCARD); s = reset(bp, s);
      s = play(bp, s, READ_LOG); s = reset(bp, s);
      return play(bp, s, FINAL_RUN);
    };
    expect(run()).toEqual(run());
  });
});
