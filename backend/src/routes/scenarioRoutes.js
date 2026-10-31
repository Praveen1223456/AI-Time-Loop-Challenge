import { Router } from 'express';
import { validateRequest } from '../middleware/validateRequest.js';
import { requireSession } from '../middleware/sessionContext.js';
import { createScenarioBody } from '../validators/scenarioSchemas.js';

export function createScenarioRouter({ scenarioController, limiters }) {
  const router = Router();
  router.get('/samples', scenarioController.listSamples);
  router.post('/', requireSession, limiters.generation, validateRequest({ body: createScenarioBody }), scenarioController.create);
  return router;
}
