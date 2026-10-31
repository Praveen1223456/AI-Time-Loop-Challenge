import { describe, it, expect, vi } from 'vitest';
import { createGeminiClient } from '../../src/services/geminiClient.js';
import { pruneJsonSchema, blueprintGeminiSchema } from '../../src/services/geminiSchema.js';
import { AppError } from '../../src/utils/AppError.js';

const API_KEY = 'AIza-TEST-KEY-should-never-leak';

/** Fake of the parts of @google/genai that we use. */
function fakeSdk(behaviour) {
  const calls = [];
  class GoogleGenAI {
    constructor(opts) { GoogleGenAI.opts = opts; this.models = { generateContent: async (params) => { calls.push(params); return behaviour(params, calls.length); } }; }
  }
  return { sdk: { GoogleGenAI }, calls, GoogleGenAI };
}
const logger = () => ({ warn: vi.fn(), info: vi.fn() });
const req = { system: 'sys', prompt: 'p', jsonSchema: { type: 'object' }, timeoutMs: 500 };
const sdkError = (status, message = 'boom') => Object.assign(new Error(message), { status });
const catchErr = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected rejection'); };

describe('createGeminiClient', () => {
  it('passes key, model, JSON mode, schema, abort signal and timeout to the SDK', async () => {
    const { sdk, calls, GoogleGenAI } = fakeSdk(() => ({ text: '{"ok":true}' }));
    const client = createGeminiClient({ apiKey: API_KEY, model: 'test-model', sdk, logger: logger() });
    expect(await client.generateJson(req)).toBe('{"ok":true}');
    expect(GoogleGenAI.opts).toEqual({ apiKey: API_KEY });
    const [call] = calls;
    expect(call.model).toBe('test-model');
    expect(call.contents).toBe('p');
    expect(call.config).toMatchObject({
      systemInstruction: 'sys',
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object' },
      maxOutputTokens: 16384,
      httpOptions: { timeout: 500 },
    });
    expect(call.config.thinkingConfig).toBeUndefined();
    expect(call.config.temperature).toBeUndefined();
    expect(call.config.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('configures model-specific thinking config only when supported', async () => {
    const { sdk, calls } = fakeSdk(() => ({ text: '{"ok":true}' }));
    const reasoningClient = createGeminiClient({ apiKey: API_KEY, model: 'gemini-3.8-flash', sdk, logger: logger() });
    await reasoningClient.generateJson(req);
    expect(calls[0].config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });

    const legacyClient = createGeminiClient({ apiKey: API_KEY, model: 'gemini-2.5-flash', sdk, logger: logger() });
    await legacyClient.generateJson(req);
    expect(calls[1].config.thinkingConfig).toEqual({ thinkingBudget: 0 });

    const liteClient = createGeminiClient({ apiKey: API_KEY, model: 'gemini-3.5-flash-lite', sdk, logger: logger() });
    await liteClient.generateJson(req);
    expect(calls[2].config.thinkingConfig).toBeUndefined();
  });

  it('times out hard even if the SDK ignores the abort signal, and aborts the request', async () => {
    const { sdk, calls } = fakeSdk(() => new Promise(() => {})); // never settles
    const client = createGeminiClient({ apiKey: API_KEY, model: 'm', sdk, logger: logger() });
    const started = Date.now();
    const err = await catchErr(client.generateJson({ ...req, timeoutMs: 60 }));
    expect(err).toMatchObject({ status: 502, code: 'AI_TIMEOUT', retryable: true });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(calls[0].config.abortSignal.aborted).toBe(true);
  });

  it('maps provider failures to safe, classified errors', async () => {
    const table = [
      [401, 'AI_AUTH_ERROR', false],
      [403, 'AI_AUTH_ERROR', false],
      [404, 'AI_MODEL_UNAVAILABLE', false],
      [500, 'AI_PROVIDER_ERROR', true],
      [503, 'AI_PROVIDER_ERROR', true],
      [504, 'AI_TIMEOUT', true],
    ];
    for (const [status, code, retryable] of table) {
      const { sdk } = fakeSdk(() => { throw sdkError(status); });
      const err = await catchErr(createGeminiClient({ apiKey: API_KEY, model: 'm', sdk, logger: logger() }).generateJson(req));
      expect(err, String(status)).toMatchObject({ status: 502, code, retryable });
    }
    const log = logger();
    const { sdk } = fakeSdk(() => {
      throw sdkError(429, JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: `quota for ${API_KEY}` } }));
    });
    const quotaError = await catchErr(createGeminiClient({ apiKey: API_KEY, model: 'm', sdk, logger: log }).generateJson(req));
    expect(quotaError).toMatchObject({ status: 502, code: 'AI_QUOTA_EXCEEDED', retryable: false });
    expect(quotaError.message).not.toContain(API_KEY);
    expect(log.warn.mock.calls.join('\n')).toContain('provider RESOURCE_EXHAUSTED');
    expect(log.warn.mock.calls.join('\n')).not.toContain(API_KEY);

    const { sdk: limitedSdk } = fakeSdk(() => { throw sdkError(429); });
    expect(await catchErr(createGeminiClient({ apiKey: API_KEY, model: 'm', sdk: limitedSdk, logger: logger() }).generateJson(req)))
      .toMatchObject({ code: 'AI_RATE_LIMITED', retryable: true });

    const { sdk: networkSdk } = fakeSdk(() => { throw new TypeError('fetch failed'); }); // network error without status
    expect(await catchErr(createGeminiClient({ apiKey: API_KEY, model: 'm', sdk: networkSdk, logger: logger() }).generateJson(req))).toMatchObject({ code: 'AI_PROVIDER_ERROR', retryable: true });
  });

  it('never leaks provider messages or the API key to callers or logs', async () => {
    const log = logger();
    const { sdk } = fakeSdk(() => { throw sdkError(500, `upstream said key=${API_KEY}`); });
    const err = await catchErr(createGeminiClient({ apiKey: API_KEY, model: 'm', sdk, logger: log }).generateJson(req));
    expect(err).toBeInstanceOf(AppError);
    expect(JSON.stringify({ m: err.message, c: err.code, d: err.details })).not.toContain(API_KEY);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(API_KEY);
  });

  it('logs the error class and low-level cause (to tell network faults from bad parameters) but never the message', async () => {
    const log = logger();
    const { sdk } = fakeSdk(() => { throw Object.assign(new TypeError('fetch failed key=' + API_KEY), { cause: { code: 'ENOTFOUND' } }); });
    await catchErr(createGeminiClient({ apiKey: API_KEY, model: 'm', sdk, logger: log }).generateJson(req));
    const line = log.warn.mock.calls.map((c) => c[0]).join('\n');
    expect(line).toContain('AI_PROVIDER_ERROR (TypeError, cause ENOTFOUND)');
    expect(line).not.toContain(API_KEY);
  });

  it('safely logs provider 400 messages and structured details without retrying invalid requests', async () => {
    const log = logger();
    const privatePrompt = 'confidential scenario request details';
    const providerMessage = JSON.stringify({
      error: {
        code: 400,
        status: 'INVALID_ARGUMENT',
        message: `Invalid value for prompt ${privatePrompt} with key ${API_KEY}`,
        details: [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'generationConfig.temperature', description: `not supported for ${API_KEY}` }] }],
      },
    });
    const { sdk, calls } = fakeSdk(() => { throw sdkError(400, providerMessage); });
    const err = await catchErr(createGeminiClient({ apiKey: API_KEY, model: 'm', sdk, logger: log })
      .generateJson({ ...req, prompt: privatePrompt, jsonSchema: undefined }));
    expect(err).toMatchObject({ code: 'AI_REQUEST_REJECTED', retryable: false });
    expect(calls).toHaveLength(1);
    const line = log.warn.mock.calls.map((call) => call[0]).join('\n');
    expect(line).toContain('Invalid value for prompt [REDACTED] with key [REDACTED]');
    expect(line).toContain('generationConfig.temperature');
    expect(line).not.toContain(API_KEY);
    expect(line).not.toContain(privatePrompt);
  });

  it('treats empty / blocked responses as retryable errors and safely logs metadata', async () => {
    const log = logger();
    const blockedResponse = {
      candidates: [{ finishReason: 'SAFETY' }],
      promptFeedback: { blockReason: 'SAFETY' },
    };
    const { sdk } = fakeSdk(() => blockedResponse);
    const err = await catchErr(createGeminiClient({ apiKey: API_KEY, model: 'm', sdk, logger: log }).generateJson(req));
    expect(err).toMatchObject({ code: 'AI_EMPTY_RESPONSE', retryable: true });
    expect(log.warn.mock.calls.join('\n')).toContain('empty response: finishReason=SAFETY, candidates=1, blockReason=SAFETY');
    expect(log.warn.mock.calls.join('\n')).not.toContain(API_KEY);
  });

  it('extracts text from candidate parts if response.text getter is empty', async () => {
    const multiPartResponse = {
      text: undefined,
      candidates: [{
        finishReason: 'STOP',
        content: {
          parts: [{ text: '{"part":' }, { text: '"recovered"}' }],
        },
      }],
    };
    const { sdk } = fakeSdk(() => multiPartResponse);
    const client = createGeminiClient({ apiKey: API_KEY, model: 'm', sdk, logger: logger() });
    expect(await client.generateJson(req)).toBe('{"part":"recovered"}');
  });

  it('falls back to schema-less JSON mode if the API rejects the schema (once, then remembers)', async () => {
    const error = JSON.stringify({ error: {
      code: 400,
      status: 'INVALID_ARGUMENT',
      message: 'responseJsonSchema is not supported',
    } });
    const { sdk, calls } = fakeSdk((params, n) => { if (n === 1) throw sdkError(400, error); return { text: '{"recovered":true}' }; });
    const client = createGeminiClient({ apiKey: API_KEY, model: 'm', sdk, logger: logger() });
    const res = await client.generateJson(req);
    expect(res).toBe('{"recovered":true}');
    expect(client.structuredOutputSupported).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[0].config.responseJsonSchema).toBeDefined();
    expect(calls[1].config.responseJsonSchema).toBeUndefined();
    expect(calls[1].config.responseMimeType).toBe('application/json'); // JSON mode stays on
  });

  it('extracts retryAfterMs from provider RetryInfo details', async () => {
    const log = logger();
    const { sdk } = fakeSdk(() => {
      throw sdkError(429, JSON.stringify({
        error: {
          code: 429,
          status: 'RATE_LIMIT_EXCEEDED',
          details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3.5s' }],
        },
      }));
    });
    const err = await catchErr(createGeminiClient({ apiKey: API_KEY, model: 'm', sdk, logger: log }).generateJson(req));
    expect(err).toMatchObject({ status: 502, code: 'AI_RATE_LIMITED', retryable: true, retryAfterMs: 3500 });
  });

  it('a 400 without a schema in play is not retryable', async () => {
    const { sdk } = fakeSdk(() => { throw sdkError(400); });
    const err = await catchErr(createGeminiClient({ apiKey: API_KEY, model: 'm', sdk, logger: logger() }).generateJson({ ...req, jsonSchema: undefined }));
    expect(err).toMatchObject({ code: 'AI_REQUEST_REJECTED', retryable: false });
  });
});

