import { describe, it, expect } from 'vitest';
import { buildHint } from '../../src/services/hintService.js';
import { blueprint, newSession, play, reset, LOOP1_EXPLORE } from '../helpers.js';

const bp = blueprint();
const fresh = () => newSession(bp);
const knowsAlarm = () => reset(bp, play(bp, fresh(), ['inspect_control_panel']));

/** Every phrase a hint may quote comes from the blueprint (public names/labels + clues the player holds). */
const blueprintStrings = (b) => [
  ...b.locations.map((l) => l.name), ...b.characters.map((c) => c.name),
  ...b.clues.flatMap((c) => [c.title, c.description]), ...b.actions.map((a) => a.label),
];

describe('hint grounding', () => {
  it('level 1 points at a place or person from the blueprint, not a solution', async () => {
    expect((await buildHint(bp, fresh(), 1)).text).toBe('Something worth a closer look can be found at Control Room.');
    expect((await buildHint(bp, knowsAlarm(), 1)).text).toBe('You might learn something by speaking with Tomas Reyes.');
  });

  it('level 2 only ever quotes clues the player has already discovered', async () => {
    expect((await buildHint(bp, fresh(), 2)).text).toMatch(/no leads yet/i);
    const text = (await buildHint(bp, knowsAlarm(), 2)).text;
    expect(text).toContain('The silenced alarm');
    expect(text).toContain('An R7-TH alarm was silenced at 20:41.');
  });

  it('level 3 names a concrete next step using a real action label and place', async () => {
    expect((await buildHint(bp, fresh(), 3)).text).toBe('Next step: Inspect the control panel (at Control Room).');
    expect((await buildHint(bp, knowsAlarm(), 3)).text).toBe('Next step: Go to the Engineering Bay (at Control Room).');
  });

  it('level 3 advances as the player progresses within the loop', async () => {
    const atBay = play(bp, knowsAlarm(), ['go_control_to_engineering']);
    expect((await buildHint(bp, atBay, 3)).text).toBe('Next step: Ask Reyes about the silenced alarm (at Engineering Bay).');
  });

  it('never reveals undiscovered clue text or the private causal chain, at any level or state', async () => {
    const states = [fresh(), knowsAlarm(), play(bp, fresh(), LOOP1_EXPLORE)];
    for (const s of states) {
      const known = new Set(s.persistentState.discoveredClueIds);
      const secrets = [
        ...bp.solutionGuide.causalChain,
        ...bp.clues.filter((c) => !known.has(c.id)).map((c) => c.description),
        ...bp.facts.filter((f) => !s.persistentState.confirmedFacts.includes(f.id)).map((f) => f.text),
      ];
      for (const level of [1, 2, 3]) {
        const { text } = await buildHint(bp, s, level);
        for (const secret of secrets) expect(text, `L${level} leaked: ${secret}`).not.toContain(secret);
      }
    }
  });

  it('is built only from blueprint strings plus fixed phrasing (no invented content)', async () => {
    const allowed = blueprintStrings(bp);
    const FIXED = /^(Something worth a closer look can be found at |You might learn something by speaking with |Reconsider "|Next step: |You have no leads yet\. Examine your surroundings carefully\.)/;
    for (const s of [fresh(), knowsAlarm()]) {
      for (const level of [1, 2, 3]) {
        const { text } = await buildHint(bp, s, level);
        expect(text).toMatch(FIXED);
        if (!/no leads yet/.test(text)) expect(allowed.some((a) => text.includes(a)), text).toBe(true);
      }
    }
  });

  it('is deterministic and does not mutate the session', async () => {
    const s = knowsAlarm();
    const snapshot = structuredClone(s);
    const a = await buildHint(bp, s, 3);
    const b = await buildHint(bp, s, 3);
    expect(a).toEqual(b);
    expect(s).toEqual(snapshot);
  });

  it('falls back to a safe generic hint when no route exists', async () => {
    const stuck = structuredClone(bp); stuck.events.find((e) => e.id === 'r7_trips').at = '20:46';
    const r = await buildHint(stuck, newSession(stuck), 3);
    expect(r).toMatchObject({ grounded: false });
    expect(r.text).toMatch(/journal/);
  });
});
