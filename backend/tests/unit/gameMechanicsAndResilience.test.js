import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { sanitizeDbUri } from '../../src/config/db.js';
import { createHealthRouter } from '../../src/routes/healthRoutes.js';
import { performAction, createInitialSession, remainingMinutes } from '../../src/services/gameEngine.js';
import { resetLoop } from '../../src/services/loopResetService.js';
import { buildHint, findTravelRoute } from '../../src/services/hintService.js';
import { createScenarioGenerator } from '../../src/services/scenarioGenerator.js';
import { blueprint, newSession, play, NOW } from '../helpers.js';

describe('database resilience and error masking', () => {
  it('sanitizeDbUri redacts credentials from Mongo connection URIs', () => {
    const raw = 'mongodb+srv://user:secretPassword123@cluster0.l8nibvl.mongodb.net/timeloop';
    const clean = sanitizeDbUri(raw);
    expect(clean).not.toContain('user:secretPassword123');
    expect(clean).toBe('mongodb+srv://<redacted>@cluster0.l8nibvl.mongodb.net/timeloop');
  });

  it('errorHandler maps MongoServerSelectionError to 503 DB_UNAVAILABLE', async () => {
    const app = express();
    app.get('/db-fail', (_req, _res, next) => {
      const err = new Error('getaddrinfo ENOTFOUND ac-shard-00-02.mongodb.net');
      err.name = 'MongoServerSelectionError';
      next(err);
    });
    app.use(errorHandler({ NODE_ENV: 'test' }));

    const res = await request(app).get('/db-fail');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'DB_UNAVAILABLE',
        message: 'Database service is temporarily unavailable. Please try again shortly.',
      },
    });
  });

  it('errorHandler maps network connection drops (ENOTFOUND / ECONNREFUSED) to 503', async () => {
    const app = express();
    app.get('/conn-fail', (_req, _res, next) => {
      const err = new Error('connect ECONNREFUSED 127.0.0.1:27017');
      err.code = 'ECONNREFUSED';
      next(err);
    });
    app.use(errorHandler({ NODE_ENV: 'test' }));

    const res = await request(app).get('/conn-fail');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DB_UNAVAILABLE');
  });

  it('health endpoint accurately reports 503 when async db status is disconnected', async () => {
    const app = express();
    app.use('/health', createHealthRouter({
      env: { NODE_ENV: 'test' },
      getDbStatus: async () => 'disconnected',
    }));

    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.data.status).toBe('degraded');
    expect(res.body.data.database.status).toBe('disconnected');
  });
});

describe('game mechanics: loop-end disaster events and resets', () => {
  it('an event at loopEndTime expires the loop rather than permanently failing the game on loop 1', () => {
    const bp = blueprint();
    bp.events.push({
      id: 'bomb_detonates',
      at: '21:00',
      description: 'The bomb explodes as time runs out.',
      conditions: [],
      effects: [{ type: 'set_flag', flag: 'bomb_exploded' }],
    });
    bp.failureConditions.push({
      id: 'fail_bomb',
      endingId: 'ending_panic_shutdown',
      conditions: ['flag:bomb_exploded'],
    });

    let s = newSession(bp);
    for (let i = 0; i < 15; i++) {
      s = performAction(bp, s, { actionId: 'wait_one_minute' }, { now: NOW }).session;
    }

    expect(s.currentTime).toBe('21:00');
    expect(s.loopExpired).toBe(true);
    expect(s.status).toBe('active');

    const { session: loop2, recap } = resetLoop(bp, s, { reason: 'time_expired', now: NOW });
    expect(loop2.currentLoop).toBe(2);
    expect(loop2.currentTime).toBe('20:45');
    expect(loop2.loopExpired).toBe(false);
    expect(loop2.status).toBe('active');
    expect(recap.endedBy).toBe('time_expired');
  });

  it('an explicit player failure action mid-loop still terminates the game server-side', () => {
    const bp = blueprint();
    const s = play(bp, newSession(bp), ['go_control_to_reactor', 'interact_emergency_shutdown']);
    expect(s.status).toBe('failed');
    expect(s.endingId).toBe('ending_panic_shutdown');
  });
});

