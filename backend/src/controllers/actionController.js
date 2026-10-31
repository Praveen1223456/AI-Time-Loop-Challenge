export function createActionController({ gameService }) {
  return {
    async perform(req, res) {
      const { actionId, targetId, expectedVersion } = req.validated.body;
      const data = await gameService.act({
        gameId: req.validated.params.gameId, sessionId: req.sessionId, actionId, targetId, expectedVersion,
      });
      res.json({ success: true, data });
    },
    async hint(req, res) {
      const data = await gameService.hint({
        gameId: req.validated.params.gameId, sessionId: req.sessionId, level: req.validated.body.level,
      });
      res.json({ success: true, data });
    },
    async note(req, res) {
      const { text, expectedVersion } = req.validated.body;
      const data = await gameService.addNote({
        gameId: req.validated.params.gameId, sessionId: req.sessionId, text, expectedVersion,
      });
      res.status(201).json({ success: true, data });
    },
    async reset(req, res) {
      const { reason, expectedVersion } = req.validated.body;
      const data = await gameService.reset({
        gameId: req.validated.params.gameId, sessionId: req.sessionId, reason, expectedVersion,
      });
      res.json({ success: true, data });
    },
  };
}
