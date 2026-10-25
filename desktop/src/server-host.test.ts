import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeProc extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill() { this.killed = true; return true; }
  postMessage() {}
}
const procs: FakeProc[] = [];

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => require('node:os').tmpdir(), getLocale: () => 'zh-CN' },
  utilityProcess: { fork: () => { const p = new FakeProc(); procs.push(p); return p; } },
}));
vi.mock('node:fs', async (orig) => {
  const fs = (await orig()) as typeof import('node:fs');
  return { ...fs, default: { ...fs, existsSync: () => true, appendFileSync: () => {} }, existsSync: () => true, appendFileSync: () => {} };
});

const { ServerHost, SLOW_START_MS, START_TIMEOUT_MS } = await import('./server-host');

describe('starting the server', () => {
  beforeEach(() => { vi.useFakeTimers(); procs.length = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it('waits for a server that is only slow (a busy PC: 34 s and 41 s were seen) and says so once', async () => {
    const host = new ServerHost();
    const slow = vi.fn();
    host.on('slow', slow);
    let info: unknown;
    void host.start().then((i) => { info = i; });
    await vi.advanceTimersByTimeAsync(SLOW_START_MS - 1);
    expect(slow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(41_000 - SLOW_START_MS + 1);
    expect(slow).toHaveBeenCalledTimes(1);
    procs[0].emit('message', { type: 'ready', port: 1234, host: '127.0.0.1' });
    await vi.advanceTimersByTimeAsync(0);
    expect(info).toMatchObject({ port: 1234 });
    expect(procs[0].killed).toBe(false);
  });

  it('a quick start never reports slow', async () => {
    const host = new ServerHost();
    const slow = vi.fn();
    host.on('slow', slow);
    const p = host.start();
    procs[0].emit('message', { type: 'ready', port: 1, host: '127.0.0.1' });
    await p;
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS * 2);
    expect(slow).not.toHaveBeenCalled();
  });

  it('gives up only at the limit, and stops the server it gave up on', async () => {
    const host = new ServerHost();
    let err: Error | undefined;
    void host.start().catch((e) => { err = e; });
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS - 1);
    expect(err).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(err?.message).toMatch(/did not become ready/);
    expect(procs[0].killed).toBe(true);
  });

  it('a ready that arrives after giving up is ignored: no ready, no crash, no restart', async () => {
    const host = new ServerHost();
    const ready = vi.fn();
    const crash = vi.fn();
    host.on('ready', ready);
    host.on('crash', crash);
    void host.start().catch(() => {});
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS);
    procs[0].emit('message', { type: 'ready', port: 1, host: '127.0.0.1' });
    procs[0].emit('exit', 0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ready).not.toHaveBeenCalled();
    expect(crash).not.toHaveBeenCalled();
    expect(host.info).toBeNull();
    expect(procs).toHaveLength(1);
  });
});
