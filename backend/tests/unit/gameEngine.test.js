import { describe, it, expect } from 'vitest';
import { performAction, getAvailableActions, createInitialSession, remainingMinutes } from '../../src/services/gameEngine.js';
import { blueprint, newSession, play, expectRejected, NOW } from '../helpers.js';

const bp = blueprint();
const ids = (s) => getAvailableActions(bp, s).map((a) => a.id);

describe('initial state (AC-02)', () => {
  it('starts at loop 1, initial time and location, with empty knowledge', () => {
    const s = newSession(bp);
    expect(s).toMatchObject({ status: 'active', currentLoop: 1, currentTime: '20:45', currentLocationId: 'control_room', turnCount: 0, stateVersion: 0, loopExpired: false });
    expect(s.persistentState.discoveredClueIds).toEqual([]);
    expect(s.temporaryState.characterLocations).toEqual({ okoye: 'control_room', reyes: 'engineering_bay', vance: 'maintenance_corridor' });
    expect(s.temporaryState.objectStates).toEqual({ main_breaker: 'closed' });
    expect(s.eventLog[0].eventType).toBe('game_started');
  });

  it('only offers actions valid for the starting state', () => {
    const available = ids(newSession(bp));
    expect(available).toContain('inspect_control_panel');
    expect(available).toContain('wait_one_minute');
    expect(available).not.toContain('interact_reset_relay'); // locked
    expect(available).not.toContain('talk_engineer_about_alarm'); // wrong location
    expect(available).not.toContain('go_engineering_to_corridor');
  });
});

describe('valid actions (AC-04)', () => {
  it('applies effects, advances time by the configured cost, and records the log', () => {
    const s0 = newSession(bp);
    const { session: s1, result } = performAction(bp, s0, { actionId: 'inspect_control_panel' }, { now: NOW });
    expect(s1.currentTime).toBe('20:46');
    expect(s1.turnCount).toBe(1);
    expect(s1.persistentState.discoveredClueIds).toEqual(['clue_unusual_alarm']);
    expect(result.narrative).toMatch(/R7-TH/);
    expect(result.entries.map((e) => e.eventType)).toEqual(['action', 'clue_discovered']);
    expect(s1.eventLog.map((e) => e.eventType)).toEqual(['game_started', 'action', 'clue_discovered']);
  });

  it('travel changes location and costs its configured time', () => {
    const s = play(bp, newSession(bp), ['go_control_to_reactor']);
    expect(s.currentLocationId).toBe('reactor_hall');
    expect(s.currentTime).toBe('20:48');
  });

  it('is deterministic: same actions from the same state give identical results', () => {
    const route = ['inspect_control_panel', 'go_control_to_engineering', 'talk_engineer_about_alarm'];
    const a = play(bp, newSession(bp), route);
    const b = play(bp, newSession(bp), route);
    expect(a).toEqual(b);
  });

  it('re-discovering a clue does not duplicate state or log entries', () => {
    const s1 = play(bp, newSession(bp), ['inspect_control_panel']);
    const s2 = play(bp, s1, ['inspect_control_panel']);
    expect(s2.persistentState.discoveredClueIds).toEqual(['clue_unusual_alarm']);
    expect(s2.eventLog.filter((e) => e.eventType === 'clue_discovered')).toHaveLength(1);
    expect(s2.currentTime).toBe('20:47'); // time still advanced
  });

  it('inspecting grants knowledge that unlocks new options (and retires old ones)', () => {
    let s = play(bp, newSession(bp), ['go_control_to_engineering']);
    expect(ids(s)).toContain('talk_engineer_generic');
    expect(ids(s)).not.toContain('talk_engineer_about_alarm');
    s = play(bp, newSession(bp), ['inspect_control_panel', 'go_control_to_engineering']);
    expect(ids(s)).toContain('talk_engineer_about_alarm');
    expect(ids(s)).not.toContain('talk_engineer_generic');
  });
});

