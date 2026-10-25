import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip } from './zip.js';
import { ClaudeAiImport } from './claude-ai-service.js';
import { ClaudeAiSource } from '../library/claudeai-source.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'claude-ai-export');
let root: string, folder: string;

function setup() {
  const workspaces: any[] = [];
  const joined: string[] = [];
  const source = new ClaudeAiSource(path.join(root, 'claude-ai'));
  const svc = new ClaudeAiImport({
    root: path.join(root, 'claude-ai'),
    meta: {
      workspaces: () => workspaces,
      addWorkspace: async (p) => { const w = { id: `w${workspaces.length + 1}`, path: p, name: path.basename(p) }; workspaces.push(w); return w; },
      updateWorkspace: async (id, patch) => { Object.assign(workspaces.find((w) => w.id === id), patch); },
    },
    library: { join: async (k) => { joined.push(k); }, invalidate: () => {} },
    source,
  });
  const upload = () => {
    fs.mkdirSync(svc.uploadsDir(), { recursive: true });
    const p = path.join(svc.uploadsDir(), `u${Math.random().toString(16).slice(2)}.zip`);
    fs.writeFileSync(p, makeZip(Object.fromEntries(['conversations.json', 'projects.json', 'users.json'].map((n) => [n, fs.readFileSync(path.join(FIX, n))])), { deflate: true }));
    return p;
  };
  return { svc, source, workspaces, joined, upload };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-cai-'));
  folder = path.join(root, 'mine'); fs.mkdirSync(folder);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('ClaudeAiImport', () => {
  it('scans: what is in it and what would be new', async () => {
    const t = setup();
    expect(await t.svc.scan(t.upload())).toEqual({ conversations: 3, projects: 1, docs: 1, add: 3, update: 0, same: 0, skipped: 2, user: 'Ada Example' });
  });

  it('imports conversations into the library source and projects into a folder you pick; re-import dedupes and keeps files', async () => {
    const t = setup();
    const z = t.upload();
    const r = await t.svc.run(z, folder);
    expect(r).toMatchObject({ add: 3, projectsCreated: 1, filesWritten: 1, filesKept: 0 });
    expect(fs.existsSync(z)).toBe(false); // the upload is removed
    expect(t.joined).toEqual(['claudeai']);
    expect(t.workspaces[0]).toMatchObject({ path: path.join(folder, 'Garden'), instructions: 'Answer like a gardener.', claudeAiUuid: 'p-1111-garden' });
    expect(fs.readFileSync(path.join(folder, 'Garden', 'soil.md'), 'utf8')).toBe('# Soil\nLoam.');
    const list = (await t.source.list({ limit: 50 })).items;
    expect(list.map((s) => s.sessionId)).toEqual(['claudeai-5f1c2a9e-3333-4a2b-9c3d-000000000003', 'claudeai-5f1c2a9e-2222-4a2b-9c3d-000000000002', 'claudeai-5f1c2a9e-1111-4a2b-9c3d-000000000001']);
    expect(list[2]).toMatchObject({ title: 'Plan a garden', agent: 'claudeai', caps: { continueInClaude: true } });
    const page = await t.source.read('5f1c2a9e-1111-4a2b-9c3d-000000000001', { limit: 2 });
    expect(page.messages).toHaveLength(2);
    expect(page.next).toBeDefined();
    const older = await t.source.read('5f1c2a9e-1111-4a2b-9c3d-000000000001', { limit: 2, cursor: page.next });
    expect(JSON.stringify(older.messages)).toContain('Help me plan my beds');
    // again: nothing new, the project is updated, the user's edited file is not overwritten
    fs.writeFileSync(path.join(folder, 'Garden', 'soil.md'), 'my edits');
    const again = await t.svc.run(t.upload(), folder);
    expect(again).toMatchObject({ add: 0, same: 3, projectsCreated: 0, projectsUpdated: 1, filesWritten: 0, filesKept: 1 });
    expect(fs.readFileSync(path.join(folder, 'Garden', 'soil.md'), 'utf8')).toBe('my edits');
    expect(t.workspaces).toHaveLength(1);
  });

  it('no folder: conversations only', async () => {
    const t = setup();
    const r = await t.svc.run(t.upload());
    expect(r).toMatchObject({ add: 3, projectsCreated: 0 });
    expect(t.workspaces).toEqual([]);
  });

  it('only a file the upload endpoint wrote', async () => {
    const t = setup();
    const outside = path.join(root, 'x.zip');
    fs.writeFileSync(outside, 'x');
    await expect(t.svc.scan(outside)).rejects.toThrow();
    await expect(t.svc.scan(path.join(t.svc.uploadsDir(), '..', 'x.zip'))).rejects.toThrow();
  });
});
