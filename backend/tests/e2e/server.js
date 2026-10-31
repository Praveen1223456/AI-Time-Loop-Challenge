/**
 * TEST FIXTURE, not a production entry point. Runs the real Express app over real HTTP with
 *   - in-memory repositories (no MongoDB), and
 *   - a scripted fake Gemini client (no network, no key).
 * Used by e2e/run_e2e.py to drive the built frontend in a real browser.
 * Its /health reports database "connected" only because the in-memory store is always available.
 */
import { createApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { createMemoryRepositories } from '../../src/repositories/memoryRepositories.js';
import { validateBlueprint } from '../../src/services/blueprintValidator.js';
import { sampleScenario } from '../../src/data/sampleScenario.js';
import { validBlueprintJson } from '../helpers.js';

const port = Number(process.env.E2E_PORT ?? 5055);
const env = loadEnv({ NODE_ENV: 'test', CLIENT_URL: process.env.E2E_CLIENT_URL ?? 'http://localhost:5173' });
const repositories = createMemoryRepositories();
await repositories.scenarios.upsertBySlug(validateBlueprint(sampleScenario), { isSample: true });

const ai = {
  async generateJson({ prompt }) {
    await new Promise((r) => setTimeout(r, 400)); // visible "generating" state
    if (prompt.includes('[[fail]]')) return '{"broken json'; // lets the browser test exercise the UI's error path
    const minutes = Number(/loopLength: (\d+)/.exec(prompt)?.[1] ?? 15); // honour the requested loop length like a real model should
    return validBlueprintJson((bp) => {
      bp.title = 'The Midnight Heist (fixture)';
      bp.loopLength = minutes;
      bp.loopEndTime = `${String(Math.floor((20 * 60 + 45 + minutes) / 60)).padStart(2, '0')}:${String((45 + minutes) % 60).padStart(2, '0')}`;
    });
  },
};
const app = createApp({ env, repositories, getDbStatus: () => 'connected', ai, generatorOptions: { retryDelayMs: 0, logger: { info() {}, warn() {}, error() {} } },
  rateLimits: { generation: { windowMs: 60000, limit: 100 }, hints: { windowMs: 60000, limit: 100 } } });
app.listen(port, () => console.log(`e2e API fixture listening on ${port}`));
