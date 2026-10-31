import { describe, it, expect } from 'vitest';
import { resetLoop, buildRecap } from '../../src/services/loopResetService.js';
import { performAction, getAvailableActions } from '../../src/services/gameEngine.js';
import {
  blueprint, newSession, play, reset, expectRejected, NOW, LOOP1_EXPLORE, READ_LOG,
} from '../helpers.js';

const bp = blueprint();

describe('loop reset restores temporary state (AC-06)', () => {
  const afterLoop1 = () => play(bp, newSession(bp), LOOP1_EXPLORE);
  const s2 = () => reset(bp, afterLoop1());

  it('restores time, location, turn count, characters, objects, flags and inventory', () => {
    const before = play(bp, newSession(bp), ['inspect_control_panel', ...READ_LOG.slice(0, 2)]); // keycard in inventory
    expect(before.temporaryState.inventory).toContain('maintenance_keycard');
    const after = reset(bp, before);
    expect(after.currentLoop).toBe(2);
    expect(after.currentTime).toBe('20:45');
    expect(after.currentLocationId).toBe('control_room');
    expect(after.turnCount).toBe(0);
    expect(after.loopExpired).toBe(false);
    expect(after.temporaryState.inventory).not.toContain('maintenance_keycard');
    expect(after.temporaryState.loopFlags).toEqual([]);
    expect(after.temporaryState.characterLocations.reyes).toBe('engineering_bay');
    expect(after.temporaryState.objectStates).toEqual({ main_breaker: 'closed' });
  });

  it('un-does world changes caused by events (moved characters, tripped relay, blackout)', () => {
    let s = newSession(bp);
    for (let i = 0; i < 15; i++) s = play(bp, s, ['wait_one_minute']);
    expect(s.temporaryState.characterLocations.reyes).toBe('reactor_hall');
    expect(s.temporaryState.objectStates.main_breaker).toBe('open');
    const next = reset(bp, s);
    expect(next.temporaryState.characterLocations.reyes).toBe('engineering_bay');
    expect(next.temporaryState.objectStates.main_breaker).toBe('closed');
    expect(next.temporaryState.loopFlags).toEqual([]);
  });

  it('clears loop-scoped clues but keeps persistent ones', () => {
    const before = afterLoop1();
    expect(before.temporaryState.loopFlags).toContain('clue:clue_temp_reading');
    const after = reset(bp, before);
    expect(after.temporaryState.loopFlags).not.toContain('clue:clue_temp_reading');
    const known = bp.clues.filter((c) => after.persistentState.discoveredClueIds.includes(c.id)).map((c) => c.id);
    expect(known).not.toContain('clue_temp_reading');
    expect(known).toContain('clue_relay_scorch');
  });

  it('allows events to fire again in the new loop', () => {
    const next = s2();
    const again = play(bp, next, ['wait_one_minute', 'wait_one_minute', 'wait_one_minute', 'wait_one_minute', 'wait_one_minute']); // 20:50
    expect(again.temporaryState.characterLocations.reyes).toBe('reactor_hall');
  });
});

describe('persistent knowledge survives reset (AC-07)', () => {
  it('keeps clues, facts, unlocked actions and unlocked locations', () => {
    const before = play(bp, newSession(bp), ['inspect_control_panel', 'inspect_status_board', ...READ_LOG]);
    const after = reset(bp, before);
    expect(after.persistentState).toEqual(before.persistentState);
    expect(after.persistentState.unlockedActionIds).toContain('interact_reset_relay');
    expect(after.persistentState.unlockedLocationIds).toContain('maintenance_corridor');
    expect(after.persistentState.confirmedFacts).toEqual(expect.arrayContaining(['fact_blackout_at_2100', 'fact_cutoff_disabled']));
  });

  it('keeps explicitly persistent items and drops temporary ones', () => {
    const before = play(bp, newSession(bp), ['inspect_control_panel', 'take_field_notebook', 'go_control_to_engineering', 'talk_engineer_about_alarm']);
    expect(before.temporaryState.inventory).toEqual(expect.arrayContaining(['field_notebook', 'maintenance_keycard']));
    const after = reset(bp, before);
    expect(after.temporaryState.inventory).toEqual(['field_notebook']); // keycard (temporary) gone, notebook (persistent) kept
    expect(after.persistentState.persistentItemIds).toEqual(['field_notebook']);
  });

  it('knowledge changes what is possible in the next loop (the core promise)', () => {
    const loop1 = play(bp, newSession(bp), ['inspect_control_panel', 'go_control_to_engineering']);
    const loop2 = reset(bp, loop1);
    const atBay = play(bp, loop2, ['go_control_to_engineering']);
    const ids = getAvailableActions(bp, atBay).map((a) => a.id);
    expect(ids).toContain('talk_engineer_about_alarm'); // only available because loop 1 taught us about the alarm
    expect(ids).not.toContain('talk_engineer_generic');
  });

  it('an unlocked action stays locked-out of reach until its other prerequisites hold', () => {
    const before = play(bp, newSession(bp), ['inspect_control_panel', ...READ_LOG]);
    const after = reset(bp, before);
    const atReactor = play(bp, after, ['go_control_to_reactor']);
    // Unlocked persistently, but the keycard (temporary) is gone, so it is not available.
    expect(getAvailableActions(bp, atReactor).map((a) => a.id)).not.toContain('interact_reset_relay');
  });
});

