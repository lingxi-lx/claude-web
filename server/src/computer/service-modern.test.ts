import { beforeEach, describe, expect, it } from 'vitest';
import type { WindowApp } from './apps.js';
import type { HelperLike } from './helper-win.js';
import { ComputerService, type AutomationAction, type ComputerAutomation, type ToolAnswer } from './service.js';
import type { Rect, UiaSnapshot } from './uia.js';
import { VisionService } from '../vision/service.js';

const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const notepad: WindowApp = { hwnd: 11, pid: 1011, name: 'notepad', exe: 'C:\\Apps\\notepad.exe', description: 'Notepad', product: 'Notepad', title: 'Untitled - Notepad' };
const chrome: WindowApp = { hwnd: 22, pid: 2022, name: 'chrome', exe: 'C:\\Apps\\chrome.exe', description: 'Google Chrome', product: 'Google Chrome', title: 'New Tab - Google Chrome' };

const snap = (texts: string[] = []): UiaSnapshot => ({
  app: { name: 'notepad', title: 'Untitled - Notepad' },
  window: { hwnd: 11, pid: 1011, name: 'notepad', title: 'Untitled - Notepad', rect: r(0, 0, 800, 600) },
  root: {
    role: 'Window', name: 'Untitled - Notepad', bounds: r(0, 0, 800, 600),
    children: [{
      role: 'Pane', children: [
        { role: 'Edit', name: 'Text Editor', value: '', bounds: r(10, 40, 780, 500), patterns: ['Value'] },
        { role: 'Button', name: 'Save', bounds: r(700, 8, 80, 24), patterns: ['Invoke'] },
        ...texts.map((name) => ({ role: 'Text', name, bounds: r(10, 560, 200, 20) })),
      ],
    }],
  },
});

class FakeHelper implements HelperLike {
  ops: string[] = [];
  /** the window in front and under every point */
  fg: WindowApp = notepad;
  under: WindowApp = notepad;
  async call(op: string, args: Record<string, any> = {}): Promise<Record<string, any>> {
    this.ops.push(op);
    switch (op) {
      case 'apps': return { ok: true, apps: [this.fg], fg: this.fg };
      case 'probe': return { ok: true, fg: this.fg, under: (args.points ?? []).map(() => this.under) };
      case 'screenshot': return { ok: true, data: 'U0hPVA==', w: 1568, h: 882, rect: { x: 0, y: 0, width: 1920, height: 1080 }, fg: this.fg };
      case 'zoom': return { ok: true, data: 'Wk9PTQ==', w: 100, h: 100, rect: { x: 0, y: 0, width: 100, height: 100 } };
      default: return { ok: true };
    }
  }
  close() { /* nothing */ }
}

class FakeAutomation implements ComputerAutomation {
  actions: AutomationAction[] = [];
  opts: Array<{ target?: any; expect?: any }> = [];
  observes = 0;
  constructor(private readonly snapshots: UiaSnapshot[]) {}
  async observe(): Promise<UiaSnapshot> {
    const s = this.snapshots[Math.min(this.observes, this.snapshots.length - 1)];
    this.observes++;
    return s;
  }
  async act(action: AutomationAction, opts: { target?: any; expect?: any } = {}): Promise<{ ok: boolean; text?: string; error?: string }> {
    this.actions.push(action);
    this.opts.push(opts);
    return { ok: true, text: `did ${action.action}` };
  }
}

const text = (a: ToolAnswer): string => a.content.filter((c) => c.type === 'text').map((c) => (c as any).text).join('\n');
const images = (a: ToolAnswer) => a.content.filter((c) => c.type === 'image');

let helper: FakeHelper;
let automation: FakeAutomation;
let svc: ComputerService;

beforeEach(async () => {
  helper = new FakeHelper();
  automation = new FakeAutomation([snap(['Saved'])]);
  svc = new ComputerService({
    helper,
    automation,
    vision: new VisionService({ call: async () => 'a save button at the top right' }),
    sleep: async () => { /* no real waiting */ },
  });
  const granted = await svc.call('request_access', { apps: ['Notepad'], reason: 'unit test' });
  expect(granted.isError).toBeFalsy();
});

