import { describe, expect, it } from 'vitest';
import { HelperAutomation, snapshotFromHelper } from './helper-automation.js';
import { HelperError, type HelperLike } from './helper-win.js';
import type { AutomationTarget } from './service.js';
import { compressTree, findNodes } from './uia.js';

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

/** What the real helper answers to uia.snapshot, in its own shape (numbers, arrays, booleans). */
const snapshotJson = () => ({
  ok: true,
  app: { hwnd: 42, pid: 4242, name: 'notepad', exe: 'C:/Windows/notepad.exe', description: 'Notepad', product: 'Notepad', title: 'Untitled - Notepad', rect: { x: 0, y: 0, width: 800, height: 600 } },
  window: { hwnd: 42, pid: 4242, name: 'notepad', exe: 'C:/Windows/notepad.exe', description: 'Notepad', product: 'Notepad', title: 'Untitled - Notepad', rect: { x: 0, y: 0, width: 800, height: 600 } },
  root: {
    role: 'Window', name: 'Untitled - Notepad', automationId: 'Main', className: 'Notepad', bounds: { x: 0, y: 0, width: 800, height: 600 },
    enabled: true, offscreen: false, patterns: ['Window', 'Transform'],
    children: [
      {
        role: 'Edit', name: 'Text Editor', value: 'hello', automationId: '15', className: 'Edit',
        bounds: { x: 10, y: 40, width: 780, height: 500 }, enabled: true, offscreen: false, focused: true, patterns: ['Value', 'Text'],
      },
      {
        role: 'Button', name: 'Save', automationId: 'SaveButton', className: 'Button',
        bounds: { x: 700, y: 8, width: 80, height: 24 }, enabled: false, offscreen: true, patterns: ['Invoke'],
        children: [{ role: 'Text', name: 'Save', bounds: { x: 710, y: 12, width: 30, height: 16 }, patterns: [] }],
      },
      { role: 'Pane' },
    ],
  },
  nodes: 5,
  truncated: false,
});

class FakeHelper implements HelperLike {
  calls: Array<{ op: string; args: Record<string, any> }> = [];
  answers: Record<string, Record<string, any>> = {};
  async call(op: string, args: Record<string, any> = {}): Promise<Record<string, any>> {
    this.calls.push({ op, args });
    const answer = this.answers[op];
    if (answer) return { ...answer };
    return { ok: true };
  }
  close() { /* nothing */ }
}

const target: AutomationTarget = {
  hwnd: 42, role: 'Button', name: 'Save', automationId: 'SaveButton', bounds: rect(700, 8, 80, 24),
};
const expectLook = { fg: 42, under: [{ hwnd: 42, pid: 4242 }] };

describe('snapshotFromHelper', () => {
  it('translates every field the model sees and keeps the window identity', () => {
    const snap = snapshotFromHelper(snapshotJson(), 1234);
    expect(snap.takenAt).toBe(1234);
    expect(snap.app).toEqual({
      hwnd: 42, pid: 4242, name: 'notepad', exe: 'C:/Windows/notepad.exe', description: 'Notepad', product: 'Notepad',
      title: 'Untitled - Notepad', rect: rect(0, 0, 800, 600),
    });
    expect(snap.window).toEqual(snap.app);
    expect(snap.root).toMatchObject({
      role: 'Window', name: 'Untitled - Notepad', automationId: 'Main', className: 'Notepad',
      bounds: rect(0, 0, 800, 600), enabled: true, offscreen: false, patterns: ['Window', 'Transform'],
    });
    const [edit, save] = snap.root.children!;
    expect(edit).toMatchObject({ role: 'Edit', value: 'hello', focused: true, enabled: true, patterns: ['Value', 'Text'] });
    expect(save).toMatchObject({ role: 'Button', enabled: false, offscreen: true, patterns: ['Invoke'] });
    expect(save.children![0].name).toBe('Save');
    // empty fields do not travel
    expect(snap.root.children![2]).toEqual({ role: 'Pane' });
  });

  it('refuses an answer with no tree, and survives malformed children', () => {
    expect(() => snapshotFromHelper({ ok: true, root: null })).toThrow(HelperError);
    const snap = snapshotFromHelper({ root: { role: 'Window', children: [null, { name: 'no role' }, { role: 'Button' }] } });
    expect(snap.root.children).toEqual([{ role: 'Button' }]);
  });
});

describe('HelperAutomation.observe', () => {
  it('asks for uia.snapshot with the window filter and maps the answer', async () => {
    const helper = new FakeHelper();
    helper.answers['uia.snapshot'] = snapshotJson();
    const auto = new HelperAutomation(helper, { now: () => 777 });
    const snap = await auto.observe({ window: '  Notepad  ' });
    expect(helper.calls).toEqual([{ op: 'uia.snapshot', args: { window: 'Notepad' } }]);
    expect(snap.takenAt).toBe(777);
    expect(snap.window?.hwnd).toBe(42);
  });

  it('turns ok:false into a HelperError', async () => {
    const helper = new FakeHelper();
    helper.answers['uia.snapshot'] = { ok: false, error: 'no window is in front' };
    await expect(new HelperAutomation(helper).observe()).rejects.toThrow('no window is in front');
  });

  it('gives the same tree the same refs every time (refs are a pure function of the snapshot)', async () => {
    const helper = new FakeHelper();
    helper.answers['uia.snapshot'] = snapshotJson();
    const auto = new HelperAutomation(helper);
    const one = compressTree(await auto.observe());
    const two = compressTree(await auto.observe());
    expect(one.refs).toEqual(two.refs);
    expect(one.refs.map((r) => [r.ref, r.role, r.name])).toEqual([
      ['e1', 'Edit', 'Text Editor'],
      ['e2', 'Button', 'Save'],
    ]);
    expect(findNodes(one, { name: 'save' })[0]).toMatchObject({ ref: 'e2', bounds: rect(700, 8, 80, 24) });
  });
});

