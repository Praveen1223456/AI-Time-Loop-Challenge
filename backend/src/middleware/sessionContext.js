import { z } from 'zod';
import { AppError } from '../utils/AppError.js';

const sessionIdSchema = z.string().uuid();

/**
 * Binds requests to a browser session via the `X-Session-Id` header (a client-generated UUID).
 * MVP decision (spec 13: "session-bound game ID", no accounts): the session ID acts as a
 * bearer capability. It is never logged. If authentication is added later, replace this
 * middleware with real identity and keep the ownership check in the service.
 */
export function requireSession(req, _res, next) {
  const parsed = sessionIdSchema.safeParse(req.get('x-session-id'));
  if (!parsed.success) {
    return next(new AppError(400, 'SESSION_REQUIRED', 'A valid X-Session-Id header (UUID) is required.'));
  }
  req.sessionId = parsed.data;
  next();
}
