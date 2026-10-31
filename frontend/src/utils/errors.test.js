import { describe, it, expect } from 'vitest';
import { errorMessage } from './errors.js';

describe('errorMessage', () => {
  it('maps known codes to friendly text', () => {
    expect(errorMessage({ code: 'RATE_LIMITED' })).toMatch(/wait/i);
    expect(errorMessage({ code: 'AI_NOT_CONFIGURED' })).toMatch(/sample/i);
  });
  it('never shows raw server errors for 5xx', () => {
    expect(errorMessage({ status: 500, code: 'INTERNAL_ERROR', message: 'db password=hunter2' })).toBe('Something went wrong on the server.');
  });
  it('falls back to the message, then a generic one', () => {
    expect(errorMessage({ status: 400, message: 'Bad thing' })).toBe('Bad thing');
    expect(errorMessage(undefined)).toBe('Something went wrong.');
  });
});
