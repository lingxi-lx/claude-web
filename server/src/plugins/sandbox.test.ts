import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSandbox, hostAllowed, normalizeHost, PluginSandbox } from './sandbox.js';

describe('plugin sandbox', () => {
  it('defaults to no network and no files at all', () => {
    const s = new PluginSandbox();
    expect(s.check('example.com').ok).toBe(false);
    expect(s.check('example.com', 'state.json').ok).toBe(false);
    expect(s.check(undefined, '/etc/passwd').ok).toBe(false);
    expect(s.network).toEqual([]);
    expect(s.readRoots).toEqual([]);
    expect(s.writeRoots).toEqual([]);
    // a root alone is not a grant either; the runtime opts in explicitly
    expect(new PluginSandbox({}, { root: process.cwd() }).check(undefined, 'index.js').ok).toBe(false);
  });

  it('allows exact hosts and wildcard subdomains only', () => {
    const s = createSandbox({ network: ['api.example.com', '*.example.org'] });
    expect(s.check('api.example.com').ok).toBe(true);
    expect(s.check('API.EXAMPLE.COM.').ok).toBe(true);
    expect(s.check('foo.example.org').ok).toBe(true);
    expect(s.check('a.b.example.org').ok).toBe(true);
    expect(s.check('example.org').ok).toBe(false); // the apex is not `*.example.org`
    expect(s.check('api.example.com.evil.test').ok).toBe(false);
    expect(s.check('https://api.example.com/x').ok).toBe(false);
    expect(hostAllowed('x.example.org', ['*.example.org'])).toBe(true);
  });

  it('reads its own folder but does not write it; declared read/write roots are checked after resolution', () => {
    const root = path.join(process.cwd(), 'tmp-plugin-root');
    const out = path.join(process.cwd(), 'cache-out');
    const s = new PluginSandbox({ fileRead: ['data', path.join(process.cwd(), 'shared')], fileWrite: [out] }, { root, ownDir: true });
    expect(s.check(undefined, 'index.js').ok).toBe(true);
    expect(s.check(undefined, 'data/a.json').ok).toBe(true);
    expect(s.check(undefined, 'cache/a.json', 'write').ok).toBe(false); // own folder is read-only
    expect(s.check(undefined, path.join(out, 'a.json'), 'write').ok).toBe(true);
    expect(s.check(undefined, path.join(out, 'a.json'), 'read').ok).toBe(false); // write grant is not a read grant
    expect(s.check(undefined, 'index.js', 'write').ok).toBe(false);
    expect(s.check(undefined, '../outside.txt').ok).toBe(false);
    expect(s.check(undefined, path.join(process.cwd(), 'elsewhere.txt')).ok).toBe(false);
  });

  it('both checks together and reject bad input with a code', () => {
    const s = createSandbox({ network: ['example.com'], fileRead: ['x'] }, { root: process.cwd() });
    expect(s.check('example.com', 'x/y')).toEqual({ ok: true });
    expect(s.check('other.com', 'x/y')).toMatchObject({ ok: false, code: 'network' });
    expect(s.check('example.com', '../etc/passwd')).toMatchObject({ ok: false, code: 'fs' });
    expect(s.check('bad host', undefined)).toMatchObject({ ok: false, code: 'invalid' });
    expect(normalizeHost('Example.COM.')).toBe('example.com');
    expect(normalizeHost('user@example.com')).toBeNull();
  });

  it('refuses a manifest that declares a traversal path', () => {
    expect(() => new PluginSandbox({ fileRead: ['../secret'] }, { root: process.cwd() })).toThrow();
    expect(() => new PluginSandbox({ network: ['https://x.test'] })).toThrow();
  });
});
