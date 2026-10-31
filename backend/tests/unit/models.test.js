/**
 * Schema-level checks that do not need a database connection (validateSync only).
 * They guard against schema drift: a key the engine writes but the Mongoose schema
 * lacks would be silently dropped on save.
 */
import { describe, it, expect } from 'vitest';
import { Scenario } from '../../src/models/Scenario.js';
import { GameSession } from '../../src/models/GameSession.js';
import { validateBlueprint } from '../../src/services/blueprintValidator.js';
import { sampleScenario } from '../../src/data/sampleScenario.js';
import { createInitialSession } from '../../src/services/gameEngine.js';
import { NOW } from '../helpers.js';

const OID = '507f1f77bcf86cd799439011';
const bp = validateBlueprint(sampleScenario);
const session = () => createInitialSession(bp, { sessionId: '11111111-1111-4111-8111-111111111111', scenarioId: OID, now: NOW });

describe('Scenario model', () => {
  it('accepts a validated blueprint and has a path for every blueprint key', () => {
    expect(new Scenario({ ...bp, isSample: true }).validateSync()).toBeUndefined();
    for (const key of Object.keys(bp)) {
      expect(Scenario.schema.pathType(key), `schema is missing "${key}"`).not.toBe('adhocOrUndefined');
    }
  });
  it('requires core fields', () => {
    const err = new Scenario({}).validateSync();
    expect(Object.keys(err.errors)).toEqual(expect.arrayContaining(['title', 'premise', 'solutionGuide']));
  });
});

describe('GameSession model', () => {
  it('accepts an engine-created session and has a path for every session key', () => {
    expect(new GameSession(session()).validateSync()).toBeUndefined();
    for (const key of Object.keys(session())) {
      expect(GameSession.schema.pathType(key), `schema is missing "${key}"`).not.toBe('adhocOrUndefined');
    }
    for (const key of Object.keys(session().persistentState)) {
      expect(GameSession.schema.pathType(`persistentState.${key}`), `persistentState.${key}`).not.toBe('adhocOrUndefined');
    }
    for (const key of Object.keys(session().temporaryState)) {
      expect(GameSession.schema.pathType(`temporaryState.${key}`), `temporaryState.${key}`).not.toBe('adhocOrUndefined');
    }
  });
  it('rejects an invalid status and a loop below 1', () => {
    expect(new GameSession({ ...session(), status: 'hacked' }).validateSync().errors.status).toBeDefined();
    expect(new GameSession({ ...session(), currentLoop: 0 }).validateSync().errors.currentLoop).toBeDefined();
  });
  it('requires an ObjectId scenarioId and a sessionId', () => {
    expect(new GameSession({ ...session(), scenarioId: 'not-an-object-id' }).validateSync().errors.scenarioId).toBeDefined();
    expect(new GameSession({ ...session(), sessionId: undefined }).validateSync().errors.sessionId).toBeDefined();
  });
  it('keeps empty objects (minimize: false) so objectStates round-trip', () => {
    const doc = new GameSession({ ...session(), temporaryState: { ...session().temporaryState, objectStates: {} } });
    expect(doc.toObject().temporaryState.objectStates).toEqual({});
  });
});
