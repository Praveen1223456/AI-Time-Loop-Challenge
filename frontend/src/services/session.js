const KEY = 'timeloop.sessionId';

const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/[x]/g, () => Math.floor(Math.random() * 16).toString(16));

let memoryId = null; // fallback when storage is unavailable (private mode)

/**
 * Anonymous browser session ID (sent as X-Session-Id). It scopes "my games" on the server.
 * It is a capability, not an identity: clearing site data starts a new session.
 */
export function getSessionId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!/^[0-9a-f-]{36}$/i.test(id ?? '')) {
      id = uuid();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return (memoryId ??= uuid());
  }
}
