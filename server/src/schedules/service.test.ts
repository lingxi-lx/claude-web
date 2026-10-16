import { describe, expect, it, vi } from 'vitest';
import { ScheduleService } from './service.js';

function fakeMeta(schedules: any[]) {
  return {
    schedules: () => schedules,
    touchSchedule: vi.fn(async (id: string, patch: any) => { Object.assign(schedules.find((s) => s.id === id), patch); }),
    addScheduleRun: vi.fn(async () => {}),
  };
}

describe('ScheduleService with a cron that never matches', () => {
  it('does not throw at startup and never sends the prompt', async () => {
    const sched = { id: 's1', enabled: true, cron: '0 0 30 2 *', prompt: 'hi', cwd: '.', nextRunAt: 0 };
    const meta = fakeMeta([sched]);
    const pool = { open: vi.fn() };
    let svc!: ScheduleService;
    expect(() => { svc = new ScheduleService(meta as any, pool as any); }).not.toThrow();
    await (svc as any).tick();
    await (svc as any).tick();
    expect(pool.open).not.toHaveBeenCalled();
    expect(sched).toHaveProperty('lastError');
    clearInterval((svc as any).timer);
  });
});

describe('ScheduleService: 手动, missed runs, each run in a worktree', () => {
  // a runner that is idle at once and never finishes its turn (run() waits for `result` in the background)
  const fakePool = () => {
    const runner = { state: 'idle', sessionId: 'sess', send: vi.fn(), on: vi.fn(), off: vi.fn(), once: vi.fn() };
    return { pool: { open: vi.fn(() => runner) }, runner };
  };
  const svcOf = (schedules: any[], pool: any) => {
    const svc = new ScheduleService(fakeMeta(schedules) as any, pool);
    clearInterval((svc as any).timer);
    return svc;
  };

  it('a manual task is never started by the timer', async () => {
    const { pool } = fakePool();
    const svc = svcOf([{ id: 'm', enabled: true, manual: true, cron: '* * * * *', prompt: 'hi', cwd: '.', nextRunAt: 1 }], pool);
    await (svc as any).tick();
    expect(pool.open).not.toHaveBeenCalled();
  });

  it('missed within seven days: runs once and tells the user it is a catch-up', async () => {
    const { pool, runner } = fakePool();
    const sched = { id: 'c', name: 'daily', enabled: true, cron: '0 9 * * *', prompt: 'hi', cwd: '.', nextRunAt: Date.now() - 2 * 24 * 3600_000 };
    const svc = svcOf([sched], pool);
    const notices: any[] = [];
    svc.on('notice', (n) => notices.push(n));
    void (svc as any).tick();
    await vi.waitFor(() => expect(runner.send).toHaveBeenCalledWith('hi'));
    expect(notices).toHaveLength(1);
    expect(notices[0].notify).toBe(true);
    expect(sched.nextRunAt).toBeGreaterThan(Date.now()); // once: the next time is from now, not each missed day
  });

  it('missed more than seven days ago: dropped — the next time is recomputed, nothing runs', async () => {
    const { pool } = fakePool();
    const sched = { id: 'd', name: 'old', enabled: true, cron: '0 9 * * *', prompt: 'hi', cwd: '.', nextRunAt: Date.now() - 9 * 24 * 3600_000 };
    const svc = svcOf([sched], pool);
    await (svc as any).tick();
    expect(pool.open).not.toHaveBeenCalled();
    expect(sched.nextRunAt).toBeGreaterThan(Date.now());
  });

  it('立即运行 on a busy conversation leaves the next scheduled time alone and promises no retry', async () => {
    const { pool, runner } = fakePool();
    runner.state = 'running';
    const at = Date.now() + 5 * 3600_000;
    const sched: any = { id: 'b', name: 'busy', enabled: true, cron: '0 9 * * *', prompt: 'hi', cwd: '.', nextRunAt: at };
    const svc = svcOf([sched], pool);
    await svc.run(sched, true);
    expect(runner.send).not.toHaveBeenCalled();
    expect(sched.nextRunAt).toBe(at);
    expect(sched.lastError).not.toMatch(/重试/);
  });

  it('each run in its own worktree only when every run is a new conversation', async () => {
    const { pool } = fakePool();
    const fresh = { id: 'w1abcdef', name: 'w', enabled: true, cron: '0 9 * * *', prompt: 'hi', cwd: '/r', freshSession: true, worktree: true };
    const kept = { id: 'w2', name: 'w', enabled: true, cron: '0 9 * * *', prompt: 'hi', cwd: '/r', worktree: true };
    const svc = svcOf([fresh, kept], pool);
    void svc.run(fresh as any, true);
    await vi.waitFor(() => expect(pool.open).toHaveBeenCalled());
    expect((pool.open.mock.calls[0] as any[])[0].worktree).toMatch(/^sched-w1abcd-\d{8}$/);
    void svc.run(kept as any, true);
    await vi.waitFor(() => expect(pool.open).toHaveBeenCalledTimes(2));
    expect((pool.open.mock.calls[1] as any[])[0].worktree).toBeUndefined();
  });
});
