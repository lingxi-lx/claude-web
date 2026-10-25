import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MetaStore } from './store.js';

const dirs: string[] = [];
async function tmpFile() {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-meta-'));
  dirs.push(d);
  return path.join(d, 'meta.json');
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

describe('MetaStore', () => {
  it('keeps saving after one save fails', async () => {
    const file = await tmpFile();
    const m = new MetaStore(file);
    await m.load();
    // make the target a directory: this save fails
    await fs.mkdir(file);
    await expect(m.setSetting('a', 1)).rejects.toBeTruthy();
    await fs.rm(file, { recursive: true });
    // the next one must actually write, not inherit the earlier rejection
    await m.setSetting('b', 2);
    const disk = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(disk.settings).toEqual({ a: 1, b: 2 });
  });

  it('backs up an unparsable file instead of silently dropping it', async () => {
    const file = await tmpFile();
    await fs.writeFile(file, '{"workspaces": [ {"id": "x"', 'utf8');
    const m = new MetaStore(file);
    await m.load();
    const siblings = await fs.readdir(path.dirname(file));
    expect(siblings.some((f) => f.startsWith('meta.json.corrupt-'))).toBe(true);
  });

  it('null clears a profile’s 自动压缩 point and windows (the editor’s 跟着上下文窗口)', async () => {
    const m = new MetaStore(await tmpFile());
    await m.load();
    const p = await m.upsertProvider({ name: 'acct', type: 'claude-account', compactAt: 700_000, contextWindows: { opus: 200_000 } });
    await m.upsertProvider({ id: p.id, compactAt: null as unknown as undefined, contextWindows: null as unknown as undefined });
    const after = m.providers().find((x) => x.id === p.id)!;
    expect('compactAt' in after).toBe(false);
    expect('contextWindows' in after).toBe(false);
  });

  it('round-trips through load', async () => {
    const file = await tmpFile();
    const a = new MetaStore(file);
    await a.addWorkspace(path.dirname(file));
    const b = new MetaStore(file);
    await b.load();
    expect(b.workspaces()).toHaveLength(1);
    expect((await fs.readdir(path.dirname(file))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('workspaces: old data has no folders → [] on read; updateWorkspace adds and removes them', async () => {
    const file = await tmpFile();
    const main = path.join(path.dirname(file), 'proj');
    const extra = path.join(path.dirname(file), 'lib');
    await fs.writeFile(file, JSON.stringify({ version: 1, workspaces: [{ id: 'w1', path: main, name: 'proj', addedAt: 1, order: 0 }], sessions: {}, schedules: [], scheduleRuns: [], settings: {}, providers: [], feedback: {}, drafts: {}, devices: [], remoteHosts: [], imGateways: [], imBindings: [], goals: [] }), 'utf8');
    const m = new MetaStore(file);
    await m.load();
    expect(m.workspaces()[0].folders).toEqual([]);
    const w = await m.updateWorkspace('w1', { folders: [extra, main, extra] });
    expect(w?.folders).toEqual([extra]);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).workspaces[0].folders).toEqual([extra]);
    await m.updateWorkspace('w1', { name: '新名字', folders: [] });
    expect(m.workspaces()[0]).toMatchObject({ name: '新名字', folders: [] });
    expect(await m.updateWorkspace('nope', { name: 'x' })).toBeNull();
  });

  it('项目页 (stage F2): instructions, sessions scope and permission mode are stored; null / empty clears them', async () => {
    const file = await tmpFile();
    const m = new MetaStore(file);
    await m.load();
    const w0 = await m.addWorkspace(path.join(path.dirname(file), 'proj'));
    const w = await m.updateWorkspace(w0.id, { instructions: 'Use pnpm.', sessionsScope: 'project', permissionMode: 'acceptEdits' });
    expect(w).toMatchObject({ instructions: 'Use pnpm.', sessionsScope: 'project', permissionMode: 'acceptEdits' });
    const saved = JSON.parse(await fs.readFile(file, 'utf8')).workspaces[0];
    expect(saved).toMatchObject({ instructions: 'Use pnpm.', sessionsScope: 'project', permissionMode: 'acceptEdits' });
    // a name-only update leaves them alone
    await m.updateWorkspace(w0.id, { name: 'x' });
    expect(m.workspaces()[0]).toMatchObject({ instructions: 'Use pnpm.', sessionsScope: 'project' });
    await m.updateWorkspace(w0.id, { instructions: '  ', sessionsScope: null, permissionMode: null });
    const cleared = m.workspaces()[0];
    expect(cleared.instructions).toBeUndefined();
    expect(cleared.sessionsScope).toBeUndefined();
    expect(cleared.permissionMode).toBeUndefined();
  });
});
