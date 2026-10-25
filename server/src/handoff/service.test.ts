import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { git } from './git.js';
import { HandoffService } from './service.js';

let root: string, repo: string, bare: string;
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const hashTree = (dir: string): string => {
  const h = crypto.createHash('sha256');
  const walk = (d: string) => { for (const n of fs.readdirSync(d).sort()) { if (n === '.git') continue; const p = path.join(d, n); h.update(path.relative(dir, p)); if (fs.lstatSync(p).isDirectory()) walk(p); else h.update(fs.readFileSync(p)); } };
  walk(dir); return h.digest('hex');
};
const state = async () => ({
  index: fs.readFileSync(path.join(repo, '.git', 'index')).toString('hex'),
  head: fs.readFileSync(path.join(repo, '.git', 'HEAD'), 'utf8'),
  sha: await git(repo, ['rev-parse', 'HEAD']),
  tree: hashTree(repo),
  stash: await git(repo, ['stash', 'list']),
});

function machines(o: { peerOnline?: boolean } = {}) {
  const metaA: Record<string, any> = {}, metaB: Record<string, any> = {};
  const transcripts: { cwd: string; sessionId: string; entries: any[] }[] = [];
  const opened: any[] = [];
  const sent: string[] = [];
  const stopped: string[] = [];
  const b = new HandoffService({
    meta: { sessionMeta: (id) => metaB[id] ?? {}, setSessionMeta: async (id, p) => { metaB[id] = { ...metaB[id], ...p }; } },
    request: async () => { throw new Error('B asks nobody'); },
    peers: () => [],
    summaryOf: async () => undefined,
    readAll: async () => [],
    open: (p) => { opened.push(p); return { sessionId: p.sessionId!, send: (t) => { sent.push(t); } }; },
    dataDir: path.join(root, 'B-data'),
    serverName: () => 'Box',
    writeTranscript: (cwd, sessionId, entries) => { transcripts.push({ cwd, sessionId, entries }); },
  });
  const a = new HandoffService({
    meta: { sessionMeta: (id) => metaA[id] ?? {}, setSessionMeta: async (id, p) => { metaA[id] = { ...metaA[id], ...p }; } },
    request: async (_peer, req: any) => {
      if (o.peerOnline === false) throw new Error('offline');
      if (req.kind === 'handoff.receive') return b.receive(req);
      if (req.kind === 'handoff.publish') return b.publish(req.branch);
      throw new Error(`unexpected ${req.kind}`);
    },
    peers: () => [{ id: 'p1', name: 'Box', enabled: true, state: 'online', alwaysOn: true }],
    summaryOf: async (id) => (id === 's1' ? { cwd: repo, title: 'Fix the parser' } : id === 'plain' ? { cwd: path.join(root, 'plain') } : undefined),
    readAll: async () => [
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'please fix the parser' }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'on it' }] } },
    ],
    stop: async (id) => { stopped.push(id); },
    dataDir: path.join(root, 'A-data'),
    serverName: () => 'Laptop',
  });
  return { a, b, metaA, metaB, transcripts, opened, sent, stopped };
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-hs-'));
  bare = path.join(root, 'remote.git'); repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(root, 'plain'));
  await git(root, ['init', '--bare', '-b', 'main', bare]);
  await git(root, ['init', '-b', 'main', repo]);
  fs.writeFileSync(path.join(repo, 'parser.ts'), 'export const x = 1;\n');
  await git(repo, ['add', '.']); await git(repo, [...ID, 'commit', '-m', 'init']);
  await git(repo, ['remote', 'add', 'origin', bare]); await git(repo, ['push', '-q', 'origin', 'main']);
  fs.writeFileSync(path.join(repo, 'parser.ts'), 'export const x = 2; // half done\n');
  fs.writeFileSync(path.join(repo, 'notes.md'), 'todo\n');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