describe('loop counter and reset rules', () => {
  it('increments only through reset, one at a time', () => {
    let s = newSession(bp);
    s = play(bp, s, ['wait_one_minute', 'inspect_control_panel']);
    expect(s.currentLoop).toBe(1);
    s = reset(bp, s);
    expect(s.currentLoop).toBe(2);
    s = reset(bp, s);
    expect(s.currentLoop).toBe(3);
  });

  it('manual reset is blocked when the scenario forbids it, but allowed after time expires', () => {
    const strict = structuredClone(bp);
    strict.reset.allowManualReset = false;
    const s = newSession(strict);
    expectRejected(() => resetLoop(strict, s, { reason: 'manual', now: NOW }), 'RESET_NOT_ALLOWED', 409);
    let expired = s;
    for (let i = 0; i < 15; i++) expired = performAction(strict, expired, { actionId: 'wait_one_minute' }, { now: NOW }).session;
    expect(resetLoop(strict, expired, { reason: 'manual', now: NOW }).session.currentLoop).toBe(2);
  });

  it("rejects reason 'time_expired' when time has not run out", () => {
    expectRejected(() => resetLoop(bp, newSession(bp), { reason: 'time_expired', now: NOW }), 'RESET_NOT_ALLOWED', 409);
  });

  it('records the effective reason (time_expired wins over manual)', () => {
    let s = newSession(bp);
    for (let i = 0; i < 15; i++) s = play(bp, s, ['wait_one_minute']);
    const { recap } = resetLoop(bp, s, { reason: 'manual', now: NOW });
    expect(recap.endedBy).toBe('time_expired');
  });

  it('does not mutate its input', () => {
    const s = play(bp, newSession(bp), ['inspect_control_panel']);
    const snapshot = structuredClone(s);
    resetLoop(bp, s, { reason: 'manual', now: NOW });
    expect(s).toEqual(snapshot);
  });

  it('ends the game as a loop-limit failure after the final loop', () => {
    let s = newSession(bp);
    for (let loop = 1; loop < bp.maxLoops; loop++) s = reset(bp, s);
    expect(s.currentLoop).toBe(bp.maxLoops);
    expect(s.status).toBe('active');
    const last = resetLoop(bp, s, { reason: 'manual', now: NOW }).session;
    expect(last.status).toBe('failed');
    expect(last.endingId).toBe('ending_lost_in_the_loop');
    expect(last.currentLoop).toBe(bp.maxLoops); // never exceeds the limit
    expectRejected(() => resetLoop(bp, last, { reason: 'manual', now: NOW }), 'GAME_NOT_ACTIVE', 409);
  });

  it('cannot reset a finished game', () => {
    const won = play(bp, newSession(bp), ['go_control_to_reactor', 'interact_emergency_shutdown']);
    expectRejected(() => resetLoop(bp, won, { reason: 'manual', now: NOW }), 'GAME_NOT_ACTIVE', 409);
  });
});

describe('loop recap and event log (AC-08)', () => {
  it('summarizes what was learned from recorded events only', () => {
    const s = play(bp, newSession(bp), ['inspect_control_panel', 'inspect_status_board', 'go_control_to_reactor', 'inspect_relay_r7']);
    const recap = buildRecap(bp, s, 'manual');
    expect(recap.loop).toBe(1);
    expect(recap.cluesDiscovered.map((c) => c.id)).toEqual(['clue_unusual_alarm', 'clue_blackout_time', 'clue_relay_scorch']);
    expect(recap.cluesDiscovered[0].title).toBe('The silenced alarm');
    expect(recap.factsConfirmed).toHaveLength(1);
    expect(recap.turnsTaken).toBe(4);
  });

  it('the recap of a later loop only lists what is new in that loop', () => {
    let s = play(bp, newSession(bp), ['inspect_control_panel']);
    s = reset(bp, s);
    s = play(bp, s, ['inspect_control_panel', 'inspect_status_board']); // alarm already known
    const recap = buildRecap(bp, s, 'manual');
    expect(recap.loop).toBe(2);
    expect(recap.cluesDiscovered.map((c) => c.id)).toEqual(['clue_blackout_time']);
  });

  it('keeps one continuous log across loops, tagged with loop numbers', () => {
    let s = play(bp, newSession(bp), ['inspect_control_panel']);
    s = reset(bp, s);
    s = play(bp, s, ['inspect_status_board']);
    expect([...new Set(s.eventLog.map((e) => e.loop))]).toEqual([1, 2]);
    const types = s.eventLog.map((e) => e.eventType);
    expect(types).toContain('loop_reset');
    expect(types).toContain('loop_started');
    expect(s.lastRecap.loop).toBe(1);
  });
});
