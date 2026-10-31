import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createApiRouter } from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

/**
 * App factory. Dependencies (env, repositories, DB status probe, clock) are injected so
 * tests can run the full HTTP stack without a database.
 */
export function createApp({ env, repositories, getDbStatus = () => 'unknown', clock, ai, rateLimits, generatorOptions }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_URL }));
  app.use(express.json({ limit: '10kb' }));
  app.use('/api/v1', createApiRouter({ env, repositories, getDbStatus, clock, ai, rateLimits, generatorOptions }));
  app.use(notFoundHandler);
  app.use(errorHandler(env));
  return app;
}
