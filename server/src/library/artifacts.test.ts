import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { recentArtifacts, writtenPaths } from './artifacts.js';

const call = (name: string, input: any, ts: string) => ({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', name, input }] } });

describe('生成的文件 across conversations', () => {
  it('Write / Artifact outputs worth looking at again; a file written twice counts at its last time', () => {
    const msgs = [
      call('Write', { file_path: '/p/report.html' }, '2026-10-16T01:00:00Z'),
      call('Write', { file_path: '/p/src/app.ts' }, '2026-10-16T01:01:00Z'), // code: not an artifact
      call('Artifact', { path: '/p/chart.SVG' }, '2026-10-16T01:02:00Z'),
      call('Edit', { file_path: '/p/notes.md' }, '2026-10-16T01:03:00Z'), // an edit is not a new file
      call('Write', { file_path: '/p/report.html' }, '2026-10-16T01:04:00Z'),
      { type: 'user', message: { content: 'hi' } },
    ];
    expect(writtenPaths(msgs)).toEqual([
      { path: '/p/chart.SVG', at: Date.parse('2026-10-16T01:02:00Z') },
      { path: '/p/report.html', at: Date.parse('2026-10-16T01:04:00Z') },
    ]);
  });
  it('the recent local Claude conversations, files still on disk, newest first, with where each came from', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-art-'));
    fs.writeFileSync(path.join(dir, 'a.md'), '#');
    fs.writeFileSync(path.join(dir, 'b.html'), '<p>');
    const lib = {
      list: async () => [
        { sessionId: 's1', title: 'one', cwd: dir, lastModified: 2 },
        { sessionId: 's2', title: 'two', cwd: dir, lastModified: 3 },
        { sessionId: 'peer_x~1', title: 'remote', cwd: dir, lastModified: 9, peer: { id: 'x' } },
        { sessionId: 'codex-1', title: 'codex', cwd: dir, lastModified: 8, agent: 'codex' },
      ] as any,
      read: async (id: string) => ({
        messages: id === 's1' ? [call('Write', { file_path: 'a.md' }, '2026-10-16T01:00:00Z'), call('Write', { file_path: path.join(dir, 'gone.md') }, '2026-10-16T01:00:00Z')]
          : id === 's2' ? [call('Write', { file_path: path.join(dir, 'b.html') }, '2026-10-16T02:00:00Z')]
          : [call('Write', { file_path: path.join(dir, 'a.md') }, '2026-10-17T00:00:00Z')],
      }),
    };
    const got = await recentArtifacts(lib);
    expect(got.map((a) => [path.basename(a.path), a.title])).toEqual([['b.html', 'two'], ['a.md', 'one']]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
