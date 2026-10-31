import { describe, it, expect, vi } from 'vitest';
import { apiRequest, getHealth, ApiError, API_BASE_URL } from './api.js';

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('apiRequest', () => {
  it('uses the configured base URL (default targets the local API)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data: 1 }));
    await apiRequest('/health', {}, fetchImpl);
    expect(API_BASE_URL).toBe('http://localhost:5000/api/v1');
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:5000/api/v1/health');
  });

  it('sends JSON bodies and custom headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { success: true }));
    await apiRequest('/x', { method: 'POST', body: { a: 1 }, headers: { 'X-Session-Id': 's' } }, fetchImpl);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', 'X-Session-Id': 's' });
  });

  it('always sends the anonymous session header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { success: true }));
    await apiRequest('/games', {}, fetchImpl);
    expect(fetchImpl.mock.calls[0][1].headers['X-Session-Id']).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('maps API error bodies to ApiError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { success: false, error: { code: 'LOOP_ENDED', message: 'Time is up' } }));
    await expect(apiRequest('/x', {}, fetchImpl)).rejects.toMatchObject({ name: 'ApiError', status: 409, code: 'LOOP_ENDED', message: 'Time is up' });
  });

  it('maps network failures to status 0', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(apiRequest('/x', {}, fetchImpl)).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('tolerates non-JSON error bodies', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('not json'); } });
    await expect(apiRequest('/x', {}, fetchImpl)).rejects.toMatchObject({ status: 502, code: 'HTTP_ERROR' });
  });

  it('re-throws aborts untouched so callers can ignore them', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    await expect(apiRequest('/x', {}, vi.fn().mockRejectedValue(abort))).rejects.toBe(abort);
  });
});

describe('getHealth', () => {
  it('returns data when healthy', async () => {
    const data = { status: 'ok', database: { status: 'connected' } };
    expect(await getHealth({}, vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data })))).toEqual(data);
  });
  it('returns the degraded body instead of throwing on 503', async () => {
    const data = { status: 'degraded', database: { status: 'disconnected' } };
    expect(await getHealth({}, vi.fn().mockResolvedValue(jsonResponse(503, { success: false, data })))).toEqual(data);
  });
  it('still throws on network failure and on other errors', async () => {
    await expect(getHealth({}, vi.fn().mockRejectedValue(new TypeError('x')))).rejects.toBeInstanceOf(ApiError);
    await expect(getHealth({}, vi.fn().mockResolvedValue(jsonResponse(500, { success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } })))).rejects.toMatchObject({ status: 500 });
  });
});