describe('time-aware hint generation', () => {
  it('findTravelRoute computes shortest paths and minutes', () => {
    const bp = blueprint();
    const route = findTravelRoute(bp, 'control_room', 'reactor_hall');
    expect(route).not.toBeNull();
    expect(route.travelTime).toBeGreaterThanOrEqual(1);
    expect(route.travelActions.length).toBeGreaterThanOrEqual(1);
  });

  it('explains limitation when remaining time is insufficient for travel + action', async () => {
    const bp = blueprint();
    // Start session at control_room, already knowing the alarm
    let s = newSession(bp);
    s.persistentState.discoveredClueIds.push('clue_unusual_alarm');
    // Burn time so that remaining time is only 1 minute (20:59)
    for (let i = 0; i < 14; i++) {
      s = performAction(bp, s, { actionId: 'wait_one_minute' }, { now: NOW }).session;
    }
    expect(remainingMinutes(bp, s)).toBe(1);

    // Traveling to Engineering Bay requires 2 minutes, but only 1 minute remains!
    const hint = await buildHint(bp, s, 3);
    expect(hint.grounded).toBe(true);
    expect(hint.text).toMatch(/remain in this loop\. Reset the loop/i);
  });

  it('explains that time has run out when the loop has expired', async () => {
    const bp = blueprint();
    let s = newSession(bp);
    for (let i = 0; i < 15; i++) {
      s = performAction(bp, s, { actionId: 'wait_one_minute' }, { now: NOW }).session;
    }
    expect(s.loopExpired).toBe(true);

    const hint = await buildHint(bp, s, 3);
    expect(hint.grounded).toBe(true);
    expect(hint.text).toMatch(/Time has run out for this loop\. Reset the loop to start fresh/i);
  });
});

