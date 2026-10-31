import { toPublicScenarioSummary } from '../services/publicView.js';

export function createScenarioController({ gameService, generator }) {
  return {
    async listSamples(_req, res) {
      res.json({ success: true, data: await gameService.listSampleScenarios() });
    },
    async create(req, res) {
      const saved = await generator.generate({ ...req.validated.body, sessionId: req.sessionId });
      // Public representation only: the private solution guide never leaves the server here.
      res.status(201).json({
        success: true,
        data: { scenarioId: saved.id, title: saved.title, ...toPublicScenarioSummary(saved), objective: saved.objective },
      });
    },
  };
}
