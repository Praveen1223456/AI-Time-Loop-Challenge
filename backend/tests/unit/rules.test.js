import { describe, it, expect } from 'vitest';
import { parseClock, formatClock, minutesBetween, addMinutesToClock, parsePrerequisite, allPrerequisitesMet, applyEffect } from '../../src/services/rules.js';
import { blueprint, newSession } from '../helpers.js';

describe('clock helpers', () => {
  it('round-trips HH:MM', () => {
    expect(parseClock('20:45')).toBe(1245);
    expect(formatClock(1245)).toBe('20:45');
    expect(formatClock(parseClock('00:05'))).toBe('00:05');
  });
  it('wraps minutes modulo 1440', () => {
    expect(formatClock(1440)).toBe('00:00');
    expect(formatClock(1455)).toBe('00:15');
  });
  it('rejects malformed times', () => {
    for (const bad of ['24:00', '9:5', '20:60', 'abc', '', null]) expect(parseClock(bad)).toBeNull();
  });
  it('computes forward minutesBetween correctly across midnight', () => {
    expect(minutesBetween('11:45', '12:00')).toBe(15);
    expect(minutesBetween('23:45', '00:00')).toBe(15);
    expect(minutesBetween('23:50', '00:10')).toBe(20);
    expect(minutesBetween('00:00', '00:15')).toBe(15);
    expect(minutesBetween('12:00', '12:00')).toBe(0);
    expect(minutesBetween('bad', '12:00')).toBeNull();
  });
  it('adds minutes to clock correctly across midnight', () => {
    expect(addMinutesToClock('11:45', 15)).toBe('12:00');
    expect(addMinutesToClock('23:45', 15)).toBe('00:00');
    expect(addMinutesToClock('23:50', 20)).toBe('00:10');
  });
});

describe('parsePrerequisite', () => {
  it('parses every supported kind, with and without negation', () => {
    expect(parsePrerequisite('clue:a_b')).toEqual({ kind: 'clue', value: 'a_b', negated: false });
    expect(parsePrerequisite('!flag:x_y')).toEqual({ kind: 'flag', value: 'x_y', negated: true });
    expect(parsePrerequisite('char:reyes@engineering_bay')).toMatchObject({ kind: 'char', characterId: 'reyes', locationId: 'engineering_bay' });
    expect(parsePrerequisite('object:main_breaker=open')).toMatchObject({ kind: 'object', objectId: 'main_breaker', state: 'open' });
    expect(parsePrerequisite('time_before:20:55')).toMatchObject({ kind: 'time_before', minutes: 1255 });
  });
  it('returns null for anything not allowlisted or malformed', () => {
    for (const bad of ['eval:1+1', 'clue:', ':x', 'char:a', 'object:a', 'time_before:99:99', 'clue', 42, undefined]) {
      expect(parsePrerequisite(bad)).toBeNull();
    }
  });
});

describe('allPrerequisitesMet', () => {
  it('evaluates against session state and fails closed on bad tokens', () => {
    const s = newSession();
    expect(allPrerequisitesMet(['loc:control_room', 'char:okoye@control_room', '!item:maintenance_keycard'], s)).toBe(true);
    expect(allPrerequisitesMet(['clue:clue_unusual_alarm'], s)).toBe(false);
    expect(allPrerequisitesMet(['time_before:20:50', 'time_at_or_after:20:45'], s)).toBe(true);
    expect(allPrerequisitesMet(['totally_unknown:thing'], s)).toBe(false);
    expect(allPrerequisitesMet([], s)).toBe(true);
  });
});

describe('applyEffect', () => {
  it('refuses effect types outside the allowlist', () => {
    const s = newSession();
    expect(() => applyEffect({ type: 'set_loop_counter', value: 99 }, s, blueprint(), { log() {} })).toThrow(/Unsupported effect/);
    expect(s.currentLoop).toBe(1);
  });
});
