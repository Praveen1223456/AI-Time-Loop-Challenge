export function createGameController({ gameService }) {
  return {
    async create(req, res) {
      const state = await gameService.createGame({
        scenarioId: req.validated.body.scenarioId,
        sessionId: req.sessionId,
      });
      res.status(201).json({ success: true, data: state });
    },
    async get(req, res) {
      const state = await gameService.getGame({ gameId: req.validated.params.gameId, sessionId: req.sessionId });
      res.json({ success: true, data: state });
    },
    async replay(req, res) {
      const state = await gameService.replay({ gameId: req.validated.params.gameId, sessionId: req.sessionId });
      res.status(201).json({ success: true, data: state });
    },
    async list(req, res) {
      const data = await gameService.listGames({ sessionId: req.sessionId, ...req.validated.query });
      res.json({ success: true, data });
    },
    async ending(req, res) {
      const data = await gameService.getEnding({ gameId: req.validated.params.gameId, sessionId: req.sessionId });
      res.json({ success: true, data });
    },
  };
}
