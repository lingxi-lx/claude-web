import { describe, expect, it } from 'vitest';
import { isCompatible, parseMarketCatalog, parseMarketEntry, safeMarketUrl, searchMarket } from './market.js';

const entry = {
  id: 'com.example.relay',
  name: 'Relay tools',
  author: 'Example',
  description: 'A provider plugin',
  categories: ['provider', 'middleware'],
  version: '2.0.0',
  downloads: 120,
  url: 'https://example.com/relay.tgz',
  sha256: 'a'.repeat(64),
  minAppVersion: '0.4.0',
  permissions: { network: ['api.example.com'], fileRead: ['data'] },
  hooks: ['request-before'],
};

describe('plugin market', () => {
  it('parses an entry as data, with https-only download URLs', () => {
    const e = parseMarketEntry(entry);
    expect(e.id).toBe('com.example.relay');
    expect(e.categories).toEqual(['provider', 'middleware']);
    expect(e.permissions.network).toEqual(['api.example.com']);
    expect(() => parseMarketEntry({ ...entry, url: 'http://example.com/x' })).toThrow();
    expect(() => parseMarketEntry({ ...entry, url: 'https://user:pass@example.com/x' })).toThrow();
    expect(() => parseMarketEntry({ ...entry, id: '../x' })).toThrow();
    expect(() => parseMarketEntry({ ...entry, permissions: { fileRead: ['../secret'] } })).toThrow();
    expect(() => parseMarketEntry({ ...entry, sha256: 'nope' })).toThrow();
  });

  it('keeps the valid entries and reports the invalid ones (one bad card does not hide the market)', () => {
    const catalog = parseMarketCatalog({ entries: [entry, { ...entry, id: 'com.example.two', downloads: 3 }, { ...entry, id: 'bad id' }, { ...entry }] });
    expect(catalog.entries.map((e) => e.id)).toEqual(['com.example.relay', 'com.example.two']);
    expect(catalog.errors).toHaveLength(2); // bad id + duplicate id
    expect(parseMarketCatalog(null).errors).toHaveLength(1);
  });

  it('searches / filters without any network call and sorts by downloads', () => {
    const a = parseMarketEntry(entry);
    const b = parseMarketEntry({ ...entry, id: 'com.example.theme', name: 'Blue theme', categories: ['theme'], downloads: 999 });
    expect(searchMarket([a, b], 'relay').map((e) => e.id)).toEqual(['com.example.relay']);
    expect(searchMarket([a, b], '', 'theme').map((e) => e.id)).toEqual(['com.example.theme']);
    expect(searchMarket([a, b]).map((e) => e.id)).toEqual(['com.example.theme', 'com.example.relay']);
  });

  it('checks the minimum app version and hides credentials in a display URL', () => {
    expect(isCompatible({ minAppVersion: '0.4.0' }, '0.4.1')).toBe(true);
    expect(isCompatible({ minAppVersion: '0.5.0' }, '0.4.9')).toBe(false);
    expect(isCompatible({}, '0.0.1')).toBe(true);
    expect(safeMarketUrl('https://example.com/path?token=x')).toBe('https://example.com/path');
  });
});
