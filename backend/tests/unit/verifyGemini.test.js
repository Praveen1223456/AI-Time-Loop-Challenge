import { describe, it, expect } from 'vitest';
import { runGeminiVerification } from '../../src/scripts/verifyGeminiLib.js';
import { loadEnv } from '../../src/config/env.js';
import { validBlueprintJson } from '../helpers.js';

const env = (extra = {}) => loadEnv({ NODE_ENV: 'test', GEMINI_API_KEY: 'k', GEMINI_MODEL: 'm', GEMINI_MAX_RETRIES: '1', ...extra });
const sdkWith = (handler) => ({ GoogleGenAI: class { constructor() { this.models = { generateContent: async (p) => handler(p) }; } } });
const run = (e, sdk) => { const out = []; return runGeminiVerification({ env: e, sdk, write: (l) => out.push(l) }).then((r) => ({ ...r, out: out.join('\n') })); };

describe('runGeminiVerification (dry run with a fake SDK)', () => {
  it('reports success when connectivity and the full pipeline work, writing nothing to a database', async () => {
    const sdk = sdkWith((p) => ({ text: p.contents.includes('"ok": true') ? '{"ok":true}' : validBlueprintJson() }));
    const r = await run(env(), sdk);
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => s.name)).toEqual(['configuration', 'connectivity + JSON mode', 'scenario generation + validation', 'structured output (responseJsonSchema)']);
    expect(r.out).toMatch(/PASS  scenario generation \+ validation/);
  });

  it('fails early and clearly when the key or model is missing', async () => {
    const r = await run(loadEnv({ NODE_ENV: 'test' }), sdkWith(() => ({ text: '{}' })));
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/missing GEMINI_API_KEY, GEMINI_MODEL/);
    expect(r.steps).toHaveLength(1);
  });

  it('reports bad credentials at the connectivity step without leaking the key', async () => {
    const sdk = sdkWith(() => { throw Object.assign(new Error('API key invalid: k'), { status: 401 }); });
    const r = await run(env({ GEMINI_API_KEY: 'sk-super-secret' }), sdk);
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/AI_AUTH_ERROR/);
    expect(r.out).not.toContain('sk-super-secret');
  });

  it('prints the validator issues when the model output is rejected, so generation can be tuned', async () => {
    const sdk = sdkWith((p) => ({ text: p.contents.includes('"ok": true') ? '{"ok":true}' : JSON.stringify({ title: 'incomplete' }) }));
    const r = await run(env(), sdk);
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/attempt 1\/2 rejected/);
    expect(r.out).toMatch(/attempt 2\/2 rejected/);
    expect(r.out).toMatch(/- .*(premise|locations|clues)/);
  });

  it('reports when structured output is not accepted by the API (fallback in effect)', async () => {
    let first = true;
    const sdk = sdkWith((p) => {
      if (p.config.responseJsonSchema && first && !p.contents.includes('"ok": true')) { first = false; throw Object.assign(new Error('bad schema'), { status: 400 }); }
      return { text: p.contents.includes('"ok": true') ? '{"ok":true}' : validBlueprintJson() };
    });
    const r = await run(env({ GEMINI_MAX_RETRIES: '2' }), sdk);
    expect(r.ok).toBe(false); // the schema step is reported as FAIL so you notice it; generation itself still succeeded
    expect(r.out).toMatch(/PASS  scenario generation/);
    expect(r.out).toMatch(/FAIL  structured output.*fell back/);
  });
});
