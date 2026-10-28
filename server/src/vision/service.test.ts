import { describe, expect, it } from 'vitest';
import { VisionService } from './service.js';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const IMAGE = b64('a screenshot');

describe('VisionService.describe', () => {
  it('fails closed when no model is configured, and does not cache that', async () => {
    const svc = new VisionService();
    const r = await svc.describe({ image: IMAGE, question: 'What is here?' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('unavailable');
      expect(r.error).toContain('没有配置看图模型');
    }
    expect(svc.cacheSize).toBe(0);
    expect(svc.configured).toBe(false);
  });

  it('describes through the injected caller and caches by image + question', async () => {
    let calls = 0;
    const svc = new VisionService({ call: async (req) => { calls++; expect(req.signal).toBeInstanceOf(AbortSignal); return `  a save button (${req.mimeType})  `; } });
    const first = await svc.describe({ image: IMAGE, question: 'Where is Save?' });
    const second = await svc.describe({ image: IMAGE, question: 'where is save?' });
    expect(first.ok && first.text).toBe('a save button (image/jpeg)');
    expect(first.ok && first.cached).toBe(false);
    expect(second.ok && second.cached).toBe(true);
    expect(calls).toBe(1);
    expect(svc.cacheSize).toBe(1);
    if (first.ok) expect(first.sha256).toHaveLength(64);
  });

  it('asks again for a different question or a different picture', async () => {
    let calls = 0;
    const svc = new VisionService({ call: async () => { calls++; return 'answer'; } });
    await svc.describe({ image: IMAGE, question: 'one' });
    await svc.describe({ image: IMAGE, question: 'two' });
    await svc.describe({ image: b64('another'), question: 'one' });
    expect(calls).toBe(3);
    expect(svc.cacheSize).toBe(3);
  });

  it('never caches a failure', async () => {
    let calls = 0;
    const svc = new VisionService({
      call: async () => {
        calls++;
        if (calls === 1) throw new Error('model down');
        return 'recovered';
      },
    });
    const first = await svc.describe({ image: IMAGE, question: 'q' });
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.code).toBe('failed');
    expect(svc.cacheSize).toBe(0);
    const second = await svc.describe({ image: IMAGE, question: 'q' });
    expect(second.ok && second.text).toBe('recovered');
    expect(calls).toBe(2);
  });

  it('treats an empty answer as a failure', async () => {
    const svc = new VisionService({ call: async () => '   ' });
    const r = await svc.describe({ image: IMAGE, question: 'q' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('empty');
    expect(svc.cacheSize).toBe(0);
  });

  it('fails closed on a timeout and aborts the caller', async () => {
    let sawAbort = false;
    const svc = new VisionService({
      timeoutMs: 100,
      call: (req) => new Promise<string>((_, reject) => {
        req.signal.addEventListener('abort', () => { sawAbort = true; reject(new Error('aborted')); }, { once: true });
      }),
    });
    const r = await svc.describe({ image: IMAGE, question: 'q' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('timeout');
    expect(sawAbort).toBe(true);
    expect(svc.cacheSize).toBe(0);
  });

  it('stops on an external abort', async () => {
    const ctrl = new AbortController();
    const svc = new VisionService({
      call: (req) => new Promise<string>((_, reject) => {
        req.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true });
      }),
    });
    const p = svc.describe({ image: IMAGE, question: 'q' }, { signal: ctrl.signal });
    ctrl.abort();
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('aborted');
  });

  it('rejects an empty picture or question as invalid', async () => {
    const svc = new VisionService({ call: async () => 'x' });
    for (const req of [{ image: '', question: 'q' }, { image: IMAGE, question: ' ' }, { image: IMAGE, mimeType: 'text/plain', question: 'q' }]) {
      const r = await svc.describe(req as any);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('invalid');
    }
  });

  it('reports timings with the injected clock and allows clearing the cache', async () => {
    let now = 1000;
    const svc = new VisionService({ call: async () => { now += 50; return 'x'; }, now: () => now });
    const first = await svc.describe({ image: IMAGE, question: 'q' });
    expect(first.ok && first.ms).toBe(50);
    const second = await svc.describe({ image: IMAGE, question: 'q' });
    expect(second.ok && second.cached).toBe(true);
    expect(second.ok && second.ms).toBe(0);
    svc.clearCache();
    expect(svc.cacheSize).toBe(0);
  });
});
