/**
 * Thin, defensive wrapper around the official Google Gen AI SDK (@google/genai).
 * The SDK is injected so tests never touch the network. Responsibilities:
 *  - hard timeout (AbortSignal + a Promise.race backstop in case the SDK ignores the signal),
 *  - normalizing every failure into an AppError with a `retryable` flag,
 *  - never exposing provider messages (or credentials) to API clients.
 * It returns TEXT only. The caller treats it as untrusted until it passes validation.
 */
import { AppError } from '../utils/AppError.js';

function sanitizeProviderValue(value, secrets, depth = 0) {
  if (typeof value === 'string') {
    let safe = value;
    for (const secret of secrets) {
      if (secret?.length >= 16) safe = safe.replaceAll(secret, '[REDACTED]');
    }
    return safe
      .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED]')
      .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/((?:api[_-]?key|authorization)\s*[:=]\s*)["']?[^,}\s"']+/gi, '$1[REDACTED]')
      .slice(0, 1000);
  }
  if (Array.isArray(value)) {
    return depth >= 5 ? '[TRUNCATED]' : value.slice(0, 20).map((item) => sanitizeProviderValue(item, secrets, depth + 1));
  }
  if (value && typeof value === 'object') {
    if (depth >= 5) return '[TRUNCATED]';
    return Object.fromEntries(
      Object.entries(value).slice(0, 30).map(([key, item]) => [
        key,
        sanitizeProviderValue(item, secrets, depth + 1),
      ]),
    );
  }
  return value;
}

function getThinkingConfig(modelName) {
  if (!modelName || typeof modelName !== 'string') return undefined;
  const lower = modelName.toLowerCase();
  // gemini-2.5 models use thinkingBudget (integer)
  if (lower.includes('gemini-2.5')) return { thinkingBudget: 0 };
  // Reasoning models support thinkingLevel
  if (lower.includes('gemini-3.8') || lower.includes('thinking')) return { thinkingLevel: 'LOW' };
  return undefined;
}

