import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    MONGODB_URI: z
      .string()
      .regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://')
      .optional(),
    GEMINI_API_KEY: z.string().min(1).optional(),
    GEMINI_MODEL: z.string().min(1).optional(),
    GEMINI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(45000),
    GEMINI_MAX_RETRIES: z.coerce.number().int().min(0).max(4).default(2),
    CLIENT_URL: z
      .string()
      .url()
      .default('http://localhost:5173')
      .transform((value) => new URL(value).origin),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'test' && !value.MONGODB_URI) {
      ctx.addIssue({ code: 'custom', path: ['MONGODB_URI'], message: 'is required' });
    }
  });

export class EnvValidationError extends Error {
  constructor(problems) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'EnvValidationError';
    this.problems = problems;
  }
}

/**
 * Validates environment variables. Error messages name the variable and the
 * problem but never echo the supplied value (it may be a credential).
 */
export function loadEnv(source = process.env) {
  // Treat `KEY=` (empty) in a .env file the same as "not set".
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`),
    );
  }
  return Object.freeze(result.data);
}