describe('invalid actions never mutate state (AC-03)', () => {
  const cases = [
    ['unknown action', { actionId: 'does_not_exist' }, 'INVALID_ACTION', 400],
    ['target mismatch', { actionId: 'inspect_control_panel', targetId: 'status_board' }, 'INVALID_ACTION', 400],
    ['action in another location', { actionId: 'inspect_relay_r7' }, 'INVALID_ACTION', 409],
    ['unmet knowledge prerequisite (needs a clue from an earlier loop)', { actionId: 'talk_engineer_about_alarm' }, 'INVALID_ACTION', 409],
  ];

  for (const [name, request, code, status] of cases) {
    it(name, () => {
      const s = newSession(bp);
      const snapshot = structuredClone(s);
      expectRejected(() => performAction(bp, s, request, { now: NOW }), code, status);
      expect(s).toEqual(snapshot); // input untouched
    });
  }

  it('rejects locked actions until unlocked', () => {
    const s = play(bp, newSession(bp), ['go_control_to_reactor']);
    const snapshot = structuredClone(s);
    expectRejected(() => performAction(bp, s, { actionId: 'interact_reset_relay' }, { now: NOW }), 'INVALID_ACTION', 409);
    expect(s).toEqual(snapshot);
  });

  it('rejects travel to a locked location', () => {
    const s = play(bp, newSession(bp), ['go_control_to_engineering']);
    expectRejected(() => performAction(bp, s, { actionId: 'go_engineering_to_corridor' }, { now: NOW }), 'INVALID_ACTION', 409);
  });

  it('rejects an action whose time cost exceeds the remaining time, without mutation', () => {
    // 20:45 -> 20:57 via waits would trigger events; instead burn time with cheap actions to 20:59.
    let s = newSession(bp);
    for (let i = 0; i < 14; i++) s = play(bp, s, ['wait_one_minute']); // 20:59, after r7/bus events
    expect(s.currentTime).toBe('20:59');
    const snapshot = structuredClone(s);
    expectRejected(() => performAction(bp, s, { actionId: 'talk_director' }, { now: NOW }), 'INSUFFICIENT_TIME', 409);
    expect(s).toEqual(snapshot);
  });

  it('does not reveal why an action is unavailable', () => {
    try {
      performAction(bp, newSession(bp), { actionId: 'talk_engineer_about_alarm' }, { now: NOW });
    } catch (e) {
      expect(e.message).toBe('That action is not available in the current state.');
      expect(e.message).not.toMatch(/clue|keycard|prerequisite/i);
    }
  });
});

