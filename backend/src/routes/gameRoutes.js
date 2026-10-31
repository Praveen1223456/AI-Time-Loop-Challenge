import { Router } from 'express';
import { validateRequest } from '../middleware/validateRequest.js';
import { requireSession } from '../middleware/sessionContext.js';
import { createGameBody, gameIdParams, actionBody, resetBody, listQuery, hintBody, noteBody } from '../validators/gameSchemas.js';

export function createGameRouter({ gameController, actionController, limiters }) {
  const router = Router();
  router.use(requireSession);
  router.get('/', validateRequest({ query: listQuery }), gameController.list);
  router.post('/', validateRequest({ body: createGameBody }), gameController.create);
  router.get('/:gameId', validateRequest({ params: gameIdParams }), gameController.get);
  router.get('/:gameId/ending', validateRequest({ params: gameIdParams }), gameController.ending);
  router.post('/:gameId/actions', validateRequest({ params: gameIdParams, body: actionBody }), actionController.perform);
  router.post('/:gameId/reset', validateRequest({ params: gameIdParams, body: resetBody }), actionController.reset);
  router.post('/:gameId/hints', validateRequest({ params: gameIdParams, body: hintBody }), limiters.hints, actionController.hint);
  router.post('/:gameId/notes', validateRequest({ params: gameIdParams, body: noteBody }), actionController.note);
  router.post('/:gameId/replay', validateRequest({ params: gameIdParams }), gameController.replay);
  return router;
}
