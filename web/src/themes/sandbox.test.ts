import { describe, expect, it } from 'vitest';
import { BLOCKED, loadBackdrop, lockdown } from './sandbox';

describe('lockdown', () => {
  it('takes the network away from a scope', () => {
    const scope: Record<string, unknown> = { fetch: () => 1, WebSocket: class {}, XMLHttpRequest: class {}, importScripts: () => 1, EventSource: class {}, keep: 1 };
    lockdown(scope);
    for (const k of BLOCKED) expect(scope[k], k).toBeUndefined();
    expect(scope.keep).toBe(1);
    // and it cannot be put back
    expect(() => { scope.fetch = () => 2; }).toThrow();
    expect(scope.fetch).toBeUndefined();
  });
});

describe('loadBackdrop', () => {
  it('evaluates export default', () => {
    const m = loadBackdrop('const n = 2;\nexport default { frame() { return n; } }');
    expect(typeof m.frame).toBe('function');
  });
  it('rejects a module without frame, and a syntax error', () => {
    expect(() => loadBackdrop('export default {}')).toThrow(/frame/);
    expect(() => loadBackdrop('export default { frame( }')).toThrow();
  });
});
