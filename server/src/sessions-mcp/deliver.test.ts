import { describe, expect, it, vi } from 'vitest';
import { sendWhenIdle } from './deliver.js';

describe('sendWhenIdle', () => {
  it('idle: sent at once', () => {
    const r = { state: 'idle', send: vi.fn() };
    sendWhenIdle(r, 'hi');
    expect(r.send).toHaveBeenCalledWith('hi');
  });
  it('busy: waits for the turn to end, then sends once', async () => {
    vi.useFakeTimers();
    try {
      const r = { state: 'running', send: vi.fn() };
      sendWhenIdle(r, 'hi', { every: 100 });
      await vi.advanceTimersByTimeAsync(350);
      expect(r.send).not.toHaveBeenCalled();
      r.state = 'idle';
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(500);
      expect(r.send).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('gives up when the conversation closes or it waits too long', async () => {
    vi.useFakeTimers();
    try {
      const why: string[] = [];
      const a = { state: 'running', send: vi.fn() };
      sendWhenIdle(a, 'x', { every: 100, onGiveUp: (w) => why.push(w) });
      a.state = 'closed';
      await vi.advanceTimersByTimeAsync(100);
      const b = { state: 'waiting', send: vi.fn() };
      sendWhenIdle(b, 'y', { every: 100, maxMs: 250, onGiveUp: (w) => why.push(w) });
      await vi.advanceTimersByTimeAsync(400);
      expect(why).toEqual(['closed', 'timeout']);
      expect(a.send).not.toHaveBeenCalled();
      expect(b.send).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
