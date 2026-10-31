import { getSessionId } from './session.js';

/** Base URL of the backend API. Configure with VITE_API_BASE_URL (see .env.example). */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(status, code, message, payload = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status; // 0 = network failure
    this.code = code;
    this.payload = payload;
  }
}

/**
 * Minimal JSON client. Resolves with the parsed `{ success, data }` payload on 2xx;
 * throws ApiError (with the parsed body attached) otherwise.
 */
export async function apiRequest(path, { method = 'GET', body, headers = {}, signal } = {}, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(`${API_BASE_URL}${path}`, {
      method,
      signal,
      headers: { Accept: 'application/json', 'X-Session-Id': getSessionId(), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server.');
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    /* non-JSON body */
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'HTTP_ERROR',
      payload?.error?.message ?? `Request failed with status ${response.status}.`,
      payload,
    );
  }
  return payload;
}

/**
 * Health check. The backend answers 503 (with a body) when it is up but its database is not,
 * so that case is returned as data rather than thrown. Network failures still throw.
 */
export async function getHealth(options = {}, fetchImpl = fetch) {
  try {
    return (await apiRequest('/health', options, fetchImpl)).data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 503 && err.payload?.data) return err.payload.data;
    throw err;
  }
}
