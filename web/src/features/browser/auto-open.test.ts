import { describe, expect, it } from 'vitest';
import { applyMessage, createConversation, type Conversation } from '@/model/conversation';
import { chatTile, initialLayout, layoutReducer, type Tile } from '@/model/layout';
import { fileUrl, lastPreviewable, onTurnEndAutoOpen, paneShowing, planAutoOpen } from './auto-open';
import { useBrowser } from './state';

const base = { session_id: 's1' };
let n = 0;
const id = () => `x${++n}`;

function user(c: Conversation, text: string) {
  applyMessage(c, { ...base, type: 'user', uuid: id(), message: { role: 'user', content: text }, parent_tool_use_id: null });
}

/** One tool call and its result (`ok: false` → the tool said it failed; `ok: null` → no result ever came). */
function tool(c: Conversation, name: string, input: Record<string, unknown>, ok: boolean | null = true, parent: string | null = null) {
  const tid = id();
  applyMessage(c, { ...base, type: 'assistant', uuid: id(), message: { id: id(), role: 'assistant', content: [{ type: 'tool_use', id: tid, name, input }] }, parent_tool_use_id: parent });
  if (ok !== null) applyMessage(c, { ...base, type: 'user', uuid: id(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content: ok ? 'ok' : 'boom', is_error: !ok }] }, parent_tool_use_id: parent });
  return tid;
}

function end(c: Conversation, isError = false) {
  applyMessage(c, { ...base, type: 'result', uuid: id(), subtype: isError ? 'error_during_execution' : 'success', is_error: isError, duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, result: '' });
}

describe('the last previewable file Claude wrote in a turn', () => {
  it('a.ts, b.html, c.md written → c.md', () => {
    const c = createConversation();
    user(c, 'make things');
    tool(c, 'Write', { file_path: 'C:\\w\\a.ts', content: '' });
    tool(c, 'Write', { file_path: 'C:\\w\\b.html', content: '' });
    tool(c, 'Edit', { file_path: 'C:\\w\\c.md', old_string: 'a', new_string: 'b' });
    tool(c, 'Read', { file_path: 'C:\\w\\d.md' });
    end(c);
    expect(lastPreviewable(c.items)).toBe('C:\\w\\c.md');
  });

  it('a write that failed, or never finished, does not count', () => {
    const c = createConversation();
    user(c, 'go');
    tool(c, 'Write', { file_path: '/w/ok.svg', content: '' });
    tool(c, 'Write', { file_path: '/w/bad.html', content: '' }, false);
    tool(c, 'Write', { file_path: '/w/cut.pdf', content: '' }, null);
    end(c);
    expect(lastPreviewable(c.items)).toBe('/w/ok.svg');
  });

  it('only this turn: a file from the turn before is not opened again', () => {
    const c = createConversation();
    user(c, 'first');
    tool(c, 'Write', { file_path: '/w/old.html', content: '' });
    end(c);
    user(c, 'second');
    tool(c, 'Write', { file_path: '/w/x.ts', content: '' });
    end(c);
    expect(lastPreviewable(c.items)).toBeUndefined();
  });

  it('nothing previewable → undefined; the suffix is case-blind; a notebook and a sub-agent\'s write count', () => {
    const c = createConversation();
    user(c, 'go');
    tool(c, 'Write', { file_path: '/w/a.py', content: '' });
    tool(c, 'NotebookEdit', { notebook_path: '/w/n.ipynb', new_source: '' });
    expect(lastPreviewable(c.items)).toBeUndefined();
    tool(c, 'Write', { file_path: '/w/Shot.PNG', content: '' });
    expect(lastPreviewable(c.items)).toBe('/w/Shot.PNG');
    const task = tool(c, 'Task', { prompt: 'draw' }, null);
    tool(c, 'Write', { file_path: '/w/chart.jpeg', content: '' }, true, task);
    expect(lastPreviewable(c.items)).toBe('/w/chart.jpeg');
    expect(lastPreviewable([])).toBeUndefined();
  });
});

describe('a file path as a file:// address', () => {
  it('forward slashes, the drive kept, the rest encoded', () => {
    expect(fileUrl('C:\\Users\\me\\my page.html')).toBe('file:///C:/Users/me/my%20page.html');
    expect(fileUrl('/home/me/#1.html')).toBe('file:///home/me/%231.html');
    expect(fileUrl('C:/w/报告.html')).toBe(`file:///C:/w/${encodeURIComponent('报告')}.html`);
  });
});