describe('Gemini response schema', () => {
  it('keeps only OpenAPI 3.0 keywords the Gemini API supports (no oneOf, anyOf, allOf, $defs)', () => {
    const SUPPORTED = new Set(['type', 'format', 'title', 'description', 'enum', 'items', 'properties', 'required', 'nullable']);
    const bad = [];
    (function walk(node, path) {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
      if (!node || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node)) {
        if (k === 'properties') { for (const [pk, pv] of Object.entries(v)) walk(pv, `${path}.${pk}`); continue; }
        if (!SUPPORTED.has(k)) bad.push(`${path}.${k}`);
        walk(v, `${path}.${k}`);
      }
    })(blueprintGeminiSchema(), '$');
    expect(bad).toEqual([]);
  });

  it('describes the blueprint (top-level fields, effect union) and converts const to enum', () => {
    const schema = blueprintGeminiSchema();
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['locations', 'characters', 'clues', 'actions', 'events', 'endings', 'solutionGuide']));
    expect(pruneJsonSchema({ type: 'string', const: 'x', pattern: '^a', minLength: 1 })).toEqual({ type: 'string', enum: ['x'] });
  });

  it('simplifies oneOf, anyOf, and allOf into single objects or strings', () => {
    expect(pruneJsonSchema({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toEqual({ type: 'string' });
    const prunedOneOf = pruneJsonSchema({
      oneOf: [
        { properties: { type: { const: 'a' }, aVal: { type: 'string' } } },
        { properties: { type: { const: 'b' }, bVal: { type: 'number' } } },
      ],
    });
    expect(prunedOneOf).toEqual({
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['a', 'b'] },
        aVal: { type: 'string' },
        bVal: { type: 'number' },
      },
      required: ['type'],
    });
    const prunedAllOf = pruneJsonSchema({
      allOf: [
        { properties: { x: { type: 'string' } }, required: ['x'] },
        { properties: { y: { type: 'number' } }, required: ['y'] },
      ],
    });
    expect(prunedAllOf).toEqual({
      type: 'object',
      properties: {
        x: { type: 'string' },
        y: { type: 'number' },
      },
      required: expect.arrayContaining(['x', 'y']),
    });
  });
});
