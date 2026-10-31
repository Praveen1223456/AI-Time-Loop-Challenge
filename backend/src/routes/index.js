import { Router } from 'express';
import { createHealthRouter } from './healthRoutes.js';
import { createScenarioRouter } from './scenarioRoutes.js';
import { createGameRouter } from './gameRoutes.js';
import { createGameService } from '../services/gameService.js';
import { createScenarioGenerator } from '../services/scenarioGenerator.js';
import { createRateLimiters } from '../middleware/rateLimiter.js';
import { createScenarioController } from '../controllers/scenarioController.js';
import { createGameController } from '../controllers/gameController.js';
import { createActionController } from '../controllers/actionController.js';

export function createApiRouter({ env, repositories, getDbStatus, clock, ai, rateLimits, generatorOptions }) {
  const gameService = createGameService({ ...repositories, clock });
  const generator = createScenarioGenerator({
    ai, scenarios: repositories.scenarios,
    maxRetries: env.GEMINI_MAX_RETRIES, timeoutMs: env.GEMINI_TIMEOUT_MS, ...generatorOptions,
  });
  const limiters = createRateLimiters(rateLimits);
  const router = Router();
  router.use('/health', createHealthRouter({ env, getDbStatus, aiConfigured: generator.configured }));
  router.use('/scenarios', createScenarioRouter({ scenarioController: createScenarioController({ gameService, generator }), limiters }));
  router.use('/games', createGameRouter({
    gameController: createGameController({ gameService }),
    actionController: createActionController({ gameService }),
    limiters,
  }));
  return router;
}