describe('time progression and scheduled events (AC-05)', () => {
  it('fires an event when an action crosses its time, and only then', () => {
    let s = play(bp, newSession(bp), ['go_control_to_engineering', 'talk_engineer_generic']); // 20:49
    expect(s.temporaryState.characterLocations.reyes).toBe('engineering_bay');
    s = play(bp, s, ['wait_one_minute']); // 20:50 -> reyes_leaves
    expect(s.currentTime).toBe('20:50');
    expect(s.temporaryState.characterLocations.reyes).toBe('reactor_hall');
    expect(s.eventLog.some((e) => e.eventType === 'event_triggered' && e.refId === 'reyes_leaves')).toBe(true);
  });

  it('time-gates dialogue: the engineer cannot be questioned after he leaves', () => {
    const s = play(bp, newSession(bp), ['inspect_control_panel', 'go_control_to_engineering', 'wait_one_minute', 'wait_one_minute']); // 20:50
    expect(ids(s)).not.toContain('talk_engineer_about_alarm');
  });

  it('fires events fully crossed within a single long action, in time order', () => {
    // A 3-minute travel from 20:49 to 20:52 crosses 20:50.
    let s = play(bp, newSession(bp), ['go_control_to_engineering', 'talk_engineer_generic']); // 20:49
    const r = performAction(bp, s, { actionId: 'go_engineering_to_reactor' }, { now: NOW });
    expect(r.session.currentTime).toBe('20:52');
    expect(r.result.entries.map((e) => e.eventType)).toContain('event_triggered');
    expect(r.session.temporaryState.characterLocations.reyes).toBe('reactor_hall');
  });

  it('processes same-time events in declaration order (r7_trips before bus_surge)', () => {
    let s = newSession(bp);
    for (let i = 0; i < 10; i++) s = play(bp, s, ['wait_one_minute']); // reach 20:55
    const fired = s.eventLog.filter((e) => e.eventType === 'event_triggered').map((e) => e.refId);
    expect(fired).toEqual(['reyes_leaves', 'r7_trips', 'bus_surge']);
    expect(s.temporaryState.loopFlags).toContain('flag:bus_surge');
  });

  it('changing declaration order changes the outcome (proves ordering is rule-driven, not accidental)', () => {
    const swapped = structuredClone(bp);
    const i = swapped.events.findIndex((e) => e.id === 'r7_trips');
    const j = swapped.events.findIndex((e) => e.id === 'bus_surge');
    [swapped.events[i], swapped.events[j]] = [swapped.events[j], swapped.events[i]];
    let s = newSession(swapped);
    for (let k = 0; k < 10; k++) s = performAction(swapped, s, { actionId: 'wait_one_minute' }, { now: NOW }).session;
    expect(s.temporaryState.loopFlags).toContain('flag:r7_tripped');
    expect(s.temporaryState.loopFlags).not.toContain('flag:bus_surge'); // surge evaluated before the trip
  });

  it('respects event conditions: the relay does not trip if it was reset first', () => {
    // Engine-level check using a blueprint whose win condition is unreachable, so play continues to 20:55.
    const noWin = structuredClone(bp);
    noWin.winConditions = [{ id: 'w', endingId: 'ending_lights_stay_on', conditions: ['flag:never_set'] }];
    let s = newSession(noWin);
    s.temporaryState.loopFlags.push('flag:relay_reset'); // as if the relay had already been reset this loop
    for (let i = 0; i < 10; i++) s = performAction(noWin, s, { actionId: 'wait_one_minute' }, { now: NOW }).session;
    expect(s.currentTime).toBe('20:55');
    expect(s.temporaryState.loopFlags).not.toContain('flag:r7_tripped');
    expect(s.temporaryState.loopFlags).not.toContain('flag:bus_surge');
    expect(s.eventLog.some((e) => e.refId === 'r7_trips')).toBe(false);
  });

  it('log entries made by scheduled events are not attributed to the player action', () => {
    let s = play(bp, newSession(bp), ['go_control_to_engineering', 'talk_engineer_generic', 'wait_one_minute']);
    const evt = s.eventLog.find((e) => e.refId === 'reyes_leaves');
    expect(evt.actionId).toBeNull();
    expect(evt.gameTime).toBe('20:50');
  });

  it('orders events by game time even when declared out of chronological order', () => {
    const shuffled = structuredClone(bp);
    shuffled.events = [...shuffled.events].reverse(); // declared: 21:00, 20:55, 20:55, 20:50
    shuffled.actions.find((a) => a.id === 'go_control_to_reactor').timeCost = 12; // 20:45 -> 20:57 spans 20:50 and 20:55
    const r = performAction(shuffled, newSession(shuffled), { actionId: 'go_control_to_reactor' }, { now: NOW });
    const times = r.result.entries.filter((e) => e.eventType === 'event_triggered').map((e) => e.gameTime);
    expect(times[0]).toBe('20:50');
    expect(times.length).toBeGreaterThan(1);
    expect(times).toEqual([...times].sort());
  });

  it('a successful action does not mutate the caller\'s session either (pure function)', () => {
    const s = newSession(bp);
    const snapshot = structuredClone(s);
    const { session: next } = performAction(bp, s, { actionId: 'inspect_control_panel' }, { now: NOW });
    expect(s).toEqual(snapshot);
    expect(next).not.toBe(s);
    expect(next.persistentState).not.toBe(s.persistentState);
  });

  it('events fire at most once per loop', () => {
    let s = newSession(bp);
    for (let i = 0; i < 12; i++) s = play(bp, s, ['wait_one_minute']);
    expect(s.eventLog.filter((e) => e.refId === 'r7_trips')).toHaveLength(1);
  });
});

