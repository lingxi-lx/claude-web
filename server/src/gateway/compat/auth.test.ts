import { describe, expect, it } from 'vitest';
import { readKey, readKeys } from './auth.js';

const url = (search = '') => new URL(`http://127.0.0.1:3090/v1/models${search}`);

describe('compat auth', () => {
  it('reads Bearer, x-api-key and x-goog-api-key', () => {
    expect(readKey({ authorization: 'Bearer sk-bearer' }, url())).toBe('sk-bearer');
    expect(readKey({ 'x-api-key': 'sk-ant' }, url())).toBe('sk-ant');
    expect(readKey({ 'x-goog-api-key': 'g-key' }, url())).toBe('g-key');
  });

  it('accepts header names in any case and trims the value', () => {
    expect(readKey({ Authorization: 'bearer   sk-x  ' }, url())).toBe('sk-x');
    expect(readKey({ 'X-Api-Key': ' k ' }, url())).toBe('k');
  });

  it('reads ?key= and can refuse it', () => {
    expect(readKey({}, url('?key=q-key'))).toBe('q-key');
    expect(readKey({}, url('?key='))).toBeUndefined();
    expect(readKey({}, url('?key=q-key'), { allowQuery: false })).toBeUndefined();
  });

  it('returns all presented credentials in preference order', () => {
    const headers = { authorization: 'Bearer b', 'x-api-key': 'a', 'x-goog-api-key': 'g' };
    expect(readKeys(headers, url('?key=q'))).toEqual([
      { key: 'b', source: 'bearer' },
      { key: 'a', source: 'x-api-key' },
      { key: 'g', source: 'x-goog-api-key' },
      { key: 'q', source: 'query' },
    ]);
    expect(readKey(headers, url('?key=q'))).toBe('b');
  });

  it('skips empty entries but keeps the next credential', () => {
    expect(readKey({ authorization: '', 'x-api-key': '  ' }, url())).toBeUndefined();
    expect(readKey({ authorization: 'Bearer ', 'x-api-key': 'good' }, url())).toBe('good');
  });

  it('accepts a request-like object as well as a bare header bag', () => {
    expect(readKey({ headers: { authorization: 'Bearer sk-req' } }, url())).toBe('sk-req');
    expect(readKey({ headers: { 'x-goog-api-key': 'g' } }, url('?key=q'))).toBe('g');
  });

  it('returns undefined when nothing was presented', () => {
    expect(readKey({}, url())).toBeUndefined();
    expect(readKey(undefined, undefined)).toBeUndefined();
  });
});
