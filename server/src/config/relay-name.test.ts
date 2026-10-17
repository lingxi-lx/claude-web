import { describe, expect, it } from 'vitest';
import { relayName } from './service.js';

describe('relayName (the 「Claude 账号」 that is really a relay)', () => {
  it('a base URL reads as its host; only a key reads as API Key', () => {
    expect(relayName('https://api.super-nb.me/v1 ')).toBe('api.super-nb.me');
    expect(relayName('http://127.0.0.1:8080')).toBe('127.0.0.1:8080');
    expect(relayName(undefined)).toBe('API Key');
    expect(relayName('not a url')).toBe('not a url');
  });
});
