import { beforeEach, describe, expect, it } from 'vitest';
import { applyMessage, createConversation, type Conversation } from '@/model/conversation';
import type { PendingBundle } from '@/model/attachments';
import { errorsSince, fixNote, fixWithClaude, isLocalPreview, onTurnEndAutoVerify, planAutoVerify, previewTabFor, touchedFrontend, useVerify, type AutoVerifyShell, type VerifyPage } from './auto-verify';
import { useBrowser, type BrowserTab } from './state';

const base = { session_id: 's1' };
let n = 0;
const id = () => `v${++n}`;
function user(c: Conversation, text: string) {
  applyMessage(c, { ...base, type: 'user', uuid: id(), message: { role: 'user', content: text }, parent_tool_use_id: null });
}
function tool(c: Conversation, name: string, input: Record<string, unknown>, ok: boolean | null = true, parent: string | null = null) {
  const tid = id();
  applyMessage(c, { ...base, type: 'assistant', uuid: id(), message: { id: id(), role: 'assistant', content: [{ type: 'tool_use', id: tid, name, input }] }, parent_tool_use_id: parent });
  if (ok !== null) applyMessage(c, { ...base, type: 'user', uuid: id(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content: ok ? 'ok' : 'boom', is_error: !ok }] }, parent_tool_use_id: parent });
  return tid;
}
function end(c: Conversation, isError = false) {
  applyMessage(c, { ...base, type: 'result', uuid: id(), subtype: isError ? 'error_during_execution' : 'success', is_error: isError, duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, result: '' });
}
const tab = (o: Partial<BrowserTab>): BrowserTab => ({ id: o.id ?? id(), src: o.url ?? '', url: '', title: '', loading: false, back: false, fwd: false, partition: 'p', ...o });

describe('touchedFrontend: the front-end files this turn wrote', () => {
  it('successful Write / Edit / MultiEdit of front-end suffixes, each once; this turn only', () => {
    const c = createConversation();
    user(c, 'first');
    tool(c, 'Write', { file_path: 'C:/p/old.css' });
    end(c);
    user(c, 'second');
    tool(c, 'Write', { file_path: 'C:/p/index.html' });
    tool(c, 'Edit', { file_path: 'C:\\p\\src\\App.tsx' });
    tool(c, 'Edit', { file_path: 'C:/p/src/app.tsx' }); // the same file spelled otherwise
    tool(c, 'MultiEdit', { file_path: 'C:/p/a.vue' });
    tool(c, 'Edit', { file_path: 'C:/p/b.svelte' });
    tool(c, 'Edit', { file_path: 'C:/p/c.js' });
    tool(c, 'Edit', { file_path: 'C:/p/d.jsx' });
    tool(c, 'Edit', { file_path: 'C:/p/e.ts' });
    tool(c, 'Write', { file_path: 'C:/p/README.md' }); // not front-end
    tool(c, 'Write', { file_path: 'C:/p/server.py' });
    tool(c, 'Edit', { file_path: 'C:/p/broken.css' }, false); // failed
    tool(c, 'Edit', { file_path: 'C:/p/never.css' }, null); // no result
    tool(c, 'Read', { file_path: 'C:/p/read.css' }); // not a writer
    expect(touchedFrontend(c.items)).toEqual(['C:/p/index.html', 'C:\\p\\src\\App.tsx', 'C:/p/a.vue', 'C:/p/b.svelte', 'C:/p/c.js', 'C:/p/d.jsx', 'C:/p/e.ts']);
  });

  it('a sub-agent\'s writes count; no writes: nothing', () => {
    const c = createConversation();
    user(c, 'go');
    const t = tool(c, 'Task', { prompt: 'x' }, null);
    tool(c, 'Write', { file_path: 'C:/p/x.css' }, true, t);
    expect(touchedFrontend(c.items)).toEqual(['C:/p/x.css']);
    const d = createConversation();
    user(d, 'hi');
    expect(touchedFrontend(d.items)).toEqual([]);
  });
});

