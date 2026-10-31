import { AppError } from '../utils/AppError.js';

/**
 * Validates req.body / req.params / req.query with Zod schemas.
 * Parsed (stripped/coerced) values are exposed on `req.validated`;
 * handlers must read from there, never from the raw request.
 */
export function validateRequest({ body, params, query } = {}) {
  return (req, _res, next) => {
    const validated = {};
    const parts = {
      body: [body, req.body ?? {}],
      params: [params, req.params],
      query: [query, req.query],
    };
    for (const [name, [schema, value]] of Object.entries(parts)) {
      if (!schema) continue;
      const result = schema.safeParse(value);
      if (!result.success) {
        return next(
          new AppError(
            400,
            'VALIDATION_ERROR',
            `Invalid request ${name}.`,
            result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          ),
        );
      }
      validated[name] = result.data;
    }
    req.validated = validated;
    next();
  };
}
