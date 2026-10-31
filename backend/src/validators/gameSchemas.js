import { z } from 'zod';
import { idSchema } from './scenarioSchemas.js';

const opaqueId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const expectedVersion = z.number().int().min(0).optional();

export const createGameBody = z.object({ scenarioId: opaqueId }).strict();
export const gameIdParams = z.object({ gameId: opaqueId });
/** `.strict()` means any extra field (e.g. a client-supplied "state") is a 400, not silently ignored. */
export const actionBody = z.object({ actionId: idSchema, targetId: idSchema.optional(), expectedVersion }).strict();
export const resetBody = z.object({ reason: z.enum(['manual', 'time_expired']).default('manual'), expectedVersion }).strict();
/** Decimal digits only: z.coerce.number() would also accept "0x10", "1e1", " " etc. */
const intQuery = (fallback, min, max) =>
  z.string().regex(/^\d{1,6}$/, 'must be a whole number').optional()
    .transform((v) => (v === undefined ? fallback : Number(v)))
    .pipe(z.number().int().min(min).max(max));

export const listQuery = z.object({
  limit: intQuery(20, 1, 50),
  skip: intQuery(0, 0, 10000),
});
export const hintBody = z.object({ level: z.number().int().min(1).max(3) }).strict();
export const noteBody = z.object({ text: z.string().trim().min(1).max(300), expectedVersion }).strict();
