import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CursorSource, cursorCwd, cursorMessages } from './cursor-source.js';
import { scanLocalHistory } from './local-scan.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-cursor-'));

beforeAll(() => {
  const project = path.join(dir, '.cursor', 'projects', 'c-Users-me-demo');
  const id = '11111111-2222-3333-4444-555555555555';
  fs.mkdirSync(path.join(project, 'agent-transcripts', id), { recursive: true });
  fs.writeFileSync(path.join(project, 'agent-transcripts', id, `${id}.jsonl`), [
    JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'fix the build' }] } }),
    JSON.stringify({ role: 'assistant', message: { content: [{ type: 'text', text: 'looking' }, { type: 'tool_use', name: 'Bash', input: {} }] } }),
    '{"role":"assistant","message":{"content":[', // a line still being written
  ].join('\n'), 'utf8');
  fs.mkdirSync(path.join(dir, '.workbuddy', 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.workbuddy', 'sessions', '1.json'), '{"pid":1}', 'utf8');
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('Cursor history (read-only)', () => {
  it('maps Cursor rows to renderable messages and skips half-written lines', () => {
    expect(cursorMessages([
      { role: 'user', message: { content: [{ type: 'text', text: 'hi' }] } },
      { role: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } },
      { role: 'system', message: { content: [] } },
    ], 'cursor-x')).toEqual([
      { type: 'user', uuid: 'cursor-x-0', session_id: 'cursor-x', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } },
      { type: 'assistant', uuid: 'cursor-x-1', session_id: 'cursor-x', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
    ]);
  });

  it('reads a project folder and its prompts, and never offers to write or resume', async () => {
    const src = new CursorSource([path.join(dir, '.cursor', 'projects')]);
    const { items } = await src.list({ limit: 10 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ sessionId: 'cursor-11111111-2222-3333-4444-555555555555', title: 'fix the build', cwd: cursorCwd('c-Users-me-demo') });
    expect(src.caps).toEqual({ resume: false, rename: false, archive: false, delete: false, fork: false });
    const { messages } = await src.read('11111111-2222-3333-4444-555555555555');
    expect(messages.map((m) => m.type)).toEqual(['user', 'assistant']);
    expect(messages[1].message.content[1]).toMatchObject({ type: 'tool_use', name: 'Bash' });
    await src.close();
  });
});

describe('本机发现', () => {
  it('lists known data directories and marks only readable ones', async () => {
    const now = Date.now();
    const items = await scanLocalHistory({} as NodeJS.ProcessEnv, now, dir);
    const cursor = items.find((x) => x.id === 'cursor');
    expect(cursor?.readable).toBe(true);
    const wb = items.find((x) => x.id === 'workbuddy');
    expect(wb?.readable).toBe(false);
    expect(wb?.detail).toContain('运行记录');
  });
});