describe('structured tools over a fake UIA tree', () => {
  it('computer_observe returns the compressed tree, refs and a screenshot', async () => {
    const answer = await svc.call('computer_observe', {});
    const body = text(answer);
    expect(answer.isError).toBeFalsy();
    expect(body).toContain('控件树');
    expect(body).toContain('Button "Save" [e2]');
    expect(images(answer)).toHaveLength(1);
  });

  it('computer_find returns refs and bounds; computer_act uses the ref', async () => {
    const found = await svc.call('computer_find', { name: 'Save' });
    expect(text(found)).toContain('[e2] Button "Save"');
    expect(text(found)).toContain('80x24');
    const acted = await svc.call('computer_act', { action: 'invoke', ref: 'e2' });
    expect(acted.isError).toBeFalsy();
    expect(automation.actions).toEqual([{ action: 'invoke', ref: 'e2' }]);
  });

  it('refuses an action on a ref that was never observed', async () => {
    const acted = await svc.call('computer_act', { action: 'invoke', ref: 'e2' });
    expect(acted.isError).toBe(true);
    expect(text(acted)).toContain('失效');
    expect(automation.actions).toEqual([]);
  });

  it('computer_task runs several steps and waits for text between them', async () => {
    automation = new FakeAutomation([snap([]), snap(['Saved'])]);
    svc = new ComputerService({ helper, automation, sleep: async () => { /* no wait */ } });
    await svc.call('request_access', { apps: ['Notepad'], reason: 'unit test' });
    const answer = await svc.call('computer_task', {
      steps: [{ label: 'save', action: { action: 'invoke', ref: 'e2' }, wait_for: { text: 'Saved', timeout_ms: 1000 } }],
    });
    expect(answer.isError).toBeFalsy();
    expect(text(answer)).toContain('任务完成');
    expect(text(answer)).toContain('Saved');
    expect(automation.actions).toEqual([{ action: 'invoke', ref: 'e2' }]);
    expect(images(answer)).toHaveLength(1);
  });

  it('computer_wait_for polls the tree and reports the match', async () => {
    automation = new FakeAutomation([snap([]), snap(['Saved'])]);
    svc = new ComputerService({ helper, automation, sleep: async () => { /* no wait */ } });
    await svc.call('request_access', { apps: ['Notepad'], reason: 'unit test' });
    const answer = await svc.call('computer_wait_for', { text: 'Saved', timeout_ms: 1000 });
    expect(answer.isError).toBeFalsy();
    expect(text(answer)).toContain('已等到');
    expect(text(answer)).toContain('Saved');
  });

  it('computer_look sends the screenshot to the seer and returns words', async () => {
    const answer = await svc.call('computer_look', { question: 'Where is Save?' });
    expect(answer.isError).toBeFalsy();
    expect(text(answer)).toBe('看图结果：a save button at the top right');
  });

  it('an action carries the control identity and the look it was decided on to the driver', async () => {
    await svc.call('computer_find', { name: 'Save' });
    const acted = await svc.call('computer_act', { action: 'invoke', ref: 'e2' });
    expect(acted.isError).toBeFalsy();
    expect(automation.opts).toHaveLength(1);
    expect(automation.opts[0].target).toMatchObject({
      hwnd: 11, role: 'Button', name: 'Save', bounds: r(700, 8, 80, 24),
      app: { hwnd: 11, pid: 1011, name: 'notepad', title: 'Untitled - Notepad' },
    });
    // the control's centre is checked too, so a click fallback in the helper lands on a granted window
    expect(automation.opts[0].expect).toEqual({ fg: 11, under: [{ hwnd: 11, pid: 1011 }] });
  });

  it('a click by ref checks the point under the control too', async () => {
    await svc.call('computer_find', { name: 'Save' });
    const acted = await svc.call('computer_act', { action: 'click', ref: 'e2' });
    expect(acted.isError).toBeFalsy();
    expect(automation.actions).toEqual([{ action: 'click', ref: 'e2' }]);
    expect(automation.opts[0].expect).toEqual({ fg: 11, under: [{ hwnd: 11, pid: 1011 }] });
    expect(helper.ops).toContain('probe');
  });

  it('a click with both a ref and a coordinate is refused instead of guessing which one', async () => {
    await svc.call('screenshot', {});
    await svc.call('computer_find', { name: 'Save' });
    const acted = await svc.call('computer_act', { action: 'click', ref: 'e2', coordinate: [10, 10] });
    expect(acted.isError).toBe(true);
    expect(text(acted)).toContain('其中一个');
    expect(automation.actions).toEqual([]);
  });

  it('structured key presses cannot dodge the systemKeyCombos approval', async () => {
    const r = await svc.call('computer_act', { action: 'key', text: 'win+r' });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('systemKeyCombos');
    expect(automation.actions).toEqual([]);
    svc.grants.flags.systemKeyCombos = true;
    const allowed = await svc.call('computer_act', { action: 'key', text: 'win+r' });
    expect(allowed.isError).toBeFalsy();
    expect(automation.actions).toEqual([{ action: 'key', text: 'win+r' }]);
  });

  it('the structured act still refuses when an ungranted application is in front', async () => {
    await svc.call('computer_find', { name: 'Save' });
    helper.fg = chrome;
    helper.under = chrome;
    const acted = await svc.call('computer_act', { action: 'click', ref: 'e2' });
    expect(acted.isError).toBe(true);
    expect(text(acted)).toContain('not a granted application');
    expect(automation.actions).toEqual([]);
  });

  it('a ref cannot act on an ungranted window behind a granted one (the foreground check alone would pass)', async () => {
    const chromeSnap: UiaSnapshot = {
      ...snap(),
      app: { name: 'chrome', title: 'New Tab - Google Chrome' },
      window: { hwnd: 22, pid: 2022, name: 'chrome', title: 'New Tab - Google Chrome', rect: r(0, 0, 800, 600) },
    };
    automation = new FakeAutomation([chromeSnap]);
    svc = new ComputerService({ helper, automation, sleep: async () => { /* no wait */ } });
    await svc.call('request_access', { apps: ['Notepad'], reason: 'unit test' }); // Notepad only, not Chrome
    await svc.call('computer_observe', {}); // helper.fg is still Notepad, which is granted
    const acted = await svc.call('computer_act', { action: 'invoke', ref: 'e2' });
    expect(acted.isError).toBe(true);
    expect(text(acted)).toContain('not a granted application');
    expect(automation.actions).toEqual([]);
  });

  it('computer_task resolves the refs it was given against the last observation', async () => {
    await svc.call('computer_find', { name: 'Save' });
    automation = new FakeAutomation([snap(['Saved'])]);
    svc = new ComputerService({ helper, automation, sleep: async () => { /* no wait */ } });
    await svc.call('request_access', { apps: ['Notepad'], reason: 'unit test' });
    await svc.call('computer_observe', {});
    const answer = await svc.call('computer_task', { steps: [{ action: { action: 'invoke', ref: 'e2' } }] });
    expect(answer.isError).toBeFalsy();
    expect(automation.opts[0].target).toMatchObject({ hwnd: 11, role: 'Button', name: 'Save' });
  });
});