describe('scenario generator multi-loop repair', () => {
  it('repairs loop-1 win by increasing clue discovery timeCost so knowledge must carry over', async () => {
    const fastWin = {
      title: 'Clock Tower Quick',
      premise: 'Prevent the explosion.',
      objective: 'Disarm the clock before noon.',
      theme: 'mystery',
      difficulty: 'medium',
      initialTime: '11:45',
      loopEndTime: '12:00',
      loopLength: 15,
      maxLoops: 5,
      startLocationId: 'square',
      reset: { allowManualReset: true },
      locations: [
        { id: 'square', name: 'Square', description: 'Central.', lockedByDefault: false },
        { id: 'library', name: 'Library', description: 'Books.', lockedByDefault: false },
        { id: 'belfry', name: 'Belfry', description: 'Tower top.', lockedByDefault: false },
      ],
      characters: [
        { id: 'mayor', name: 'Mayor', role: 'Mayor', initialLocationId: 'square', publicFacts: [] },
        { id: 'clockmaker', name: 'Clockmaker', role: 'Maker', initialLocationId: 'belfry', publicFacts: [] },
        { id: 'librarian', name: 'Librarian', role: 'Scholar', initialLocationId: 'library', publicFacts: [] },
      ],
      objects: [],
      items: [],
      facts: [],
      clues: [
        { id: 'clue_blueprints', title: 'Blueprints', description: 'Valve schematics.', persistence: 'persistent' },
        { id: 'clue_two', title: 'C2', description: 'D2', persistence: 'persistent' },
        { id: 'clue_three', title: 'C3', description: 'D3', persistence: 'persistent' },
        { id: 'clue_four', title: 'C4', description: 'D4', persistence: 'persistent' },
        { id: 'clue_five', title: 'C5', description: 'D5', persistence: 'persistent' },
        { id: 'clue_six', title: 'C6', description: 'D6', persistence: 'persistent' },
      ],
      actions: [
        { id: 'go_square_to_library', type: 'travel', label: 'To library', locationId: 'square', destinationId: 'library', timeCost: 2, prerequisites: [], effects: [], narrative: 'Walk.' },
        { id: 'go_library_to_square', type: 'travel', label: 'To square', locationId: 'library', destinationId: 'square', timeCost: 2, prerequisites: [], effects: [], narrative: 'Walk.' },
        { id: 'go_square_to_belfry', type: 'travel', label: 'To belfry', locationId: 'square', destinationId: 'belfry', timeCost: 2, prerequisites: [], effects: [], narrative: 'Climb.' },
        { id: 'go_belfry_to_square', type: 'travel', label: 'To square', locationId: 'belfry', destinationId: 'square', timeCost: 2, prerequisites: [], effects: [], narrative: 'Climb.' },
        // Set timeCost to 1: walk(2) + search(1) + walk(2) + climb(2) + disarm(2) = 9 <= 15 min -> wins in loop 1!
        { id: 'search_blueprints', type: 'inspect', label: 'Search blueprints', locationId: 'library', timeCost: 1, prerequisites: [], effects: [{ type: 'discover_clue', clueId: 'clue_blueprints' }], narrative: 'Found.' },
        { id: 'find_c2', type: 'inspect', label: 'C2', locationId: 'library', timeCost: 1, prerequisites: [], effects: [{ type: 'discover_clue', clueId: 'clue_two' }], narrative: 'C2' },
        { id: 'find_c3', type: 'talk', label: 'C3', locationId: 'library', targetId: 'librarian', timeCost: 1, prerequisites: [], effects: [{ type: 'discover_clue', clueId: 'clue_three' }], narrative: 'C3' },
        { id: 'find_c4', type: 'talk', label: 'C4', locationId: 'square', targetId: 'mayor', timeCost: 1, prerequisites: [], effects: [{ type: 'discover_clue', clueId: 'clue_four' }], narrative: 'C4' },
        { id: 'find_c5', type: 'inspect', label: 'C5', locationId: 'square', timeCost: 1, prerequisites: [], effects: [{ type: 'discover_clue', clueId: 'clue_five' }], narrative: 'C5' },
        { id: 'find_c6', type: 'talk', label: 'C6', locationId: 'belfry', targetId: 'clockmaker', timeCost: 1, prerequisites: [], effects: [{ type: 'discover_clue', clueId: 'clue_six' }], narrative: 'C6' },
        { id: 'disarm_clock', type: 'interact', label: 'Disarm clock', locationId: 'belfry', timeCost: 2, prerequisites: ['clue:clue_blueprints'], effects: [{ type: 'set_flag', flag: 'clock_stopped' }], narrative: 'Disarmed.' },
        { id: 'wait_min', type: 'wait', label: 'Wait', locationId: '*', timeCost: 1, prerequisites: [], effects: [], narrative: 'Wait.' },
      ],
      events: [
        { id: 'explosion', at: '12:00', description: 'Boom.', conditions: ['!flag:clock_stopped'], effects: [] },
      ],
      winConditions: [{ id: 'win_saved', endingId: 'ending_saved', conditions: ['flag:clock_stopped'] }],
      failureConditions: [],
      loopLimitEndingId: 'ending_time_up',
      endings: [
        { id: 'ending_saved', type: 'victory', title: 'Saved', narrative: 'Saved!' },
        { id: 'ending_time_up', type: 'failure', title: 'Time Up', narrative: 'Time up.' },
      ],
      solutionGuide: {
        causalChain: ['Find blueprints in library', 'Disarm clock in belfry'],
        requiredClueIds: ['clue_blueprints'],
        intendedEndingId: 'ending_saved',
      },
    };

    const fakeAi = {
      generateJson: vi.fn().mockResolvedValue(JSON.stringify(fastWin)),
    };
    const fakeRepo = {
      create: vi.fn().mockImplementation((saved) => Promise.resolve({ ...saved, id: 'saved-1' })),
    };

    const generator = createScenarioGenerator({
      ai: fakeAi,
      scenarios: fakeRepo,
      maxRetries: 0,
      logger: { info() {}, warn() {}, error() {} },
    });

    const result = await generator.generate({
      prompt: 'A clock tower will explode at noon unless the mechanism is safely disarmed in time.',
      theme: 'mystery',
      difficulty: 'medium',
      loopLength: 'standard',
      sessionId: 'test-session',
    });

    expect(result.id).toBe('saved-1');
    const repairedAction = result.actions.find((a) => a.id === 'search_blueprints');
    // search_blueprints was repaired from 1 to 12 minutes, requiring multi-loop deduction!
    expect(repairedAction.timeCost).toBe(12);
  });
});