describe('loop expiry and outcomes (AC-10)', () => {
  const expire = () => { let s = newSession(bp); for (let i = 0; i < 15; i++) s = play(bp, s, ['wait_one_minute']); return s; };

  it('marks the loop expired at the end time, applies the blackout, and offers no actions', () => {
    const s = expire();
    expect(s.currentTime).toBe('21:00');
    expect(s.loopExpired).toBe(true);
    expect(s.status).toBe('active');
    expect(s.temporaryState.objectStates.main_breaker).toBe('open');
    expect(getAvailableActions(bp, s)).toEqual([]);
    expect(s.eventLog.at(-1).eventType).toBe('time_expired');
  });

  it('rejects further actions after expiry until reset', () => {
    expectRejected(() => performAction(bp, expire(), { actionId: 'wait_one_minute' }, { now: NOW }), 'LOOP_ENDED', 409);
  });

  it('a failure condition ends the game server-side', () => {
    const s = play(bp, newSession(bp), ['go_control_to_reactor', 'interact_emergency_shutdown']);
    expect(s.status).toBe('failed');
    expect(s.endingId).toBe('ending_panic_shutdown');
    expect(s.completedAt).toEqual(NOW);
    expectRejected(() => performAction(bp, s, { actionId: 'wait_one_minute' }, { now: NOW }), 'GAME_NOT_ACTIVE', 409);
  });

  it('victory is only reachable via validated state, not via any single input', () => {
    // Loop 1 knowledge only: the winning action is not even offered.
    const s = play(bp, newSession(bp), ['go_control_to_reactor']);
    expect(getAvailableActions(bp, s).map((a) => a.id)).not.toContain('interact_reset_relay');
    expect(s.status).toBe('active');
  });
});

describe('createInitialSession', () => {
  it('uses the injected clock for timestamps', () => {
    expect(createInitialSession(bp, { sessionId: 's', scenarioId: 'x', now: NOW }).startedAt).toEqual(NOW);
  });
});

describe('cross-midnight gameplay', () => {
  it('advances time, calculates remainingMinutes, fires events, and expires at midnight', () => {
    const midBp = structuredClone(bp);
    midBp.initialTime = '23:45';
    midBp.loopEndTime = '00:00';
    midBp.loopLength = 15;
    midBp.events = [
      { id: 'midnight_crash', at: '00:00', description: 'Train crashes at midnight.', conditions: [], effects: [{ type: 'set_flag', flag: 'crashed' }] },
    ];

    let s = createInitialSession(midBp, { sessionId: 's', scenarioId: 'x', now: NOW });
    expect(s.currentTime).toBe('23:45');
    expect(remainingMinutes(midBp, s)).toBe(15);
    expect(s.loopExpired).toBe(false);

    for (let i = 0; i < 10; i++) {
      s = performAction(midBp, s, { actionId: 'wait_one_minute' }, { now: NOW }).session;
    }
    expect(s.currentTime).toBe('23:55');
    expect(remainingMinutes(midBp, s)).toBe(5);
    expect(s.loopExpired).toBe(false);
    expect(s.temporaryState.loopFlags).not.toContain('event:midnight_crash');

    for (let i = 0; i < 5; i++) {
      s = performAction(midBp, s, { actionId: 'wait_one_minute' }, { now: NOW }).session;
    }
    expect(s.currentTime).toBe('00:00');
    expect(remainingMinutes(midBp, s)).toBe(0);
    expect(s.loopExpired).toBe(true);
    expect(s.temporaryState.loopFlags).toContain('event:midnight_crash');
    expect(s.temporaryState.loopFlags).toContain('flag:crashed');
  });
});