describe('previewTabFor: the tab that shows the preview', () => {
  it('local addresses count; others only when they are a launch.json server of the project', () => {
    expect(isLocalPreview('http://localhost:5173/')).toBe(true);
    expect(isLocalPreview('http://127.0.0.1:3000/x')).toBe(true);
    expect(isLocalPreview('http://[::1]:8080/')).toBe(true);
    expect(isLocalPreview('http://app.localhost:3000/')).toBe(true);
    expect(isLocalPreview('https://example.com/')).toBe(false);
    expect(isLocalPreview('file:///C:/p/index.html')).toBe(false);
    expect(isLocalPreview('http://localhost.evil.com/')).toBe(false);
    const remote = tab({ id: 'r', url: 'http://myapp.test:4000/' });
    expect(previewTabFor('C:/p', [remote])).toBeUndefined();
    expect(previewTabFor('C:/p', [remote], { launch: ['http://myapp.test:4000'] })?.id).toBe('r');
    expect(previewTabFor(undefined, [remote], { launch: ['http://myapp.test:4000'] })).toBeUndefined();
  });

  it('the conversation\'s own Agent tab first, then the tab in front, then the newest; failed / empty tabs are not', () => {
    const a = tab({ id: 'a', url: 'http://localhost:3000/' });
    const b = tab({ id: 'b', url: 'http://localhost:5173/' });
    const mine = tab({ id: 'm', url: 'http://127.0.0.1:8000/', agent: 's1' });
    const bad = tab({ id: 'x', url: 'http://localhost:9/', error: 'refused' });
    const empty = tab({ id: 'e', url: '', src: '' });
    expect(previewTabFor('C:/p', [a, b, mine, bad, empty], { sessionId: 's1', active: 'a' })?.id).toBe('m');
    expect(previewTabFor('C:/p', [a, b, bad, empty], { sessionId: 's1', active: 'a' })?.id).toBe('a');
    expect(previewTabFor('C:/p', [a, b, bad], { active: 'zz' })?.id).toBe('b');
    expect(previewTabFor('C:/p', [bad, empty])).toBeUndefined();
  });

  it('another conversation\'s Agent tab, or a page still loading, is never taken for this project\'s preview (U3)', () => {
    const theirs = tab({ id: 'o', url: 'http://localhost:3000/', agent: 's2' });
    const loading = tab({ id: 'l', url: 'http://localhost:5173/', progress: 0.4 });
    expect(previewTabFor('C:/p', [theirs, loading], { sessionId: 's1', active: 'o' })).toBeUndefined();
    // the project's launch.json address counts even in another conversation's tab — it is this project's server
    expect(previewTabFor('C:/p', [theirs], { sessionId: 's1', launch: ['http://localhost:3000'] })?.id).toBe('o');
    // a launch.json match comes before a bare localhost tab
    const bare = tab({ id: 'b', url: 'http://localhost:8080/' });
    const proj = tab({ id: 'p', url: 'http://localhost:4000/' });
    expect(previewTabFor('C:/p', [proj, bare], { sessionId: 's1', active: 'b', launch: ['http://localhost:4000'] })?.id).toBe('p');
    // the conversation's own tab, even while loading
    expect(previewTabFor('C:/p', [bare, { ...loading, agent: 's1' }], { sessionId: 's1' })?.id).toBe('l');
  });
});

describe('planAutoVerify: when the check runs', () => {
  const turn = () => { const c = createConversation(); user(c, 'go'); tool(c, 'Edit', { file_path: 'C:/p/a.css' }); end(c); return c; };
  it('front-end changes in a good turn of this machine: the files', () => {
    expect(planAutoVerify({ sessionId: 's1', items: turn().items, isError: false, setting: undefined })).toEqual(['C:/p/a.css']);
    expect(planAutoVerify({ sessionId: 's1', items: turn().items, isError: false, setting: true })).toEqual(['C:/p/a.css']);
  });
  it('the setting off / a failed turn / another machine\'s conversation / no front-end change: not', () => {
    expect(planAutoVerify({ sessionId: 's1', items: turn().items, isError: false, setting: false })).toBeNull();
    expect(planAutoVerify({ sessionId: 's1', items: turn().items, isError: true, setting: true })).toBeNull();
    expect(planAutoVerify({ sessionId: 'peer_abcd~s1', items: turn().items, isError: false, setting: true })).toBeNull();
    const c = createConversation(); user(c, 'go'); tool(c, 'Edit', { file_path: 'C:/p/a.py' }); end(c);
    expect(planAutoVerify({ sessionId: 's1', items: c.items, isError: false, setting: true })).toBeNull();
  });
});

