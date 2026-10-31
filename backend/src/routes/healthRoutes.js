import { Router } from 'express';

export function createHealthRouter({ env, getDbStatus, aiConfigured = false }) {
  const router = Router();
  router.get('/', (_req, res) => {
    const database = getDbStatus();
    const healthy = database === 'connected';
    // 503 when the database is not actually connected: report the truth.
    res.status(healthy ? 200 : 503).json({
      success: healthy,
      data: {
        status: healthy ? 'ok' : 'degraded',
        environment: env.NODE_ENV,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        database: { status: database },
        ai: { configured: aiConfigured },
      },
    });
  });
  return router;
}
