import { describe, it, expect } from 'vitest';
import { sameOriginRequest } from './same-origin.js';

const req = (headers: Record<string, string>) => ({ headers: { host: '127.0.0.1:3090', ...headers } });

describe('sameOriginRequest', () => {
  it('lets the app itself (same origin), the dev server proxy and header-less clients through', () => {
    expect(sameOriginRequest(req({ 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:3090' }))).toBe(true);
    expect(sameOriginRequest({ headers: { host: 'localhost:5173', origin: 'http://localhost:5173', 'sec-fetch-site': 'same-origin' } })).toBe(true);
    expect(sameOriginRequest(req({}))).toBe(true);
  });
  it('refuses a page on another website posting to this machine', () => {
    expect(sameOriginRequest(req({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }))).toBe(false);
    expect(sameOriginRequest(req({ 'sec-fetch-site': 'same-site' }))).toBe(false);
    expect(sameOriginRequest(req({ origin: 'https://evil.example' }))).toBe(false);
    expect(sameOriginRequest(req({ origin: 'null' }))).toBe(false);
    expect(sameOriginRequest(req({ origin: 'http://127.0.0.1:9999' }))).toBe(false);
  });
});
