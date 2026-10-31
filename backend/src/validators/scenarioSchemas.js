import { z } from 'zod';
import { parseClock } from '../services/rules.js';

export const idSchema = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/, 'must be lowercase snake_case (2-64 chars)');
const clockSchema = z.string().refine((v) => parseClock(v) !== null, 'must be HH:MM (24h)');
const text = (max) => z.string().trim().min(1).max(max);

/** Allowlisted effects. `.strict()` rejects unknown keys; the union rejects unknown types. */
export const effectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('discover_clue'), clueId: idSchema }).strict(),
  z.object({ type: z.literal('add_item'), itemId: idSchema }).strict(),
  z.object({ type: z.literal('remove_item'), itemId: idSchema }).strict(),
  z.object({ type: z.literal('set_flag'), flag: idSchema }).strict(),
  z.object({ type: z.literal('set_object_state'), objectId: idSchema, state: idSchema }).strict(),
  z.object({ type: z.literal('move_character'), characterId: idSchema, locationId: idSchema }).strict(),
  z.object({ type: z.literal('unlock_action'), actionId: idSchema }).strict(),
  z.object({ type: z.literal('unlock_location'), locationId: idSchema }).strict(),
  z.object({ type: z.literal('confirm_fact'), factId: idSchema }).strict(),
]);

const prerequisites = z.array(z.string().max(120)).max(10).default([]);

export const ACTION_TYPES = ['inspect', 'talk', 'travel', 'use_item', 'interact', 'wait'];

export const blueprintSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]{3,64}$/).optional(),
    title: text(120),
    premise: text(1000),
    objective: text(300),
    theme: z.enum(['sci-fi', 'mystery', 'fantasy', 'disaster', 'historical', 'custom']),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    initialTime: clockSchema.describe('Starting time of the loop in HH:MM (24-hour, e.g. "11:45" or "23:45")'),
    loopEndTime: clockSchema.describe('Ending time of the loop in HH:MM (24-hour, e.g. "12:00" or "00:00"). Must be strictly loopLength minutes later than initialTime.'),
    loopLength: z.number().int().min(1).max(600).describe('Loop duration in minutes. Must equal loopEndTime - initialTime.'),
    maxLoops: z.number().int().min(1).max(20),
    startLocationId: idSchema,
    reset: z.object({ allowManualReset: z.boolean() }).strict(),
    locations: z
      .array(
        z.object({
          id: idSchema, name: text(80), description: text(600),
          lockedByDefault: z.boolean().default(false),
        }).strict(),
      )
      .max(12),
    characters: z
      .array(
        z.object({
          id: idSchema, name: text(80), role: text(80), initialLocationId: idSchema,
          publicFacts: z.array(text(300)).max(10).default([]),
        }).strict(),
      )
      .max(12),
    objects: z
      .array(
        z.object({
          id: idSchema, name: text(80), locationId: idSchema, initialState: idSchema,
          states: z.array(idSchema).min(1).max(10),
        }).strict(),
      )
      .max(20)
      .default([]),
    items: z
      .array(z.object({ id: idSchema, name: text(80), description: text(300).optional(), persistent: z.boolean() }).strict())
      .max(20)
      .default([]),
    facts: z.array(z.object({ id: idSchema, text: text(300) }).strict()).max(30).default([]),
    clues: z
      .array(
        z.object({
          id: idSchema, title: text(100), description: text(500),
          persistence: z.enum(['persistent', 'loop']),
        }).strict(),
      )
      .max(30),
    actions: z
      .array(
        z.object({
          id: idSchema,
          type: z.enum(ACTION_TYPES),
          label: text(120),
          locationId: z.union([idSchema, z.literal('*')]),
          destinationId: idSchema.optional(),
          targetId: idSchema.optional(),
          prerequisites,
          lockedByDefault: z.boolean().default(false),
          timeCost: z.number().int().min(1).max(60),
          effects: z.array(effectSchema).max(10).default([]),
          narrative: text(600),
        }).strict(),
      )
      .max(80),
    events: z
      .array(
        z.object({
          id: idSchema,
          at: clockSchema.describe('Event time in HH:MM strictly after initialTime and no later than loopEndTime (e.g. "00:00" if the loop ends at midnight)'),
          description: text(300),
          conditions: prerequisites,
          effects: z.array(effectSchema).max(10).default([]),
        }).strict(),
      )
      .max(30)
      .default([]),
    winConditions: z.array(z.object({ id: idSchema, endingId: idSchema, conditions: prerequisites }).strict()).min(1),
    failureConditions: z.array(z.object({ id: idSchema, endingId: idSchema, conditions: prerequisites }).strict()).default([]),
    loopLimitEndingId: idSchema,
    endings: z
      .array(z.object({ id: idSchema, title: text(120), narrative: text(1200), type: z.enum(['victory', 'failure']) }).strict())
      .min(1)
      .max(10),
    solutionGuide: z
      .object({
        causalChain: z.array(text(300)).min(1).max(15),
        requiredClueIds: z.array(idSchema).min(1),
        intendedEndingId: idSchema,
      })
      .strict(),
  })
  .strict();

export const THEMES = ['sci-fi', 'mystery', 'fantasy', 'disaster', 'historical', 'custom'];
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const LOOP_LENGTHS = ['short', 'standard', 'long'];

/** Spec FR-02: prompt 30-1000 characters. `.strict()` so unexpected fields are rejected. */
export const createScenarioBody = z.object({
  prompt: z.string().trim().min(30, 'must be at least 30 characters').max(1000, 'must be at most 1000 characters'),
  theme: z.enum(THEMES),
  difficulty: z.enum(DIFFICULTIES),
  loopLength: z.enum(LOOP_LENGTHS),
}).strict();
