import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSafeRelativePath, parseManifest, resolvePluginPath, validateManifest } from './manifest.js';

const valid = {
  id: 'com.example.plugin',
  name: 'Example',
  version: '1.2.3',
  main: 'index.js',
  hooks: ['request-before', 'response-after'],
  permissions: { network: ['api.example.com', '*.example.org'], fileRead: ['data'], fileWrite: ['cache'], secrets: ['provider:relay'] },
};

describe('plugin manifest', () => {
  it('parses a valid manifest and keeps only known fields', () => {
    const m = parseManifest({ ...valid, unknownField: 'ignored' });
    expect(m).toMatchObject({
      id: 'com.example.plugin', name: 'Example', version: '1.2.3', main: 'index.js',
      hooks: ['request-before', 'response-after'],
      permissions: { network: ['api.example.com', '*.example.org'], fileRead: ['data'], fileWrite: ['cache'], secrets: ['provider:relay'] },
    });
    expect('unknownField' in m).toBe(false);
  });

  it('defaults name / version / main but requires a valid id', () => {
    const m = parseManifest({ id: 'p' });
    expect(m).toMatchObject({ id: 'p', name: 'p', version: '0.0.0', main: 'index.js', hooks: [] });
    expect(parseManifest({ name: 'x' }, 'folder-id').id).toBe('folder-id');
    expect(() => parseManifest({ id: '../evil' })).toThrow();
    expect(() => parseManifest({ id: 'a'.repeat(65) })).toThrow();
    expect(() => parseManifest({ id: 'p', name: 3 })).toThrow();
    expect(() => parseManifest({ id: 'p', name: 'x'.repeat(101) })).toThrow();
  });

  it('rejects traversal in the entry and in permission paths, with both separators and absolute paths', () => {
    for (const main of ['../evil.js', '..\\evil.js', '/etc/passwd', 'C:\\Windows\\evil.js', 'a/../../evil.js', '~/evil.js']) {
      expect(() => parseManifest({ ...valid, main })).toThrow();
    }
    for (const fileRead of ['../secret', '..\\secret', 'a/../../secret', 'x\0y']) {
      expect(() => parseManifest({ ...valid, permissions: { fileRead: [fileRead] } })).toThrow();
    }
    expect(isSafeRelativePath('lib/index.js')).toBe(true);
    expect(isSafeRelativePath('lib\\index.js')).toBe(true);
    expect(isSafeRelativePath('../index.js')).toBe(false);
    expect(() => resolvePluginPath(path.join(process.cwd(), 'plugins', 'p'), '../x')).toThrow();
    expect(resolvePluginPath(path.join(process.cwd(), 'plugins', 'p'), 'lib/index.js')).toContain('lib');
  });

  it('accepts an explicit absolute read grant but never a traversal in it', () => {
    const m = parseManifest({ ...valid, permissions: { fileRead: ['/var/lib/example'] } });
    expect(m.permissions.fileRead).toEqual(['/var/lib/example']);
    expect(() => parseManifest({ ...valid, permissions: { fileRead: ['/var/../secret'] } })).toThrow();
  });

  it('rejects unknown hooks, bad versions, bad host patterns and unknown permission keys', () => {
    expect(() => parseManifest({ ...valid, hooks: ['onload'] })).toThrow();
    expect(() => parseManifest({ ...valid, version: 'v1' })).toThrow();
    expect(() => parseManifest({ ...valid, permissions: { network: ['https://example.com'] } })).toThrow();
    expect(() => parseManifest({ ...valid, permissions: { network: ['foo*.example.com'] } })).toThrow();
    expect(() => parseManifest({ ...valid, permissions: { filesystem: ['/'] } })).toThrow();
    expect(() => parseManifest({ ...valid, timeoutMs: 10 })).toThrow();
    expect(() => parseManifest({ ...valid, maxOutputBytes: 99 })).toThrow();
  });

  it('validateManifest turns a rejection into a message instead of throwing', () => {
    expect(validateManifest(valid).ok).toBe(true);
    const bad = validateManifest({ id: '../x' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]).toBeTruthy();
  });
});
