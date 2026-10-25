import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip, makeZip } from './zip.js';
import { parseExport, toSdkMessages, planImport, safeName } from './claude-ai.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'claude-ai-export');
const zipOf = (prefix = '') => readZip(makeZip(Object.fromEntries(['conversations.json', 'projects.json', 'users.json'].map((n) => [prefix + n, fs.readFileSync(path.join(FIX, n))])), { deflate: true }));

describe('claude.ai export', () => {
  it('parses conversations, projects and the user; skips broken items instead of failing', () => {
    const x = parseExport(zipOf());
    expect(x.user).toEqual({ name: 'Ada Example', email: 'ada@example.com' });
    expect(x.conversations.map((c) => c.name)).toEqual(['Plan a garden', 'Landing page', 'Untitled']);
    expect(x.skipped).toBe(2); // no uuid; chat_messages not an array
    const garden = x.conversations[0];
    expect(garden.messages.map((m) => m.sender)).toEqual(['human', 'assistant', 'human', 'assistant']);
    expect(garden.messages[0].attachments).toEqual([{ name: 'beds.txt', text: 'bed 1: tomatoes' }]);
    expect(garden.messages[2].files).toEqual(['photo.jpg']);
    expect(x.projects).toHaveLength(1);
    expect(x.projects[0]).toMatchObject({ name: 'Garden', instructions: 'Answer like a gardener.', starter: false });
    expect(x.projects[0].docs).toEqual([{ filename: 'soil.md', content: '# Soil\nLoam.' }]);
  });

  it('finds the files inside a folder of the zip too', () => {
    expect(parseExport(zipOf('data-2026-10-01/')).conversations).toHaveLength(3);
  });

  it('a zip without conversations.json or projects.json is refused', () => {
    expect(() => parseExport(readZip(makeZip({ 'other.txt': 'x' })))).toThrow();
  });

  it('turns a conversation into rows the app renders and Claude can continue from', () => {
    const x = parseExport(zipOf());
    const rows = toSdkMessages(x.conversations[0], 'claudeai-1');
    expect(rows[0]).toMatchObject({ type: 'user', session_id: 'claudeai-1', message: { role: 'user' } });
    expect(JSON.stringify(rows[0].message.content)).toContain('bed 1: tomatoes'); // the attachment's text comes along
    const assistant = rows.find((r) => r.type === 'assistant')!;
    expect(assistant.message.content.some((b: any) => b.type === 'text')).toBe(true);
    // an artifact is shown as its content, a web search as a tool call with its result right after
    const page = toSdkMessages(x.conversations[1], 'claudeai-2');
    expect(JSON.stringify(page)).toContain('```html');
    const call = page.flatMap((r) => r.message.content).find((b: any) => b.type === 'tool_use');
    expect(call).toMatchObject({ name: 'web_search' });
    const result = page.flatMap((r) => r.message.content).find((b: any) => b.type === 'tool_result');
    expect(result.tool_use_id).toBe(call.id);
    // a message with an empty content array falls back to its text
    expect(JSON.stringify(toSdkMessages(x.conversations[2], 'claudeai-3'))).toContain('only the text field');
    // every row has a stable uuid (re-reading gives the same ids)
    expect(toSdkMessages(x.conversations[0], 'claudeai-1').map((r) => r.uuid)).toEqual(rows.map((r) => r.uuid));
  });

  it('dedupes by uuid: new, newer, same', () => {
    const x = parseExport(zipOf());
    const [a, b, c] = x.conversations;
    const plan = planImport(x.conversations, new Map([[a.uuid, a.updatedAt], [b.uuid, '2000-01-01T00:00:00Z']]));
    expect(plan).toEqual({ add: [c.uuid], update: [b.uuid], same: [a.uuid] });
  });

  it('safe names', () => {
    expect(safeName('a/b:c*?', 'x')).toBe('a_b_c__');
    expect(safeName('  ', 'fallback')).toBe('fallback');
    expect(safeName('CON', 'x')).toBe('CON_');
    expect(safeName('..', 'x')).toBe('x');
  });
});
