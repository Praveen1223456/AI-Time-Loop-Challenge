import { rateLimit } from 'express-rate-limit';
import { AppError } from '../utils/AppError.js';

export const DEFAULT_RATE_LIMITS = Object.freeze({
  generation: { windowMs: 10 * 60 * 1000, limit: 6 },   // scenario generation is slow and costs money
  hints: { windowMs: 10 * 60 * 1000, limit: 40 },
});

/** Per-session limiters (the session header is validated before these run). */
export function createRateLimiters(overrides = {}) {
  const make = ({ windowMs, limit }, what) =>
    rateLimit({
      windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, validate: false,
      keyGenerator: (req) => req.sessionId ?? 'anonymous',
      handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', `Too many ${what} requests. Please wait and try again.`)),
    });
  const cfg = { ...DEFAULT_RATE_LIMITS, ...overrides };
  return { generation: make(cfg.generation, 'scenario generation'), hints: make(cfg.hints, 'hint') };
}