describe('errorsSince / fixNote', () => {
  it('only errors, only from the reload on', () => {
    const raw = [
      { level: 'error', text: 'old', at: 100 },
      { level: 'error', text: 'Uncaught TypeError: x is undefined', at: 210, url: 'http://localhost:3000/main.js' },
      { level: 'warning', text: 'warn', at: 220 },
      { level: 'log', text: 'hi', at: 230 },
      { level: 'error', text: 'Failed to load resource: 404', at: 240 },
    ];
    expect(errorsSince(raw, 200).map((e) => e.text)).toEqual(['Uncaught TypeError: x is undefined', 'Failed to load resource: 404']);
    expect(errorsSince('junk', 0)).toEqual([]);
  });
  it('the note lists the errors and the files', () => {
    const t = fixNote({ url: 'http://localhost:3000/', errors: [{ level: 'error', text: 'boom\n  at x', at: 1, url: 'http://localhost:3000/a.js' }], files: ['C:/p/a.js'] });
    expect(t).toContain('http://localhost:3000/');
    expect(t).toContain('1. boom at x (http://localhost:3000/a.js)');
    expect(t).toContain('C:/p/a.js');
  });
});

describe('onTurnEndAutoVerify: reload, look, keep only errors', () => {
  function conv(isError = false) {
    const c = createConversation(); user(c, 'go'); tool(c, 'Write', { file_path: 'C:/p/index.html' }); end(c, isError);
    return c;
  }
  function shell(entries: (since: number) => unknown[], o: { canDebug?: boolean; fail?: boolean } = {}) {
    const log: string[] = [];
    let since = 0;
    const page: VerifyPage = {
      async debug() { log.push('console'); if (o.fail) throw new Error('DevTools open'); return { entries: since ? entries(since) : [] }; },
      async reload() { since = Date.now(); log.push('reload'); return true; },
      async capture() { log.push('capture'); return { mime: 'image/jpeg' as const, data: 'AAAA', width: 10, height: 10 }; },
      url: () => 'http://localhost:3000/',
    };
    const sh: AutoVerifyShell = { canDebug: o.canDebug ?? true, pageOf: () => page };
    return { sh, log };
  }
  beforeEach(() => {
    useBrowser.setState({ tabs: [tab({ id: 't1', url: 'http://localhost:3000/' })], active: 't1' });
    useVerify.setState({ bySession: {} });
  });
  const st = (c: Conversation, settings: Record<string, unknown> = {}) => ({ open: { s1: { cwd: 'C:/p', conv: c } }, settings });

  it('errors since the reload: the strip with them, the turn it belongs to, and a picture', async () => {
    const { sh, log } = shell((since) => [{ level: 'error', text: 'before', at: since - 50 }, { level: 'error', text: 'Uncaught ReferenceError: foo', at: since + 5 }]);
    const c = conv();
    const v = await onTurnEndAutoVerify('s1', st(c), sh);
    expect(log).toEqual(['console', 'reload', 'console', 'capture']);
    expect(v?.status).toBe('errors');
    const kept = useVerify.getState().bySession.s1;
    expect(kept).toMatchObject({ status: 'errors', url: 'http://localhost:3000/', files: ['C:/p/index.html'], image: { mime: 'image/jpeg' } });
    expect(kept?.status === 'errors' && kept.errors.map((e) => e.text)).toEqual(['Uncaught ReferenceError: foo']);
    expect(kept?.turn).toBe(c.items.find((i) => i.kind === 'user')?.id);
  });

  it('no errors: no strip (and no picture)', async () => {
    const { sh, log } = shell(() => [{ level: 'warning', text: 'w', at: Date.now() + 1 }]);
    expect(await onTurnEndAutoVerify('s1', st(conv()), sh)).toBeNull();
    expect(log).toEqual(['console', 'reload', 'console']);
    expect(useVerify.getState().bySession.s1).toBeUndefined();
  });

  it('the setting off / a failed turn / no preview tab / the web version: nothing is reloaded', async () => {
    const errs = () => [{ level: 'error', text: 'x', at: Date.now() + 1 }];
    let s = shell(errs);
    expect(await onTurnEndAutoVerify('s1', st(conv(), { 'web.browser.autoVerify': false }), s.sh)).toBeNull();
    expect(s.log).toEqual([]);
    s = shell(errs);
    expect(await onTurnEndAutoVerify('s1', st(conv(true)), s.sh)).toBeNull();
    expect(s.log).toEqual([]);
    s = shell(errs, { canDebug: false });
    expect(await onTurnEndAutoVerify('s1', st(conv()), s.sh)).toBeNull();
    expect(s.log).toEqual([]);
    useBrowser.setState({ tabs: [tab({ id: 't2', url: 'https://example.com/' })], active: 't2' });
    s = shell(errs);
    expect(await onTurnEndAutoVerify('s1', st(conv()), s.sh)).toBeNull();
    expect(s.log).toEqual([]);
  });

  it('a launch.json server not on localhost is found by its address', async () => {
    useBrowser.setState({ tabs: [tab({ id: 't3', url: 'http://myapp.test:4000/' })], active: 't3' });
    const { sh, log } = shell((since) => [{ level: 'error', text: 'e', at: since + 1 }]);
    sh.launchUrls = async () => ['http://myapp.test:4000'];
    expect((await onTurnEndAutoVerify('s1', st(conv()), sh))?.status).toBe('errors');
    expect(log[1]).toBe('reload');
  });

  it('a conversation not on screen, or a page the user is typing in, is not reloaded (U3)', async () => {
    const errs = (since: number) => [{ level: 'error', text: 'x', at: since + 1 }];
    let s = shell(errs);
    expect(await onTurnEndAutoVerify('s1', { ...st(conv()), shown: false }, s.sh)).toBeNull();
    expect(s.log).toEqual([]);
    s = shell(errs);
    s.sh.hasFocus = (id) => id === 't1';
    expect(await onTurnEndAutoVerify('s1', st(conv()), s.sh)).toBeNull();
    expect(s.log).toEqual([]);
    s = shell(errs);
    expect((await onTurnEndAutoVerify('s1', { ...st(conv()), shown: true }, s.sh))?.status).toBe('errors');
  });

  it('the console cannot be read (DevTools open): no strip, no throw', async () => {
    const { sh } = shell(() => [], { fail: true });
    expect(await onTurnEndAutoVerify('s1', st(conv()), sh)).toBeNull();
    expect(useVerify.getState().bySession.s1).toBeUndefined();
  });
});