describe('where a conversation is on screen', () => {
  it('the pane whose front tab it is, in the group shown; a tab behind another is not', () => {
    let s = initialLayout();
    const paneId = s.groups[0].focusedPaneId;
    s = layoutReducer(s, { t: 'tile.open', paneId, tile: chatTile('behind') as Tile, mode: 'tab' } as any);
    s = layoutReducer(s, { t: 'tile.open', paneId, tile: chatTile('front') as Tile, mode: 'tab' } as any);
    expect(paneShowing(s, 'front')).toBe(paneId);
    expect(paneShowing(s, 'behind')).toBeUndefined();
    expect(paneShowing(s, 'nowhere')).toBeUndefined();
  });
});

describe('what opens when the turn ends', () => {
  const turn = (path: string, isError = false) => {
    const c = createConversation();
    user(c, 'go');
    tool(c, 'Write', { file_path: path, content: '' });
    end(c, isError);
    return c;
  };
  const input = (c: Conversation, o: Partial<Parameters<typeof planAutoOpen>[0]> = {}) => ({
    sessionId: 's1', items: c.items, isError: !!c.lastResult?.isError, setting: undefined, shown: true, desktop: true, mobile: false, opened: new Set<string>(), ...o,
  });

  it('html → the built-in browser in the desktop app, a doc tile in the web version; the rest → a doc tile', () => {
    expect(planAutoOpen(input(turn('C:\\w\\b.html')))).toEqual({ to: 'browser', path: 'C:\\w\\b.html', url: 'file:///C:/w/b.html' });
    expect(planAutoOpen(input(turn('C:\\w\\b.htm'), { desktop: false }))).toEqual({ to: 'doc', path: 'C:\\w\\b.htm' });
    expect(planAutoOpen(input(turn('/w/r.md')))).toEqual({ to: 'doc', path: '/w/r.md' });
  });

  it('nothing when: the setting is off, the turn failed, it is another machine\'s, it is not on screen, on a phone', () => {
    const c = turn('/w/r.md');
    expect(planAutoOpen(input(c, { setting: true }))).not.toBeNull();
    expect(planAutoOpen(input(c, { setting: false }))).toBeNull();
    expect(planAutoOpen(input(turn('/w/r.md', true)))).toBeNull();
    expect(planAutoOpen(input(c, { sessionId: 'peer_box~abc' }))).toBeNull();
    expect(planAutoOpen(input(c, { shown: false }))).toBeNull();
    expect(planAutoOpen(input(c, { mobile: true }))).toBeNull();
  });

  it('a path already opened automatically this run is not opened again (slashes and case aside)', () => {
    expect(planAutoOpen(input(turn('C:\\w\\r.md'), { opened: new Set(['c:/w/r.md']) }))).toBeNull();
  });

  const harness = () => {
    let layout = initialLayout();
    const paneId = layout.groups[0].focusedPaneId;
    layout = layoutReducer(layout, { t: 'tile.open', paneId, tile: chatTile('s1') as Tile, mode: 'replace' } as any);
    const tiles: any[] = [];
    const docks: any[] = [];
    const st = (c: Conversation) => ({
      open: { s1: { cwd: '/w', conv: c } }, settings: {}, layout, mobile: false,
      openTile: (...a: any[]) => void tiles.push(a), dispatchLayout: (a: any) => void docks.push(a),
    });
    return { paneId, tiles, docks, st };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('the store\'s turn end: a doc tab in the conversation\'s pane, a page in the browser once the shell allowed it — each file once', async () => {
    const { paneId, tiles, docks, st } = harness();
    const allowed: string[] = [];
    const shell = { allowFileOnce: async (u: string) => { allowed.push(u); return true; } };
    const md = turn('/w/auto-1.md');
    expect(onTurnEndAutoOpen('s1', st(md), shell)).toEqual({ to: 'doc', path: '/w/auto-1.md' });
    expect(tiles).toHaveLength(1);
    expect(tiles[0][0]).toMatchObject({ kind: 'doc', path: '/w/auto-1.md' });
    // stage B fix wave (U2): behind the conversation, never in front of it (this was 'tab', which brought it to the front)
    expect(tiles[0].slice(1)).toEqual(['background', paneId]);
    expect(onTurnEndAutoOpen('s1', st(md), shell)).toBeNull();
    expect(onTurnEndAutoOpen('s1', st(turn('/w/AUTO-1.md')), shell)).toBeNull();
    expect(tiles).toHaveLength(1);
    expect(allowed).toEqual([]);
    expect(onTurnEndAutoOpen('s1', st(turn('/w/auto-2.html')), shell)).toEqual({ to: 'browser', path: '/w/auto-2.html', url: 'file:///w/auto-2.html' });
    // nothing opens before the shell has let the tab load that file
    expect(docks).toEqual([]);
    await tick();
    expect(allowed).toEqual(['file:///w/auto-2.html']);
    expect(docks).toEqual([{ t: 'dock.show', panel: 'browser' }]);
    expect(useBrowser.getState().tabs.at(-1)).toMatchObject({ src: 'file:///w/auto-2.html' });
    expect(onTurnEndAutoOpen('other', st(md), shell)).toBeNull();
  });

  it('a page goes to the doc preview when the shell has no file guard, says no, or fails; the web version too', async () => {
    const { tiles, docks, st } = harness();
    expect(onTurnEndAutoOpen('s1', st(turn('/w/g-1.html')), {})).toEqual({ to: 'doc', path: '/w/g-1.html' });
    expect(onTurnEndAutoOpen('s1', st(turn('/w/g-2.html')), undefined)).toEqual({ to: 'doc', path: '/w/g-2.html' });
    expect(onTurnEndAutoOpen('s1', st(turn('/w/g-3.html')), { allowFileOnce: async () => false })?.to).toBe('browser');
    expect(onTurnEndAutoOpen('s1', st(turn('/w/g-4.html')), { allowFileOnce: () => Promise.reject(new Error('gone')) })?.to).toBe('browser');
    await tick();
    expect(tiles.map((t) => t[0].path)).toEqual(['/w/g-1.html', '/w/g-2.html', '/w/g-3.html', '/w/g-4.html']);
    expect(docks).toEqual([]);
  });

  it('a network path is never opened; a relative one is taken from the conversation\'s folder', () => {
    expect(planAutoOpen(input(turn('\\\\host\\share\\x.html')))).toBeNull();
    expect(planAutoOpen(input(turn('//host/share/x.md')))).toBeNull();
    expect(planAutoOpen(input(turn('out/r.md'), { cwd: 'C:\\w\\' }))).toEqual({ to: 'doc', path: 'C:/w/out/r.md' });
    expect(planAutoOpen(input(turn('out/r.md')))).toBeNull();
  });

  it('`..` and empty parts are resolved before the network-path test (U8)', () => {
    // joined, this is //host/…: refused
    expect(planAutoOpen(input(turn('./\\host\\share\\x.html'), { cwd: '/' }))).toBeNull();
    // resolved as Windows does (the leading separator kept, inner empty parts dropped) these stay local — and the
    // address handed on is the resolved one, never file:////host (which Chromium would take as a network path)
    expect(planAutoOpen(input(turn('x/../..//host/s/a.html'), { cwd: '/' }))).toEqual({ to: 'browser', path: '/host/s/a.html', url: 'file:///host/s/a.html' });
    expect(planAutoOpen(input(turn('/x/..//host/s/a.md')))).toEqual({ to: 'doc', path: '/host/s/a.md' });
    // resolved, the rest stays where it was
    expect(planAutoOpen(input(turn('C:\\w\\sub\\..\\b.html')))).toEqual({ to: 'browser', path: 'C:\\w\\b.html', url: 'file:///C:/w/b.html' });
    expect(planAutoOpen(input(turn('out//./r.md'), { cwd: 'C:\\w' }))).toEqual({ to: 'doc', path: 'C:/w/out/r.md' });
    // never above the drive
    expect(planAutoOpen(input(turn('../../r.md'), { cwd: 'C:\\w' }))).toEqual({ to: 'doc', path: 'C:/r.md' });
  });

  it('a page this conversation rewrote that is still open in a tab is reloaded there (U9)', async () => {
    const { st } = harness();
    const reloads: string[] = [];
    const shell = { allowFileOnce: async () => true };
    const page = turn('/w/re-1.html');
    expect(onTurnEndAutoOpen('s1', st(page), shell)?.to).toBe('browser');
    await tick();
    const tab = useBrowser.getState().tabs.at(-1)!;
    expect(tab.src).toBe('file:///w/re-1.html');
    expect(onTurnEndAutoOpen('s1', st(page), shell, (id) => reloads.push(id))).toBeNull();
    expect(reloads).toEqual([tab.id]);
    // the tab is gone: nothing (it was opened once already)
    useBrowser.setState({ tabs: useBrowser.getState().tabs.filter((t) => t.id !== tab.id) });
    expect(onTurnEndAutoOpen('s1', st(page), shell, (id) => reloads.push(id))).toBeNull();
    expect(reloads).toEqual([tab.id]);
  });
});
