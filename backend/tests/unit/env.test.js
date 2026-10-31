import { describe, it, expect } from 'vitest';
import { loadEnv, EnvValidationError } from '../../src/config/env.js';

describe('loadEnv', () => {
  it('applies defaults and normalizes CLIENT_URL to an origin', () => {
    const env = loadEnv({ NODE_ENV: 'development', MONGODB_URI: 'mongodb://127.0.0.1:27017/x', CLIENT_URL: 'http://localhost:5173/' });
    expect(env.PORT).toBe(5000);
    expect(env.CLIENT_URL).toBe('http://localhost:5173');
  });

  it('requires MONGODB_URI outside of test mode', () => {
    expect(() => loadEnv({ NODE_ENV: 'development' })).toThrow(EnvValidationError);
    expect(() => loadEnv({ NODE_ENV: 'production', MONGODB_URI: '' })).toThrow(/MONGODB_URI: is required/);
  });

  it('does not require MONGODB_URI in test mode', () => {
    expect(loadEnv({ NODE_ENV: 'test' }).MONGODB_URI).toBeUndefined();
  });

  it('rejects malformed values without echoing them', () => {
    const secret = 'super-secret-token';
    try {
      loadEnv({ NODE_ENV: 'development', MONGODB_URI: `http://user:${secret}@host/db`, PORT: 'abc' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      expect(err.message).toMatch(/MONGODB_URI/);
      expect(err.message).toMatch(/PORT/);
      expect(err.message).not.toContain(secret);
    }
  });

  it('treats empty strings (KEY=) as unset', () => {
    const env = loadEnv({ NODE_ENV: 'test', GEMINI_API_KEY: '', PORT: '' });
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.PORT).toBe(5000);
  });
});