describe('fixWithClaude: fills the box, never sends', () => {
  it('the picture + errors as a bundle; a line in an empty box; a typed draft is kept', () => {
    const got: PendingBundle[] = [];
    const drafts: string[] = [];
    const v = { status: 'errors' as const, turn: 't', url: 'http://localhost:3000/', errors: [{ level: 'error', text: 'boom', at: 1 }], files: ['a.css'], image: { mime: 'image/png' as const, data: 'QUJD' }, at: 1 };
    const st = { addComposerAttachment: (_s: string, b: PendingBundle) => got.push(b), setDraft: (_s: string, d: string) => drafts.push(d), open: { s1: { draft: '' } } as Record<string, { draft?: string }> };
    fixWithClaude('s1', v, st);
    expect(got).toHaveLength(1);
    expect(got[0].image).toMatchObject({ mediaType: 'image/png', data: 'QUJD', url: 'data:image/png;base64,QUJD' });
    expect(got[0].text).toContain('boom');
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toContain('1');
    st.open.s1.draft = 'my words';
    fixWithClaude('s1', v, st);
    expect(drafts).toHaveLength(1);
    // no picture: the errors go in as the text itself
    fixWithClaude('s1', { ...v, image: undefined }, { ...st, open: { s1: {} } });
    expect(drafts[1]).toContain('boom');
  });
  it('no picture and words already typed: the errors go after them — never dropped; it says what it did (U4)', () => {
    const drafts: string[] = [];
    const v = { status: 'errors' as const, turn: 't', url: 'http://localhost:3000/', errors: [{ level: 'error', text: 'boom', at: 1 }], files: [], at: 1 };
    const st = { addComposerAttachment: () => { throw new Error('no bundle without a picture'); }, setDraft: (_s: string, d: string) => drafts.push(d), open: { s1: { draft: 'my words' } } };
    expect(fixWithClaude('s1', v, st)).toBe('draft');
    expect(drafts).toHaveLength(1);
    expect(drafts[0].startsWith('my words\n\n')).toBe(true);
    expect(drafts[0]).toContain('boom');
    const got: PendingBundle[] = [];
    expect(fixWithClaude('s1', { ...v, image: { mime: 'image/png' as const, data: 'QUJD' } }, { ...st, addComposerAttachment: (_s: string, b: PendingBundle) => got.push(b) })).toBe('bundle');
  });
});