describe('HandoffService', { timeout: 120_000 }, () => {
  it('check: only a Git project with a remote; a conversation on another machine or already handed off is refused', async () => {
    const m = machines();
    expect(await m.a.check('s1')).toMatchObject({ ok: true });
    expect((await m.a.check('plain')).ok).toBe(false);
    expect((await m.a.check('peer_p1~x')).ok).toBe(false);
    expect((await m.a.check('nope')).ok).toBe(false);
  });

  it('hands the work and the conversation to the always-on machine without touching the user\'s branch / index / work tree', async () => {
    const m = machines();
    const before = await state();
    // fix wave F2: the new file notes.md goes only because the user ticked 「包括新文件」
    const info = await m.a.start('s1', 'p1', 'carry on with the tests', { includeUntracked: true });
    expect(await state()).toEqual(before);
    expect(info).toMatchObject({ peerId: 'p1', peerName: 'Box', remote: 'origin', base: before.sha });
    expect(info.branch).toMatch(/^cw\/handoff-[0-9a-f]{8}$/);
    expect(await git(bare, ['rev-parse', `refs/heads/${info.branch}`])).toBe(info.commit);
    const { skipped: _skipped, ...stored } = info;
    expect(m.metaA.s1.handedOff).toEqual(stored);
    expect(m.stopped).toEqual(['s1']);
    // the peer: its own worktree with the uncommitted work, a transcript replaying the conversation, started with the next step
    const t = m.transcripts[0];
    expect(fs.readFileSync(path.join(t.cwd, 'parser.ts'), 'utf8').replace(/\r\n/g, '\n')).toBe('export const x = 2; // half done\n');
    expect(fs.existsSync(path.join(t.cwd, 'notes.md'))).toBe(true);
    expect(t.cwd.startsWith(path.join(root, 'B-data'))).toBe(true);
    expect(JSON.stringify(t.entries)).toContain('please fix the parser');
    expect(info.remoteSessionId).toBe(t.sessionId);
    expect(m.metaB[t.sessionId].handoffFrom).toMatchObject({ from: 'Laptop', branch: info.branch });
    expect(m.opened[0]).toMatchObject({ sessionId: t.sessionId, cwd: t.cwd });
    expect(m.sent).toEqual(['carry on with the tests']);
    // read-only here now
    expect((await m.a.check('s1')).ok).toBe(false);
  });

  it('取回: the peer pushes its work, this machine gets a new branch and the diff — nothing merged', async () => {
    const m = machines();
    const info = await m.a.start('s1', 'p1');
    expect(m.sent).toEqual([]); // no next step given: the conversation waits there
    fs.writeFileSync(path.join(m.transcripts[0].cwd, 'parser.ts'), 'export const x = 3; // done\n');
    const before = await state();
    const r = await m.a.fetchBack('s1');
    expect(r.saved).toBe(true);
    expect(r.branch).toBe(info.branch);
    expect(r.diff).toContain('x = 3');
    expect(await state()).toEqual(before);
    expect(m.metaA.s1.handedOff.fetched).toEqual([info.branch]);
  });

  it('a machine that is not online is refused before anything is pushed', async () => {
    const m = machines();
    (m.a as any).d.peers = () => [{ id: 'p1', name: 'Box', enabled: true, state: 'offline' }];
    await expect(m.a.start('s1', 'p1')).rejects.toThrow();
    expect(await git(bare, ['branch', '--list', 'cw/*'])).toBe('');
  });

  it('F2: without the tick the new files stay here; key files never go', async () => {
    const m = machines();
    fs.writeFileSync(path.join(repo, '.env'), 'KEY=1\n');
    const chk: any = await m.a.check('s1');
    expect(chk.untracked).toMatchObject({ count: 1, files: [{ path: 'notes.md' }], skipped: ['.env'] });
    const info = await m.a.start('s1', 'p1');
    await expect(git(repo, ['show', `${info.commit}:notes.md`])).rejects.toThrow();
    const m2 = machines();
    m2.metaA.s1 = {};
    const info2 = await m2.a.start('s1', 'p1', undefined, { includeUntracked: true });
    expect(await git(repo, ['show', `${info2.commit}:notes.md`])).toBe('todo');
    await expect(git(repo, ['show', `${info2.commit}:.env`])).rejects.toThrow();
    expect(info2.skipped).toEqual(['.env']);
  });

  it('F3: the peer failing after the push takes the branch off the remote again', async () => {
    const m = machines();
    (m.a as any).d.request = async () => { throw new Error('peer said no'); };
    await expect(m.a.start('s1', 'p1')).rejects.toThrow(/peer said no/);
    expect(await git(bare, ['branch', '--list', 'cw/*'])).toBe('');
    expect(m.metaA.s1?.handedOff).toBeUndefined();
    expect(m.stopped).toEqual([]);
  });

  it('F3: when the delete fails too, the error names the branch left on the remote', async () => {
    const m = machines();
    (m.a as any).d.request = async () => {
      // the remote goes away between the push and the delete
      fs.renameSync(bare, `${bare}-gone`);
      throw new Error('peer said no');
    };
    await expect(m.a.start('s1', 'p1')).rejects.toThrow(/cw\/handoff-[0-9a-f]{8}/);
    fs.renameSync(`${bare}-gone`, bare);
  });

  it('F4: a running turn is refused before any snapshot; one hand-off at a time; read-only while and after', async () => {
    const m = machines();
    (m.a as any).d.isRunning = (id: string) => id === 's1';
    await expect(m.a.start('s1', 'p1')).rejects.toThrow(/运行/);
    expect(await git(bare, ['branch', '--list', 'cw/*'])).toBe('');
    (m.a as any).d.isRunning = () => false;
    expect(m.a.isReadOnly('s1')).toBe(false);
    const first = m.a.start('s1', 'p1');
    expect(m.a.isReadOnly('s1')).toBe(true); // being handed: sends are refused already
    await expect(m.a.start('s1', 'p1')).rejects.toThrow(/正在交接/);
    await first;
    expect(m.a.isReadOnly('s1')).toBe(true);
    expect(await git(bare, ['branch', '--list', 'cw/*'])).not.toBe('');
  });

  it('取回 passes on why the machine could not save its work', async () => {
    const m = machines();
    await m.a.start('s1', 'p1');
    const real = (m.a as any).d.request;
    (m.a as any).d.request = async (peer: string, req: any) => { if (req.kind === 'handoff.publish') throw new Error('disk full'); return real(peer, req); };
    const r = await m.a.fetchBack('s1');
    expect(r).toMatchObject({ saved: false, saveError: 'disk full' });
  });

  it('receive refuses a bad branch name or remote', async () => {
    const m = machines();
    await expect(m.b.receive({ kind: 'handoff.receive', id: 'x', url: bare, branch: 'main', events: [], from: 'A' })).rejects.toThrow();
    await expect(m.b.receive({ kind: 'handoff.receive', id: 'x', url: '--upload-pack=evil', branch: 'cw/handoff-x', events: [], from: 'A' })).rejects.toThrow();
  });
});
