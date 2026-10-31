import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSessionId } from './session.js';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('getSessionId', () => {
  it('creates a UUID once and reuses it', () => {
    const a = getSessionId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(getSessionId()).toBe(a);
    expect(localStorage.getItem('timeloop.sessionId')).toBe(a);
  });
  it('replaces a corrupted stored value', () => {
    localStorage.setItem('timeloop.sessionId', 'not-a-uuid');
    expect(getSessionId()).toMatch(/^[0-9a-f-]{36}$/i);
  });
  it('still works when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const id = getSessionId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(getSessionId()).toBe(id);
  });
});
