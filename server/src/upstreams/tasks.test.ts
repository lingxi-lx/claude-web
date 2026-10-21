import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MetaStore } from '../meta/store.js';
import { MaintenanceScheduler } from './tasks.js';
import type { MaintenanceKind, UpstreamAccount } from './types.js';

const account = (id: string, kind: UpstreamAccount['kind']): UpstreamAccount => ({
  id, kind, name: id, enabled: true, credential: 'enc:x', credentialKind: 'token', source: 'paste',
  createdAt: 1, updatedAt: 1, health: 'ok',
});

async function make(opts: { start?: number; now?: () => number; run?: (id: string, kind: MaintenanceKind) => Promise<any> } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-tasks-'));
  const meta = new MetaStore(path.join(dir, 'meta.json'));
  await meta.load();
  const accounts = [account('a1', 'workbuddy'), account('a2', 'gemini'), account('a3', 'claude')];
  const calls: { id: string; kind: MaintenanceKind }[] = [];
  const upstreams = {
    store: { get: (id: string) => accounts.find((a) => a.id === id), setHealth: async () => {} },
    groups: () => [{ id: 'g1', kind: 'workbuddy', name: 'G', strategy: 'failover', members: ['a1', 'a2', 'a3'], enabled: true, createdAt: 1 }],
    familyTasks: (kind: UpstreamAccount['kind']): MaintenanceKind[] =>
      kind === 'gemini' ? ['keepalive', 'account-check', 'quota-refresh'] : kind === 'workbuddy' ? ['checkin', 'keepalive', 'travel', 'lottery'] : ['account-check', 'quota-refresh'],
    runAccountTask: async (id: string, kind: MaintenanceKind) => {
      calls.push({ id, kind });
      return opts.run ? opts.run(id, kind) : { ok: true, detail: 'done' };
    },
  } as any;
  let now = opts.now ?? (() => opts.start ?? Date.UTC(2026, 9, 19, 12, 0, 0));
  const tasks = new MaintenanceScheduler({ meta, upstreams, now: () => now(), tickMs: 1_000_000 });
  return { meta, tasks, calls, setNow: (n: number) => { now = () => n; }, getNow: () => now() };
}

describe('MaintenanceScheduler', () => {
  it('runs a due task, records one run per slot and ignores the same slot twice', async () => {
    const { tasks, calls, setNow, getNow } = await make();
    const task = await tasks.upsert({ kind: 'keepalive', target: { kind: 'account', accountId: 'a1' }, schedule: { everyMinutes: 60 } });
    expect(task.nextRunAt).toBe(getNow() + 60 * 60_000);
    const firstSlot = task.nextRunAt!;

    setNow(getNow() + 61 * 60_000);
    await tasks.tick(getNow());
    expect(calls).toEqual([{ id: 'a1', kind: 'keepalive' }]);
    expect(tasks.runs()).toHaveLength(1);
    expect(tasks.runs()[0]).toMatchObject({ taskId: task.id, accountId: 'a1', ok: true });

    // same slot again: the idempotency key is the slot, not the wall clock
    await tasks.tick(getNow());
    expect(tasks.runs()).toHaveLength(1);
    tasks.list()[0].nextRunAt = firstSlot;
    await tasks.tick(getNow());
    expect(tasks.runs()).toHaveLength(1);
  });

  it('runs a missed task once within seven days and drops anything older', async () => {
    const { tasks, calls, setNow, getNow } = await make();
    const task = await tasks.upsert({ kind: 'keepalive', target: { kind: 'account', accountId: 'a2' }, schedule: { everyMinutes: 60 } });
    task.nextRunAt = getNow() - 24 * 3600_000;
    await tasks.tick(getNow());
    expect(calls).toHaveLength(1);

    task.nextRunAt = getNow() - 8 * 24 * 3600_000;
    setNow(getNow() + 1_000);
    await tasks.tick(getNow());
    expect(calls).toHaveLength(1);
    expect(tasks.list()[0].nextRunAt).toBeGreaterThan(getNow());
  });

  it('targets the accounts of a pool that support the task, and runs manually on demand', async () => {
    const { tasks, calls } = await make();
    const task = await tasks.upsert({ name: '晚间任务', kind: 'checkin', target: { kind: 'group', groupId: 'g1' }, schedule: { cron: '0 20 * * *' } });
    const runs = await tasks.run(task.id);
    expect(runs.map((r) => r.accountId)).toEqual(['a1']); // Gemini / Claude have no check-in
    expect(calls).toEqual([{ id: 'a1', kind: 'checkin' }]);
    // a manual run is not blocked by the daily idempotency key
    await tasks.run(task.id);
    expect(calls).toHaveLength(2);
  });

  it('never runs the same task twice at once', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { tasks, calls, setNow, getNow } = await make({
      run: async () => { await gate; return { ok: true }; },
    });
    const task = await tasks.upsert({ kind: 'keepalive', target: { kind: 'account', accountId: 'a1' }, schedule: { everyMinutes: 60 } });
    task.nextRunAt = getNow() - 1_000;
    const first = tasks.tick(getNow());
    const second = tasks.tick(getNow());
    release();
    await Promise.all([first, second]);
    expect(calls).toHaveLength(1);
    setNow(getNow() + 1_000);
  });

  it('runs a daily task once per local day, not per UTC date', async () => {
    const start = new Date(2026, 9, 20, 0, 30, 0).getTime();
    const { tasks, calls, setNow } = await make({ start });
    const task = await tasks.upsert({ kind: 'checkin', target: { kind: 'account', accountId: 'a1' }, schedule: { everyMinutes: 60 } });
    task.nextRunAt = start - 1_000;
    await tasks.tick(start);
    expect(calls).toHaveLength(1);
    // 09:00 the same local day: in +08:00 this is a different UTC date than 00:30
    const later = new Date(2026, 9, 20, 9, 0, 0).getTime();
    setNow(later);
    tasks.list()[0].nextRunAt = later - 1_000;
    await tasks.tick(later);
    expect(calls).toHaveLength(1);
  });

  it('rejects an invalid schedule, target, or kind before saving', async () => {
    const { tasks } = await make();
    await expect(tasks.upsert({ kind: 'checkin', target: { kind: 'account', accountId: 'nope' }, schedule: { cron: '0 8 * * *' } })).rejects.toThrow(/账号/);
    await expect(tasks.upsert({ kind: 'checkin', target: { kind: 'account', accountId: 'a1' }, schedule: { everyMinutes: 1 } })).rejects.toThrow(/5 分钟/);
    await expect(tasks.upsert({ kind: 'checkin', target: { kind: 'account', accountId: 'a1' }, schedule: { cron: 'bad' } })).rejects.toThrow();
    expect(tasks.list()).toHaveLength(0);
  });

  it('keeps only the last 500 runs', async () => {
    const { tasks, meta } = await make();
    const task = await tasks.upsert({ kind: 'keepalive', target: { kind: 'account', accountId: 'a1' }, schedule: { everyMinutes: 60 } });
    for (let i = 0; i < 520; i++) {
      meta.maintenanceRuns().push({ id: `seed_${i}`, taskId: task.id, at: i, ok: true, durationMs: 0, idempotencyKey: `seed:${i}` });
    }
    await tasks.run(task.id);
    expect(meta.maintenanceRuns()).toHaveLength(500);
    expect(meta.maintenanceRuns().at(-1)?.idempotencyKey).toContain('manual');
  });
});
