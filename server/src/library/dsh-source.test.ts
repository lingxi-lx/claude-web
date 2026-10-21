import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { DshSource, decodeZstdFrames, dshCwd, dshMessages } from './dsh-source.js';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-dsh-'));
const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const ev = (type: string, data: unknown) => JSON.stringify({ type, seq: 1, time: 1, data });
const frame = (lines: string[]) => zlib.zstdCompressSync(Buffer.from(lines.join('\n') + '\n', 'utf8'));

beforeAll(() => {
  const dir = path.join(home, 'sessions', '--C-Users-me-demo--', `session-${ID}`);
  fs.mkdirSync(dir, { recursive: true });
  // two frames, as dsh appends: one Decompress call would only return the first
  const f1 = frame([
    ev('session', { id: ID, createdAt: 1700000000000, cwd: 'C:\\Users\\me\\demo' }),
    ev('session/title', { title: 'Fix the build' }),
    ev('user/message', { role: 'user', id: 'u1', content: [{ type: 'text', text: 'fix the build' }] }),
  ]);
  const f2 = frame([
    ev('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', id: 'a1', content: [{ type: 'text', text: 'looking' }] } }),
    ev('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'Bash', arguments: '{"cmd":"pnpm build"}' }),
    ev('tool/result', { turn: 1, step: 1, message: { role: 'user', content: [{ type: 'tool_result', toolCallId: 'c1', content: 'ok', isError: false }] } }),
  ]);
  fs.writeFileSync(path.join(dir, 'session.jsonl.zstd'), Buffer.concat([f1, f2]));
});

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

describe('DeepSeek Harness history (read-only)', () => {
  it('decodes every appended zstd frame, not just the first', () => {
    const f = path.join(home, 'sessions', '--C-Users-me-demo--', `session-${ID}`, 'session.jsonl.zstd');
    const text = decodeZstdFrames(fs.readFileSync(f));
    expect(text).toContain('user/message');
    expect(text).toContain('tool/result');
  });

  it('maps the event stream to messages', () => {
    const msgs = dshMessages([
      { type: 'user/message', data: { content: [{ type: 'text', text: 'hi' }] } },
      { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } } },
      { type: 'tool/call', data: { callId: 'c1', name: 'Bash', arguments: '{"cmd":"ls"}' } },
      { type: 'tool/result', data: { message: { content: [{ type: 'tool_result', toolCallId: 'c1', content: 'out' }] } } },
    ], 'dsh-x');
    expect(msgs.map((m) => m.type)).toEqual(['user', 'assistant', 'assistant', 'user']);
    expect(msgs[2].message.content[0]).toMatchObject({ type: 'tool_use', id: 'c1', name: 'Bash', input: { cmd: 'ls' } });
    expect(msgs[3].message.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'c1', content: 'out' });
    // dsh calls thinking `reasoning`; the renderer only folds blocks typed `thinking`
    const withThinking = dshMessages([
      { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'reasoning', text: 'hmm' }, { type: 'text', text: 'done' }] } } },
    ], 'dsh-y');
    expect(withThinking[0].message.content).toEqual([{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'done' }]);
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

  it('lists and pages a session, and never offers to write or resume', async () => {
    const src = new DshSource(home);
    const { items } = await src.list();
    expect(items).toHaveLength(1);
    // the native id keeps dsh's own `session-` prefix: that is what session/resume expects
    expect(items[0]).toMatchObject({ sessionId: `dsh-session-${ID}`, title: 'Fix the build', cwd: 'C:\\Users\\me\\demo' });
    // continuing goes through the agent's ACP session/resume; everything else stays unsupported
    expect(src.caps).toEqual({ resume: true, rename: false, archive: false, delete: false, fork: false });
    const page = await src.read(`session-${ID}`, { limit: 2 });
    expect(page.messages).toHaveLength(2);
    expect(page.next).toBe('2');
    const rest = await src.read(`session-${ID}`, { cursor: page.next, limit: 10 });
    expect(rest.messages.map((m) => m.type)).toEqual(['assistant', 'user']);
    expect(rest.next).toBeUndefined();
    await src.close();
  });

  it('decodes the project folder name as a fallback cwd', () => {
    expect(dshCwd('--C-Users-me-demo--')).toBe('C:\\Users\\me\\demo');
  });
});
