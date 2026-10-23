import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { DshSource, decodeZstdFrames, dshCwd, dshMessages, pickLog } from './dsh-source.js';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-dsh-'));
const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NEW = '11111111-2222-3333-4444-555555555555';
const PROJECT = '--C-Users-me-demo--';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const SHA = 'ab'.repeat(32);

// the shapes below are copied from real logs (dsh 0.2.1-rc.2: a v0 `session.jsonl.zstd` and the v4 one it migrated to)
const header = (id: string, extra: Record<string, unknown> = {}) => JSON.stringify({ type: 'session', version: 1, id, createdAt: 1700000000000, cwd: 'C:\\Users\\me\\demo', ...extra });
const ev = (type: string, data: unknown) => JSON.stringify({ type, seq: 1, time: 1, data });
const frame = (lines: string[]) => zlib.zstdCompressSync(Buffer.from(lines.join('\n') + '\n', 'utf8'));
const said = (text: string) => ev('user/message', { role: 'user', id: 'u', content: [{ type: 'text', text }], source: { kind: 'user' } });
const turn1 = [
  said('fix the build'),
  ev('user/message', { role: 'user', content: [{ type: 'text', text: 'Current runtime context. cwd: …' }], source: { kind: 'runtime-context', form: 'snapshot' } }),
  ev('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', id: 'a1', content: [{ type: 'reasoning', text: 'look first' }, { type: 'text', text: 'looking' }, { type: 'tool-call', id: 'c1', name: 'pwsh', arguments: '{"command":"pnpm build"}' }] } }),
  ev('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'pwsh', arguments: '{"command":"pnpm build"}' }),
];
const v0Result = ev('tool/result', { turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool' }, content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'build ok' }], isError: false }] } });
const v4Result = ev('tool/result', { turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool', callId: 'c1' }, toolCallId: 'c1', content: [{ type: 'text', text: 'build ok' }], isError: false } });
const answer = ev('assistant/message', { turn: 1, step: 2, message: { role: 'assistant', id: 'a2', content: [{ type: 'text', text: 'fixed' }] } });

beforeAll(() => {
  const dir = path.join(home, 'sessions', PROJECT, `session-${ID}`);
  fs.mkdirSync(dir, { recursive: true });
  // v0: two frames, as dsh appends (one Decompress call would only return the first)
  fs.writeFileSync(path.join(dir, 'session.jsonl.zstd'), Buffer.concat([frame([header(`session-${ID}`), ev('session/title', { title: 'Fix the build' }), ...turn1]), frame([v0Result, answer])]));
  // the upgrade migrated it to v4, and the next turn was only written there
  fs.writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), frame([
    header(`session-${ID}`), ev('session/title', { title: 'Fix the build' }), ...turn1, v4Result, answer,
    ev('user/message', { role: 'user', id: 'u2', content: [{ type: 'text', text: 'and the screenshot?' }, { type: 'image', attachment: { attachmentId: `sha256:${SHA}`, mediaType: 'image/png', name: 'shot.png' } }], source: { kind: 'user' } }),
    ev('assistant/message', { turn: 2, step: 1, message: { role: 'assistant', id: 'a3', content: [{ type: 'text', text: 'it shows the error' }] } }),
  ]));
  fs.mkdirSync(path.join(home, 'attachments', 'v1', 'objects', SHA.slice(0, 2)), { recursive: true });
  fs.writeFileSync(path.join(home, 'attachments', 'v1', 'objects', SHA.slice(0, 2), SHA), PNG);

  // a newer session (bare uuid, uncompressed): its title only in the harness's index
  const n = path.join(home, 'sessions', PROJECT, NEW);
  fs.mkdirSync(n, { recursive: true });
  fs.writeFileSync(path.join(n, 'session.v4.jsonl'), [header(NEW), said('整理 PDF 文献'), answer].join('\n') + '\n');
  const pc = path.join(home, 'storages', 'session_projcache', 'sessions');
  fs.mkdirSync(pc, { recursive: true });
  fs.writeFileSync(path.join(pc, `${NEW}.json`), JSON.stringify({ format: 'dsh-storage-materialization-file-v1', record: { identity: { id: NEW, cwd: 'D:\\论文', createdAt: 1700000001000 }, rows: { title: { val: 'PDF 文献清单整理' } } } }));

  // not conversations of their own: a subagent's delegated session, and one where nothing was said
  const child = path.join(home, 'sessions', PROJECT, 'child-1');
  fs.mkdirSync(child, { recursive: true });
  fs.writeFileSync(path.join(child, 'session.v4.jsonl'), [header('child-1', { origin: 'subagent', parentSession: NEW, delegationDepth: 1 }), said('subtask')].join('\n') + '\n');
  const empty = path.join(home, 'sessions', PROJECT, 'empty-1');
  fs.mkdirSync(empty, { recursive: true });
  fs.writeFileSync(path.join(empty, 'session.v4.jsonl.zstd'), frame([header('empty-1'), ev('user/message', { content: [{ type: 'text', text: 'runtime' }], source: { kind: 'runtime-context' } })]));
});

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

describe('DeepSeek Harness history', () => {
  it('decodes every appended zstd frame, not just the first', () => {
    const text = decodeZstdFrames(fs.readFileSync(path.join(home, 'sessions', PROJECT, `session-${ID}`, 'session.jsonl.zstd')));
    expect(text).toContain('user/message');
    expect(text).toContain('build ok');
  });

  // dsh reads the numerically highest generation; an upgrade keeps writing only there
  it('reads the newest log generation, as the harness does', () => {
    expect(pickLog(['session.jsonl.zstd', 'session.v4.jsonl.zstd'])?.name).toBe('session.v4.jsonl.zstd');
    expect(pickLog(['session.v10.jsonl', 'session.v4.jsonl.zstd'])).toEqual({ name: 'session.v10.jsonl', zstd: false });
    expect(pickLog(['session.jsonl.zstd'])).toEqual({ name: 'session.jsonl.zstd', zstd: true });
    expect(pickLog(['events.db', 'session.v0.jsonl'])).toBeNull();
  });

  it('maps both tool-result shapes, without the call twice', () => {
    for (const result of [v0Result, v4Result]) {
      const msgs = dshMessages([...turn1, result, answer].map((l) => JSON.parse(l)), 'dsh-x');
      expect(msgs.map((m) => m.type)).toEqual(['user', 'assistant', 'user', 'assistant']);
      // dsh calls thinking `reasoning`; the renderer only folds blocks typed `thinking`
      expect(msgs[1].message.content).toEqual([
        { type: 'thinking', thinking: 'look first' },
        { type: 'text', text: 'looking' },
        { type: 'tool_use', id: 'c1', name: 'pwsh', input: { command: 'pnpm build' } },
      ]);
      expect(msgs[2].message.content).toEqual([{ type: 'tool_result', tool_use_id: 'c1', content: 'build ok' }]);
    }
    // a `tool/call` with no assistant message before it still shows
    const lone = dshMessages([JSON.parse(ev('tool/call', { callId: 'c9', name: 'read', arguments: '{"path":"a"}' }))], 'dsh-x');
    expect(lone[0].message.content[0]).toMatchObject({ type: 'tool_use', id: 'c9', name: 'read', input: { path: 'a' } });
  });

  // a harness session writes the cwd / sandbox / approval snapshot and the whole skill catalog through the same
  // `user/message` event; read back verbatim they look like the user pasted a wall of text before each question
  it('leaves out what the harness injects as user messages', () => {
    const msgs = dshMessages([
      { type: 'user/message', data: { content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } } },
      { type: 'user/message', data: { content: [{ type: 'text', text: 'Current runtime context. …' }], source: { kind: 'runtime-context', form: 'snapshot' } } },
      { type: 'user/message', data: { content: [{ type: 'text', text: '<system-reminder>\nA skill is …' }], source: { kind: 'skill-catalog', form: 'catalog' } } },
      { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } } },
    ], 'dsh-x');
    expect(msgs.map((m) => m.type)).toEqual(['user', 'assistant']);
    expect(JSON.stringify(msgs[0])).toContain('hi');
  });

  it('lists every conversation, titled from the log or the harness index', async () => {
    const src = new DshSource(home);
    const { items } = await src.list();
    expect(items.map((i) => i.sessionId).sort()).toEqual([`dsh-${NEW}`, `dsh-session-${ID}`]);
    expect(items.find((i) => i.sessionId === `dsh-session-${ID}`)).toMatchObject({ title: 'Fix the build', cwd: 'C:\\Users\\me\\demo' });
    expect(items.find((i) => i.sessionId === `dsh-${NEW}`)).toMatchObject({ title: 'PDF 文献清单整理', cwd: 'C:\\Users\\me\\demo' });
    // a send goes on in Claude (any model) — not through the harness, which needs its own DeepSeek key
    expect(src.caps).toEqual({ resume: true, rename: false, archive: false, delete: false, fork: false, continueInClaude: true });
    expect(items[0].caps).toEqual(src.caps);
    await src.close();
  });

  // the library's contract (Codex's too; readAll reverses the pages): the first page is the newest, the cursor walks
  // back. Oldest-first opened every long conversation on its first turns — its latest replies never showed.
  it('pages from the newest turn back, a page starting where the user spoke', async () => {
    const src = new DshSource(home);
    const page = await src.read(`session-${ID}`, { limit: 3 });
    // the newest turn (only the v4 log has it), images included — 3 asked, but a page never splits a turn's start
    expect(page.messages.map((m) => m.type)).toEqual(['user', 'assistant']);
    expect(page.messages[0].message.content).toEqual([
      { type: 'text', text: 'and the screenshot?' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } },
    ]);
    expect(page.messages[1].message.content).toEqual([{ type: 'text', text: 'it shows the error' }]);
    expect(page.next).toBe('4');
    const older = await src.read(`session-${ID}`, { cursor: page.next, limit: 3 });
    expect(older.messages.map((m) => m.type)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(older.messages[0].message.content).toEqual([{ type: 'text', text: 'fix the build' }]);
    expect(older.next).toBeUndefined();
    await src.close();
  });

  it('decodes the project folder name as a fallback cwd', () => {
    expect(dshCwd('--C-Users-me-demo--')).toBe('C:\\Users\\me\\demo');
  });
});