describe('HelperAutomation.act', () => {
  it('invoke / toggle / expand / collapse go to uia.act with the target and the expectation', async () => {
    const helper = new FakeHelper();
    const auto = new HelperAutomation(helper);
    for (const action of ['invoke', 'toggle', 'expand', 'collapse']) {
      const r = await auto.act({ action, ref: 'e2' }, { target, expect: expectLook });
      expect(r).toEqual({ ok: true });
    }
    expect(helper.calls.map((c) => [c.op, c.args.action, c.args.target, c.args.expect])).toEqual(
      ['invoke', 'toggle', 'expand', 'collapse'].map((action) => ['uia.act', action, target, expectLook]),
    );
  });

  it('value sends the text, select sends the item name', async () => {
    const helper = new FakeHelper();
    const auto = new HelperAutomation(helper);
    await auto.act({ action: 'value', ref: 'e1', text: 'read me', value: 'read me' }, { target: { ...target, role: 'Edit' }, expect: expectLook });
    await auto.act({ action: 'select', ref: 'e2', text: 'Option B' }, { target, expect: expectLook });
    expect(helper.calls[0].args).toMatchObject({ action: 'value', text: 'read me', target: { role: 'Edit' }, expect: expectLook });
    expect(helper.calls[1].args).toMatchObject({ action: 'select', text: 'Option B', target, expect: expectLook });
  });

  it('click by ref goes through uia.act (a clickable point the helper verifies), with modifiers and count', async () => {
    const helper = new FakeHelper();
    const auto = new HelperAutomation(helper);
    await auto.act({ action: 'click', ref: 'e2', count: 2, text: 'shift' }, { target, expect: expectLook });
    expect(helper.calls[0]).toMatchObject({
      op: 'uia.act',
      args: { action: 'click', target, count: 2, mods: [{ vk: 0x10 }], expect: expectLook },
    });
  });

  it('click by coordinate, type and key fall back to the helper input ops, still with the expectation', async () => {
    const helper = new FakeHelper();
    const auto = new HelperAutomation(helper);
    await auto.act({ action: 'click', coordinate: [120, 240], count: 2 }, { expect: expectLook });
    await auto.act({ action: 'type', text: 'hello' }, { expect: expectLook });
    await auto.act({ action: 'key', text: 'ctrl+s' }, { expect: expectLook });
    expect(helper.calls.map((c) => c.op)).toEqual(['click', 'type', 'keys']);
    expect(helper.calls[0].args).toMatchObject({ x: 120, y: 240, button: 'left', count: 2, mods: [], expect: expectLook });
    expect(helper.calls[1].args).toMatchObject({ text: 'hello', expect: expectLook });
    expect(helper.calls[2].args.chords).toEqual([[{ vk: 0x11 }, { vk: 0x53 }]]);
  });

  it('scroll by ref uses the control centre and the wheel; count is the notches', async () => {
    const helper = new FakeHelper();
    const auto = new HelperAutomation(helper);
    await auto.act({ action: 'scroll', ref: 'e2', count: 5 }, { target, expect: expectLook });
    expect(helper.calls[0]).toMatchObject({ op: 'scroll', args: { x: 740, y: 20, dx: 0, dy: -5, mods: [], expect: expectLook } });
  });

  it('refuses ref-based actions with no target instead of guessing', async () => {
    const helper = new FakeHelper();
    const auto = new HelperAutomation(helper);
    for (const action of ['invoke', 'value', 'toggle', 'select', 'expand', 'collapse']) {
      const r = await auto.act({ action, ref: 'e9', text: 'x' });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('stale');
    }
    expect(helper.calls).toEqual([]);
  });

  it('passes changed / self / sent through, so the service can retry or refuse', async () => {
    const helper = new FakeHelper();
    const auto = new HelperAutomation(helper);
    helper.answers['uia.act'] = { ok: false, changed: true, sent: 0, error: 'the window in front changed' };
    expect(await auto.act({ action: 'invoke', ref: 'e2' }, { target, expect: expectLook })).toEqual({
      ok: false, changed: true, sent: 0, error: 'the window in front changed',
    });
    helper.answers['uia.act'] = { ok: false, self: true, sent: 0, error: 'Claude Web itself is in the way' };
    expect(await auto.act({ action: 'invoke', ref: 'e2' }, { target, expect: expectLook })).toMatchObject({ ok: false, self: true });
  });

  it('does nothing once the task is aborted, and refuses unknown actions', async () => {
    const helper = new FakeHelper();
    const auto = new HelperAutomation(helper);
    const aborted = new AbortController();
    aborted.abort();
    expect(await auto.act({ action: 'invoke', ref: 'e2' }, { target, expect: expectLook, signal: aborted.signal })).toMatchObject({ ok: false });
    expect(await auto.act({ action: 'teleport', ref: 'e2' }, { target, expect: expectLook })).toMatchObject({ ok: false });
    expect(helper.calls).toEqual([]);
  });
});
