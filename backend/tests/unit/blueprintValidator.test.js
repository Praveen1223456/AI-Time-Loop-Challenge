import { describe, it, expect } from 'vitest';
import { validateBlueprint, BlueprintValidationError } from '../../src/services/blueprintValidator.js';
import { sampleScenario } from '../../src/data/sampleScenario.js';
import { addMinutesToClock } from '../../src/services/rules.js';

const clone = () => structuredClone(sampleScenario);
const issuesFor = (bp) => {
  try { validateBlueprint(bp); } catch (e) {
    expect(e).toBeInstanceOf(BlueprintValidationError);
    return e.issues.join(' | ');
  }
  throw new Error('expected validation to fail');
};

describe('validateBlueprint', () => {
  it('accepts the hand-authored sample scenario', () => {
    expect(() => validateBlueprint(sampleScenario)).not.toThrow();
  });

  it('rejects unknown effect types (allowlist)', () => {
    const bp = clone();
    bp.actions[0].effects.push({ type: 'set_loop_counter', value: 9 });
    expect(issuesFor(bp)).toMatch(/effects/);
  });

  it('rejects effects with extra keys', () => {
    const bp = clone();
    bp.actions[0].effects = [{ type: 'discover_clue', clueId: 'clue_unusual_alarm', sneaky: true }];
    expect(issuesFor(bp)).toMatch(/effects|sneaky|Unrecognized/i);
  });

  it('detects unresolved references', () => {
    const bp = clone();
    bp.actions[0].effects = [{ type: 'discover_clue', clueId: 'clue_does_not_exist' }];
    expect(issuesFor(bp)).toMatch(/unknown clue/);

    const bp2 = clone();
    bp2.startLocationId = 'nowhere';
    expect(issuesFor(bp2)).toMatch(/startLocationId/);

    const bp3 = clone();
    bp3.actions.find((a) => a.id === 'go_control_to_engineering').destinationId = 'nowhere';
    expect(issuesFor(bp3)).toMatch(/destinationId/);

    const bp4 = clone();
    bp4.characters[0].initialLocationId = 'nowhere';
    expect(issuesFor(bp4)).toMatch(/initialLocationId/);
  });

  it('detects unsupported or dangling prerequisites', () => {
    const bp = clone();
    bp.actions[0].prerequisites = ['eval:1+1'];
    expect(issuesFor(bp)).toMatch(/unsupported prerequisite/);

    const bp2 = clone();
    bp2.actions[0].prerequisites = ['item:ghost_item'];
    expect(issuesFor(bp2)).toMatch(/unknown item/);

    const bp3 = clone();
    bp3.actions[0].prerequisites = ['flag:never_set'];
    expect(issuesFor(bp3)).toMatch(/never set/);
  });

  it('detects duplicate ids', () => {
    const bp = clone();
    bp.clues.push({ ...bp.clues[0] });
    expect(issuesFor(bp)).toMatch(/duplicate clues id/);
  });

  it('detects impossible prerequisite cycles', () => {
    const bp = clone();
    // The only way to obtain the keycard now requires already holding it.
    bp.actions.find((a) => a.id === 'talk_engineer_about_alarm').prerequisites.push('item:maintenance_keycard');
    const issues = issuesFor(bp);
    expect(issues).toMatch(/unreachable|cycle|no win condition/);
  });

  it('detects locks that nothing can open', () => {
    const bp = clone();
    bp.actions.find((a) => a.id === 'inspect_maintenance_log').effects = [{ type: 'discover_clue', clueId: 'clue_patch_log' }];
    expect(issuesFor(bp)).toMatch(/lockedByDefault but nothing unlocks/);
  });

  it('detects clues that can never be discovered', () => {
    const bp = clone();
    bp.actions.find((a) => a.id === 'inspect_relay_r7').effects = [];
    expect(issuesFor(bp)).toMatch(/can never be discovered/);
  });

  it('enforces quality minimums', () => {
    const bp = clone();
    bp.characters = bp.characters.slice(0, 2);
    expect(issuesFor(bp)).toMatch(/at least 3 characters/);
  });

  describe('timeline validation', () => {
    function setTimeline(bp, initialTime, loopEndTime, loopLength) {
      bp.initialTime = initialTime;
      bp.loopEndTime = loopEndTime;
      bp.loopLength = loopLength;
      bp.events = [
        { id: 'reyes_leaves', at: addMinutesToClock(initialTime, 4), description: 'leaves', conditions: [], effects: [] },
        { id: 'r7_trips', at: addMinutesToClock(initialTime, 10), description: 'trips', conditions: [], effects: [{ type: 'set_flag', flag: 'r7_tripped' }] },
        { id: 'bus_surge', at: addMinutesToClock(initialTime, 10), description: 'surge', conditions: [], effects: [{ type: 'set_flag', flag: 'bus_surge_occurred' }] },
        { id: 'blackout', at: loopEndTime, description: 'blackout', conditions: [], effects: [{ type: 'set_flag', flag: 'blackout_occurred' }] },
      ];
    }

    it('accepts valid daytime and cross-midnight timelines', () => {
      const bpDay = clone();
      setTimeline(bpDay, '11:45', '12:00', 15);
      expect(() => validateBlueprint(bpDay)).not.toThrow();

      const bpMidnight = clone();
      setTimeline(bpMidnight, '23:45', '00:00', 15);
      expect(() => validateBlueprint(bpMidnight)).not.toThrow();

      const bpMorning = clone();
      setTimeline(bpMorning, '23:50', '00:10', 20);
      expect(() => validateBlueprint(bpMorning)).not.toThrow();

      const bpMidnightStart = clone();
      setTimeline(bpMidnightStart, '00:00', '00:15', 15);
      expect(() => validateBlueprint(bpMidnightStart)).not.toThrow();
    });

    it('rejects end times equal to start times', () => {
      const bp = clone();
      bp.initialTime = '12:00';
      bp.loopEndTime = '12:00';
      expect(issuesFor(bp)).toMatch(/loopEndTime must be later than initialTime/);

      const bpMid = clone();
      bpMid.initialTime = '00:00';
      bpMid.loopEndTime = '00:00';
      expect(issuesFor(bpMid)).toMatch(/loopEndTime must be later than initialTime/);
    });

    it('rejects end times earlier than start times', () => {
      const bp = clone();
      bp.initialTime = '12:00';
      bp.loopEndTime = '11:45';
      bp.loopLength = 15;
      expect(issuesFor(bp)).toMatch(/loopEndTime must be later than initialTime/);

      const bp2 = clone();
      bp2.initialTime = '15:00';
      bp2.loopEndTime = '14:00';
      bp2.loopLength = 60;
      expect(issuesFor(bp2)).toMatch(/loopEndTime must be later than initialTime/);
    });

    it('rejects events scheduled at or before initialTime', () => {
      const bpAtStart = clone();
      bpAtStart.events[0].at = bpAtStart.initialTime;
      expect(issuesFor(bpAtStart)).toMatch(/must be after initialTime and no later than loopEndTime/);

      const bpBeforeStart = clone();
      bpBeforeStart.events[0].at = '20:40';
      expect(issuesFor(bpBeforeStart)).toMatch(/must be after initialTime and no later than loopEndTime/);
    });

    it('rejects events scheduled after loopEndTime', () => {
      const bp = clone();
      bp.events[0].at = '21:01';
      expect(issuesFor(bp)).toMatch(/must be after initialTime and no later than loopEndTime/);

      const bp2 = clone();
      bp2.events[0].at = '21:30';
      expect(issuesFor(bp2)).toMatch(/must be after initialTime and no later than loopEndTime/);
    });

    it('validates events correctly across midnight', () => {
      const bp = clone();
      setTimeline(bp, '23:45', '00:00', 15);
      expect(() => validateBlueprint(bp)).not.toThrow();

      // Event at midnight is valid (it is loopEndTime)
      bp.events[3].at = '00:00';
      expect(() => validateBlueprint(bp)).not.toThrow();

      // Event at 23:55 is valid
      bp.events[3].at = '23:55';
      expect(() => validateBlueprint(bp)).not.toThrow();

      // Event before initialTime (23:40) is rejected
      const bpBefore = clone();
      setTimeline(bpBefore, '23:45', '00:00', 15);
      bpBefore.events[0].at = '23:40';
      expect(issuesFor(bpBefore)).toMatch(/must be after initialTime and no later than loopEndTime/);

      // Event after loopEndTime (00:05) is rejected
      const bpAfter = clone();
      setTimeline(bpAfter, '23:45', '00:00', 15);
      bpAfter.events[3].at = '00:05';
      expect(issuesFor(bpAfter)).toMatch(/must be after initialTime and no later than loopEndTime/);
    });
  });

  it('validates the time window and event times', () => {
    const bp = clone();
    bp.loopLength = 99;
    expect(issuesFor(bp)).toMatch(/loopLength/);

    const bp2 = clone();
    bp2.events[0].at = '21:30';
    expect(issuesFor(bp2)).toMatch(/event "reyes_leaves"/);
  });

  it('checks ending consistency', () => {
    const bp = clone();
    bp.winConditions[0].endingId = 'ending_panic_shutdown';
    expect(issuesFor(bp)).toMatch(/victory ending/);

    const bp2 = clone();
    bp2.loopLimitEndingId = 'ending_missing';
    expect(issuesFor(bp2)).toMatch(/loopLimitEndingId/);
  });

  it('rejects unknown top-level fields (AI cannot smuggle extra data)', () => {
    const bp = clone();
    bp.adminOverride = true;
    expect(issuesFor(bp)).toMatch(/adminOverride|Unrecognized/i);
  });
});
