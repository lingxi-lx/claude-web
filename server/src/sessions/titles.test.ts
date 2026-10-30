import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TranscriptTitles } from './titles.js';
import { rowTitle } from './service.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-titles-')); dirs.push(d); return d; };
const line = (o: object) => JSON.stringify(o) + '\n';
const user = (text: string) => line({ type: 'user', message: { role: 'user', content: text } });

describe('TranscriptTitles', () => {
  it('a rename far from both ends is found (the SDK reads 64 KB at each end only)', () => {
    const f = path.join(tmp(), 's.jsonl');
    const big = 'x'.repeat(200 * 1024);
    fs.writeFileSync(f, user('first question') + user(big) + line({ type: 'custom-title', customTitle: 'claude-web-2026-10-30', sessionId: 's' }) + user(big) + user(big) + user('the latest message'));
    expect(new TranscriptTitles().update(f)).toEqual({ custom: 'claude-web-2026-10-30', ai: undefined });
  });

  it('reads only what was appended; the newest of each kind wins; an unfinished last line is read again', () => {
    const f = path.join(tmp(), 's.jsonl');
    const t = new TranscriptTitles();
    fs.writeFileSync(f, line({ type: 'ai-title', aiTitle: 'AI one' }) + user('a'));
    expect(t.update(f)).toEqual({ custom: undefined, ai: 'AI one' });
    const half = line({ type: 'custom-title', customTitle: 'Mine' });
    fs.appendFileSync(f, half.slice(0, 10));
    expect(t.update(f)?.custom).toBeUndefined();
    fs.appendFileSync(f, half.slice(10) + line({ type: 'ai-title', aiTitle: 'AI two' }));
    expect(t.update(f)).toEqual({ custom: 'Mine', ai: 'AI two' });
    fs.appendFileSync(f, line({ type: 'custom-title', customTitle: 'Renamed again' }));
    expect(t.update(f)?.custom).toBe('Renamed again');
  });

  it('a title line split across read chunks, and a multi-megabyte message line, are handled', () => {
    const f = path.join(tmp(), 's.jsonl');
    const pad = 'y'.repeat((1 << 20) - 30);
    fs.writeFileSync(f, pad + '\n' + line({ type: 'custom-title', customTitle: '跨块的名字' }) + user('z'.repeat(3 << 20)) + user('end'));
    expect(new TranscriptTitles().update(f)?.custom).toBe('跨块的名字');
  });

  it('a file that got shorter (rewritten) is read again from the start', () => {
    const f = path.join(tmp(), 's.jsonl');
    const t = new TranscriptTitles();
    fs.writeFileSync(f, user('a'.repeat(1000)) + line({ type: 'custom-title', customTitle: 'Old' }));
    t.update(f);
    fs.writeFileSync(f, line({ type: 'custom-title', customTitle: 'New' }));
    expect(t.update(f)?.custom).toBe('New');
  });

  it('a file rewritten to the same size is read again', () => {
    const f = path.join(tmp(), 's.jsonl');
    const t = new TranscriptTitles();
    fs.writeFileSync(f, line({ type: 'custom-title', customTitle: 'AAAA' }));
    t.update(f);
    fs.writeFileSync(f, line({ type: 'custom-title', customTitle: 'BBBB' }));
    fs.utimesSync(f, new Date(), new Date(Date.now() + 5000));
    expect(t.update(f)?.custom).toBe('BBBB');
  });

  it('what was read is kept on disk and used after a restart', () => {
    const d = tmp();
    const f = path.join(d, 's.jsonl');
    const cache = path.join(d, 'cache', 'titles.json');
    fs.writeFileSync(f, line({ type: 'custom-title', customTitle: 'Kept' }));
    const a = new TranscriptTitles(cache);
    a.update(f);
    a.flush();
    const b = new TranscriptTitles(cache);
    expect(b.known(f)?.custom).toBe('Kept');
    expect(b.unread([f, path.join(d, 'other.jsonl')])).toEqual([path.join(d, 'other.jsonl')]);
  });
});

describe('rowTitle', () => {
  const row = { sessionId: 'abcdef12', title: 'the latest message', firstPrompt: 'first question' };
  it('a rename, then the AI title, then the first prompt — never the latest message', () => {
    expect(rowTitle(row, { custom: 'mine', ai: 'ai' })).toBe('mine');
    expect(rowTitle(row, { ai: 'ai' })).toBe('ai');
    expect(rowTitle(row, {})).toBe('first question');
    expect(rowTitle({ ...row, firstPrompt: undefined }, {})).toBe('the latest message');
  });
});