export function createGeminiClient({ apiKey, model, sdk, logger = console }) {
  const ai = new sdk.GoogleGenAI({ apiKey });
  let structuredOutputSupported = true; // flips to false if the API rejects our schema once

  function getProviderError(err, secrets) {
    if (typeof err?.message !== 'string') return undefined;
    try {
      const provider = JSON.parse(err.message)?.error;
      if (!provider || typeof provider !== 'object') return undefined;
      let retryDelayMs;
      if (Array.isArray(provider.details)) {
        for (const item of provider.details) {
          if (item && typeof item.retryDelay === 'string') {
            const match = item.retryDelay.match(/^(\d+(?:\.\d+)?)s$/);
            if (match) retryDelayMs = Math.round(parseFloat(match[1]) * 1000);
          }
        }
      }
      return {
        status: typeof provider.status === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(provider.status)
          ? provider.status : undefined,
        code: Number.isInteger(provider.code) ? provider.code : undefined,
        message: typeof provider.message === 'string'
          ? sanitizeProviderValue(provider.message, secrets) : undefined,
        details: Array.isArray(provider.details)
          ? sanitizeProviderValue(provider.details, secrets) : undefined,
        retryDelayMs,
      };
    } catch {
      return {
        message: sanitizeProviderValue(err.message, secrets),
      };
    }
  }

  function normalize(err, timedOut, providerStatus) {
    if (timedOut || err?.name === 'AbortError') {
      return Object.assign(new AppError(502, 'AI_TIMEOUT', 'The AI service took too long to respond.'), { retryable: true });
    }
    const status = Number(err?.status);
    if (status === 401 || status === 403) {
      return Object.assign(new AppError(502, 'AI_AUTH_ERROR', 'The AI service rejected the server credentials.'), { retryable: false });
    }
    if (status === 404 || providerStatus === 'NOT_FOUND') {
      return Object.assign(new AppError(502, 'AI_MODEL_UNAVAILABLE', 'The configured AI model is unavailable.'), { retryable: false });
    }
    if (status === 429 && providerStatus === 'RESOURCE_EXHAUSTED') {
      return Object.assign(new AppError(502, 'AI_QUOTA_EXCEEDED', 'The AI provider quota has been reached. Check provider usage or try again later.'), { retryable: false });
    }
    if (status === 429) {
      return Object.assign(new AppError(502, 'AI_RATE_LIMITED', 'The AI service is temporarily rate limited. Please try again in a moment.'), { retryable: true });
    }
    if (status === 408 || status === 504) {
      return Object.assign(new AppError(502, 'AI_TIMEOUT', 'The AI service took too long to respond.'), { retryable: true });
    }
    if (status === 400) {
      return Object.assign(new AppError(502, 'AI_REQUEST_REJECTED', 'The AI service rejected the request. Please modify your idea or try again.'), { retryable: false, badRequest: true });
    }
    // 5xx / network errors: transient.
    return Object.assign(new AppError(502, 'AI_PROVIDER_ERROR', 'The AI service is temporarily unavailable.'), { retryable: true });
  }

  /**
   * @param {{system: string, prompt: string, jsonSchema?: object, timeoutMs: number, isFallback?: boolean}} req
   * @returns {Promise<string>} raw model text
   */
  async function generateJson({ system, prompt, jsonSchema, timeoutMs, isFallback = false }) {
    const controller = new AbortController();
    let timedOut = false;
    let timer;
    const useSchema = Boolean(jsonSchema) && structuredOutputSupported && !isFallback;
    const thinkingConfig = getThinkingConfig(model);
    const config = {
      systemInstruction: system,
      responseMimeType: 'application/json',
      ...(useSchema ? { responseJsonSchema: jsonSchema } : {}),
      ...(thinkingConfig ? { thinkingConfig } : {}),
      maxOutputTokens: 16384,
      abortSignal: controller.signal,
      httpOptions: { timeout: timeoutMs },
    };
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('deadline exceeded')); }, timeoutMs);
    });
    try {
      const response = await Promise.race([
        ai.models.generateContent({ model, contents: prompt, config }),
        deadline,
      ]);
      const candidate = response?.candidates?.[0];
      let text = typeof response?.text === 'string' && response.text.trim()
        ? response.text.trim()
        : '';
      if (!text && Array.isArray(candidate?.content?.parts)) {
        text = candidate.content.parts
          .filter((p) => p && typeof p.text === 'string')
          .map((p) => p.text)
          .join('')
          .trim();
      }
      if (!text) {
        const finishReason = candidate?.finishReason ?? 'NO_CANDIDATE';
        const candidateCount = Array.isArray(response?.candidates) ? response.candidates.length : 0;
        const blockReason = response?.promptFeedback?.blockReason ?? 'NONE';
        const hasText = Boolean(typeof response?.text === 'string' && response.text.trim());
        logger.warn?.(`[gemini] empty response: finishReason=${finishReason}, candidates=${candidateCount}, blockReason=${blockReason}, hasText=${hasText}`);
        throw Object.assign(new AppError(502, 'AI_EMPTY_RESPONSE', 'The AI service returned no content.'), { retryable: true });
      }
      return text;
    } catch (err) {
      if (err instanceof AppError) throw err;
      const providerError = getProviderError(err, [apiKey, system, prompt]);
      const providerStatus = providerError?.status;
      const normalized = normalize(err, timedOut, providerStatus);
      if (providerError?.retryDelayMs) {
        normalized.retryAfterMs = providerError.retryDelayMs;
      }

      // Diagnostics without secrets: error class, HTTP status and low-level cause code.
      // For 400 rejections only, safely log sanitized provider message and structured details.
      const diag = [
        err?.name,
        err?.status ? `HTTP ${err.status}` : null,
        providerStatus ? `provider ${providerStatus}` : null,
        normalized.badRequest && providerError?.message ? `message ${JSON.stringify(providerError.message)}` : null,
        normalized.badRequest && providerError?.details ? `details ${JSON.stringify(providerError.details).slice(0, 2000)}` : null,
        err?.cause?.code ? `cause ${err.cause.code}` : null,
      ].filter(Boolean).join(', ');
      logger.warn?.(`[gemini] call failed: ${normalized.code}${diag ? ` (${diag})` : ''}`);

      // If a request with a schema was rejected with HTTP 400, immediately execute a real
      // fallback in schema-less JSON mode without burning caller retries. Guarded against loops.
      if (useSchema && normalized.badRequest && !isFallback) {
        structuredOutputSupported = false;
        logger.warn?.('[gemini] request rejected with a response schema; falling back to schema-less JSON mode');
        return generateJson({ system, prompt, jsonSchema: undefined, timeoutMs, isFallback: true });
      }

      throw normalized;
    } finally {
      clearTimeout(timer);
    }
  }

  return { generateJson, get structuredOutputSupported() { return structuredOutputSupported; } };
}
