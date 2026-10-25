import { describe, expect, it } from 'vitest';
import type { BrowserPage } from '@shared';
import { CONSOLE_MAX, GLANCE_CHARS, NETWORK_MAX, OPEN_CHARS, SNAPSHOT_CHARS, WAIT_MAX_MS, WHEEL_NOTCH, agentTabsOf, outlineText, parseKey, parseModifiers, runOp, toView, refusal, redactUrl, TAKEN_OVER, NOT_CHECKED, SITE_CHANGED, hostOf, evalSource, evalForm, looksLikeBody, withLimit, EVAL_MAX_CHARS, type MouseAct, type PageHandle } from './ops';

/** A page that records what it was asked, in order. */
function fakePage(o: { text?: string; url?: string; idle?: boolean; canBack?: boolean; onClick?: (p: Fake) => void; typed?: { submitted?: boolean; enter?: boolean }; scroll?: { moved: number; top: number; max: number; length: number }; picture?: { width: number; height: number } | null; view?: { width: number; height: number } } = {}) {
  const log: string[] = [];
  /** the size of the last picture taken (null: none yet) — `picture` in the options = one was taken before */
  let pictured = o.picture ?? null;
  const size = o.picture ?? { width: 1280, height: 800 };
  const p = {
    log,
    href: o.url ?? 'https://a.test/',
    text: o.text ?? 'hello',
    navigate: async (url: string) => { log.push(`navigate ${url}`); p.href = url; return o.idle ?? true; },
    call: async (fn: string, arg: Record<string, unknown>) => {
      log.push(`${fn} ${JSON.stringify(arg)}`);
      if (fn === 'read') {
        const from = Number(arg.offset) || 0;
        const page: BrowserPage = { url: p.href, title: 'T', text: p.text.slice(from, from + Number(arg.maxChars)) };
        return { page, length: p.text.length };
      }
      if (fn === 'find') return { page: { url: p.href, title: 'T', text: '' }, elements: [{ ref: 'e1', role: 'link', name: 'x' }] };
      if (fn === 'click') { o.onClick?.(p); return { name: '登录', role: 'button' }; }
      if (fn === 'type') return { name: '搜索', role: 'input', ...o.typed };
      if (fn === 'scroll') return o.scroll ?? { moved: 600, top: 600, max: 4000, length: p.text.length };
      throw new Error(`unexpected ${fn}`);
    },
    settle: async (ms: number) => { log.push(`settle ${ms}`); return o.idle ?? true; },
    back: async () => { log.push('back'); return o.canBack ?? true; },
    key: async (k: string) => { log.push(`key ${k}`); },
    capture: async () => { log.push('capture'); pictured = size; return { mime: 'image/jpeg' as const, data: 'AAAA', ...(o.picture === undefined ? {} : size) }; },
    frame: async () => ({ picture: pictured, view: o.view ?? { width: 640, height: 400 } }),
    mouse: async (e: MouseAct) => {
      const mods = e.modifiers?.length ? ` +${e.modifiers.join('+')}` : '';
      if (e.type === 'move') log.push(`move ${e.x},${e.y}${e.held ? ` held ${e.held}` : ''}${mods}`);
      else if (e.type === 'wheel') log.push(`wheel ${e.x},${e.y} dx ${e.dx} dy ${e.dy}${mods}`);
      else log.push(`${e.type} ${e.button} ${e.count} ${e.x},${e.y}${mods}`);
    },
    insertText: async (text: string) => { log.push(`insert ${text}`); },
    url: () => p.href,
    title: () => 'T',
  };
  return p;
}
type Fake = ReturnType<typeof fakePage>;
const quick = { pause: 0, settle: 5, computerSettle: 7 };
const run = (p: Fake, op: Parameters<typeof runOp>[1], args: Record<string, unknown> = {}) => runOp(p as unknown as PageHandle, op, args, quick);

describe('one operation on a page of the built-in browser', () => {
  it('open: loads, then reads from the start', async () => {
    const p = fakePage();
    const a = await run(p, 'open', { url: 'https://b.test/x' });
    expect(p.log).toEqual(['navigate https://b.test/x', `read {"offset":0,"maxChars":${OPEN_CHARS}}`]);
    expect(a.page?.url).toBe('https://b.test/x');
    expect(a.note).toBeUndefined();
  });
  it('open on a page still loading says the text may be incomplete', async () => {
    const a = await run(fakePage({ idle: false }), 'open', { url: 'https://b.test/' });
    expect(a.note).toMatch(/还在加载/);
  });
  it('read passes the window through; find is the page\'s own answer', async () => {
    const p = fakePage({ text: 'x'.repeat(50) });
    const a = await run(p, 'read', { offset: 10, maxChars: 20 });
    expect(a.page?.text).toHaveLength(20);
    expect((await run(p, 'find', { query: 'x' })).elements).toHaveLength(1);
    expect(p.log.at(-1)).toBe('find {"query":"x"}');
  });
  it('click: acts, lets the page settle, reads it back as a glance — and says where it ended up', async () => {
    const p = fakePage({ onClick: (x) => { x.href = 'https://a.test/next'; } });
    const a = await run(p, 'click', { ref: 'e3' });
    expect(p.log).toEqual(['click {"ref":"e3"}', 'settle 5', `read {"offset":0,"maxChars":${GLANCE_CHARS}}`]);
    // the note is this side's own words: the ref, not the button's text; that the address changed, not the address
    expect(a.note).toBe('已点击 [e3]。页面换了地址（见下面的「来源」）。');
    expect(a.page?.url).toBe('https://a.test/next');
  });
  it('a click that stays on the page does not claim a move', async () => {
    expect((await run(fakePage(), 'click', { ref: '[e1]' })).note).toBe('已点击 [e1]。');
  });
  it('type: only typing answers at once; submitting reads the page back; a field with no form gets Enter', async () => {
    const plain = fakePage();
    expect(await run(plain, 'type', { ref: 'e1', text: 'hi' })).toEqual({ note: '已在 [e1] 里输入。' });
    expect(plain.log).toEqual(['type {"ref":"e1","text":"hi","submit":false}']);

    const form = fakePage({ typed: { submitted: true } });
    const a = await run(form, 'type', { ref: 'e1', text: 'hi', submit: true });
    expect(form.log).toEqual(['type {"ref":"e1","text":"hi","submit":true}', 'settle 5', `read {"offset":0,"maxChars":${GLANCE_CHARS}}`]);
    expect(a.note).toMatch(/输入并提交/);

    const bare = fakePage({ typed: { enter: true } });
    await run(bare, 'type', { ref: 'e1', text: 'hi', submit: true });
    expect(bare.log.slice(0, 2)).toEqual(['type {"ref":"e1","text":"hi","submit":true}', 'key Enter']);
  });
  it('key: pressed, then the glance; no key is an error', async () => {
    const p = fakePage();
    expect((await run(p, 'key', { key: 'Escape' })).note).toBe('已按 Escape。');
    expect(p.log[0]).toBe('key Escape');
    await expect(run(p, 'key', { key: ' ' })).rejects.toThrow(/key/);
  });
  it('scroll: says where it is, and where new text starts when the page grew', async () => {
    const grown = fakePage({ text: 'y'.repeat(900), scroll: { moved: 600, top: 600, max: 4000, length: 500 } });
    expect((await run(grown, 'scroll', { direction: 'down' })).note).toBe('已向下滚动（位置 600 / 4000）。页面多出了内容：用 browser_read {"offset": 500} 读新出现的部分。');
    const same = fakePage({ text: 'y'.repeat(500), scroll: { moved: -300, top: 0, max: 4000, length: 500 } });
    expect((await run(same, 'scroll', { direction: 'up' })).note).toMatch(/^已向上滚动（位置 0 \/ 4000）。用 browser_read/);
    const end = fakePage({ scroll: { moved: 0, top: 4000, max: 4000, length: 5 } });
    expect((await run(end, 'scroll', { direction: 'down' })).note).toBe('已经到页面最下面了。');
    expect(end.log).toHaveLength(1);
  });
  it('back: nothing to go back to is said, not an error', async () => {
    expect(await run(fakePage({ canBack: false }), 'back')).toEqual({ note: '没有上一页了。' });
    const p = fakePage();
    expect((await run(p, 'back')).note).toBe('已返回上一页。');
    expect(p.log).toEqual(['back', 'settle 5', `read {"offset":0,"maxChars":${GLANCE_CHARS}}`]);
  });
  it('screenshot: the picture, and which page it is of', async () => {
    const a = await run(fakePage(), 'screenshot');
    expect(a.image).toEqual({ mime: 'image/jpeg', data: 'AAAA' });
    expect(a.page).toEqual({ url: 'https://a.test/', title: 'T', text: '' });
  });
  it('after an action on a page that keeps loading, the note says so', async () => {
    expect((await run(fakePage({ idle: false }), 'click', { ref: 'e1' })).note).toMatch(/已点击 \[e1\]。页面还在加载/);
  });
});

describe('key names', () => {
  it('named keys become the names the page is sent', () => {
    expect(parseKey('Enter')).toEqual({ keyCode: 'Enter', modifiers: [], char: '\r' });
    expect(parseKey('ArrowDown')).toEqual({ keyCode: 'Down', modifiers: [] });
    expect(parseKey('esc')).toEqual({ keyCode: 'Escape', modifiers: [] });
    expect(parseKey('PageDown').keyCode).toBe('PageDown');
    expect(parseKey('F5')).toEqual({ keyCode: 'F5', modifiers: [] });
    expect(parseKey('Space')).toEqual({ keyCode: 'Space', modifiers: [], char: ' ' });
    // the way key names are written for a desktop
    expect(parseKey('Page_Down').keyCode).toBe('PageDown');
    expect(parseKey('BackSpace').keyCode).toBe('Backspace');
    expect(parseKey('Return')).toEqual({ keyCode: 'Enter', modifiers: [], char: '\r' });
    expect(parseKey('Insert').keyCode).toBe('Insert');
    expect(parseKey('super+Left')).toEqual({ keyCode: 'Left', modifiers: ['meta'] });
  });
  it('a name nobody knows is no key at all — not its first letter', () => {
    expect(parseKey('NoSuchKey').keyCode).toBe('');
    expect(parseKey('Control+Whatever')).toEqual({ keyCode: '', modifiers: ['control'] });
    expect(parseKey('F99x').keyCode).toBe('');
  });
  it('a character types itself; with a modifier it is a shortcut', () => {
    expect(parseKey('a')).toEqual({ keyCode: 'A', modifiers: [], char: 'a' });
    expect(parseKey('Control+A')).toEqual({ keyCode: 'A', modifiers: ['control'] });
    expect(parseKey('Ctrl+Shift+k')).toEqual({ keyCode: 'K', modifiers: ['control', 'shift'] });
    expect(parseKey('Shift+a')).toEqual({ keyCode: 'A', modifiers: ['shift'], char: 'a' });
    expect(parseKey('/')).toEqual({ keyCode: '/', modifiers: [], char: '/' });
    expect(parseKey('+')).toEqual({ keyCode: '+', modifiers: [], char: '+' });
    expect(parseKey('Control++')).toEqual({ keyCode: '+', modifiers: ['control'] });
    expect(parseKey('').keyCode).toBe('');
  });
});

describe('browser_computer: the mouse and keyboard by position, answered with a picture', () => {
  // a picture of 1280×800 of a page that is 640×400 of its own pixels: positions are halved
  const pictured = (o: Parameters<typeof fakePage>[0] = {}) => fakePage({ picture: { width: 1280, height: 800 }, view: { width: 640, height: 400 }, ...o });
  const act = (p: Fake, args: Record<string, unknown>) => run(p, 'computer', args);

  it('screenshot: the picture with its size — nothing is touched, nothing waited for', async () => {
    const p = pictured();
    const a = await act(p, { action: 'screenshot' });
    expect(p.log).toEqual(['capture']);
    expect(a).toEqual({ image: { mime: 'image/jpeg', data: 'AAAA', width: 1280, height: 800 }, page: { url: 'https://a.test/', title: 'T', text: '' } });
  });

  it('a position needs a picture to go by: before the first one, it says to take one', async () => {
    const p = fakePage({ picture: null });
    await expect(act(p, { action: 'left_click', coordinate: [10, 10] })).rejects.toThrow('先截一张图');
    expect(p.log).toEqual([]);
    // typing and keys need none
    expect((await act(p, { action: 'type', text: 'hi' })).note).toBe('已输入。');
  });

  it('a click: move there, press, release — at the page\'s own position — then a fresh picture', async () => {
    const p = pictured();
    const a = await act(p, { action: 'left_click', coordinate: [640, 300] });
    expect(p.log).toEqual(['move 320,150', 'down left 1 320,150', 'up left 1 320,150', 'settle 7', 'capture']);
    // the note is this side's own words: no text of the page, no position
    expect(a.note).toBe('已点击。');
    expect(a.image).toMatchObject({ width: 1280, height: 800 });
    expect(a.page).toEqual({ url: 'https://a.test/', title: 'T', text: '' });
  });

  it('right, middle, double and triple clicks; a held modifier goes on every event', async () => {
    const right = pictured();
    expect((await act(right, { action: 'right_click', coordinate: [2, 2] })).note).toBe('已右键点击。');
    expect(right.log.slice(0, 3)).toEqual(['move 1,1', 'down right 1 1,1', 'up right 1 1,1']);
    const middle = pictured();
    await act(middle, { action: 'middle_click', coordinate: [2, 2] });
    expect(middle.log[1]).toBe('down middle 1 1,1');
    // a double click is two clicks, the second counted 2 — what a page gets from a real mouse
    const twice = pictured();
    expect((await act(twice, { action: 'double_click', coordinate: [100, 100] })).note).toBe('已双击。');
    expect(twice.log.slice(0, 5)).toEqual(['move 50,50', 'down left 1 50,50', 'up left 1 50,50', 'down left 2 50,50', 'up left 2 50,50']);
    const thrice = pictured();
    await act(thrice, { action: 'triple_click', coordinate: [100, 100] });
    expect(thrice.log.filter((l) => l.startsWith('down'))).toEqual(['down left 1 50,50', 'down left 2 50,50', 'down left 3 50,50']);
    const held = pictured();
    await act(held, { action: 'left_click', coordinate: [100, 100], modifiers: 'ctrl+shift' });
    expect(held.log.slice(0, 3)).toEqual(['move 50,50 +control+shift', 'down left 1 50,50 +control+shift', 'up left 1 50,50 +control+shift']);
  });

  it('a drag travels: pressed at the start, moved in steps with the button held, released at the end', async () => {
    const p = pictured();
    const a = await act(p, { action: 'left_click_drag', start: [0, 0], coordinate: [320, 160] });
    expect(a.note).toBe('已拖动。');
    expect(p.log.slice(0, 2)).toEqual(['move 0,0', 'down left 1 0,0']);
    const moves = p.log.filter((l) => l.includes('held left'));
    expect(moves).toHaveLength(8);
    expect(moves[0]).toBe('move 20,10 held left');
    expect(moves[7]).toBe('move 160,80 held left');
    expect(p.log.slice(-3)).toEqual(['up left 1 160,80', 'settle 7', 'capture']);
    await expect(act(pictured(), { action: 'left_click_drag', coordinate: [10, 10] })).rejects.toThrow('位置要写成 [x, y]');
  });

  it('scroll: the wheel at that position, by notches — down and right are negative, as a wheel reports them', async () => {
    const down = pictured();
    expect((await act(down, { action: 'scroll', coordinate: [640, 400], direction: 'down', amount: 3 })).note).toBe('已滚动。');
    expect(down.log.slice(0, 2)).toEqual(['move 320,200', `wheel 320,200 dx 0 dy ${-3 * WHEEL_NOTCH}`]);
    const wheel = async (direction: string, amount?: number) => { const p = pictured(); await act(p, { action: 'scroll', coordinate: [0, 0], direction, amount }); return p.log[1]; };
    expect(await wheel('up', 2)).toBe(`wheel 0,0 dx 0 dy ${2 * WHEEL_NOTCH}`);
    expect(await wheel('left', 1)).toBe(`wheel 0,0 dx ${WHEEL_NOTCH} dy 0`);
    expect(await wheel('right', 1)).toBe(`wheel 0,0 dx ${-WHEEL_NOTCH} dy 0`);
    expect(await wheel('down')).toBe(`wheel 0,0 dx 0 dy ${-3 * WHEEL_NOTCH}`); // three notches when not said
    expect(await wheel('down', 999)).toBe(`wheel 0,0 dx 0 dy ${-20 * WHEEL_NOTCH}`);
  });

  it('type goes to whatever has the focus; key is a key or a shortcut; wait waits; each ends with a picture', async () => {
    const typed = pictured();
    expect((await act(typed, { action: 'type', text: 'hello 世界' })).note).toBe('已输入。');
    expect(typed.log).toEqual(['insert hello 世界', 'settle 7', 'capture']);
    const key = pictured();
    expect((await act(key, { action: 'key', text: ' ctrl+a ' })).note).toBe('已按键。');
    expect(key.log).toEqual(['key ctrl+a', 'settle 7', 'capture']);
    await expect(act(pictured(), { action: 'key', text: '' })).rejects.toThrow('不认识的按键');
    await expect(act(pictured(), { action: 'key', text: 'NoSuchKey' })).rejects.toThrow('不认识的按键：NoSuchKey');
    const waited = pictured();
    const t0 = Date.now();
    expect((await act(waited, { action: 'wait', seconds: 0.1 })).note).toBe('已等待。');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90);
    expect(waited.log).toEqual(['capture']);
  });

  it('a position outside the picture, or an action nobody knows, touches nothing', async () => {
    const p = pictured();
    await expect(act(p, { action: 'left_click', coordinate: [1281, 10] })).rejects.toThrow('位置 [1281, 10] 在截图（1280×800）外面。');
    await expect(act(p, { action: 'left_click', coordinate: [10, -1] })).rejects.toThrow('外面');
    await expect(act(p, { action: 'left_click', coordinate: 'middle' })).rejects.toThrow('位置要写成 [x, y]');
    await expect(act(p, { action: 'fly', coordinate: [1, 1] })).rejects.toThrow('不认识的操作：fly');
    expect(p.log).toEqual([]);
  });
});

describe('positions and modifiers', () => {
  it('toView: a position in the picture is the same place in the page, whatever the two sizes', () => {
    const view = { width: 640, height: 400 };
    expect(toView([0, 0], { width: 1280, height: 800 }, view)).toEqual({ x: 0, y: 0 });
    expect(toView([640, 400], { width: 1280, height: 800 }, view)).toEqual({ x: 320, y: 200 });
    // the far edge of the picture is the last pixel of the page, not one past it
    expect(toView([1280, 800], { width: 1280, height: 800 }, view)).toEqual({ x: 639, y: 399 });
    // a picture the same size as the page: positions as they are
    expect(toView([123, 45], view, view)).toEqual({ x: 123, y: 45 });
    // a picture that was shrunk (a wide page drawn at 1280)
    expect(toView([640, 300], { width: 1280, height: 600 }, { width: 1920, height: 900 })).toEqual({ x: 960, y: 450 });
    expect(toView([10.4, 10.6], view, view)).toEqual({ x: 10, y: 11 });
  });
  it('parseModifiers: the names people write become the names an input event takes; anything else is left out', () => {
    expect(parseModifiers('shift')).toEqual(['shift']);
    expect(parseModifiers('ctrl+shift')).toEqual(['control', 'shift']);
    expect(parseModifiers('Control + Alt')).toEqual(['control', 'alt']);
    expect(parseModifiers('cmd, option')).toEqual(['meta', 'alt']);
    expect(parseModifiers('win')).toEqual(['meta']);
    expect(parseModifiers('shift+shift+hyper')).toEqual(['shift']);
    expect(parseModifiers(undefined)).toEqual([]);
    expect(parseModifiers(7)).toEqual([]);
  });
});

describe('console / network / structure / wait / viewport (stage B task 6)', () => {
  /** fakePage plus what the shell's DevTools protocol answers, a page agent that answers `has`, and the viewport. */
  function devPage(o: { debug?: (op: string) => unknown; has?: (n: number) => { found: boolean; missing?: boolean } | undefined; elements?: { ref: string; role: string; name: string }[] } = {}) {
    const p = fakePage();
    let asked = 0;
    const base = p.call;
    return Object.assign(p, {
      call: async (fn: string, arg: Record<string, unknown>) => {
        const r = (await base(fn, arg)) as any;
        return fn === 'read' && o.elements ? { ...r, page: { ...r.page, elements: o.elements } } : r;
      },
      debug: async (op: string) => { p.log.push(`debug ${op}`); const r = o.debug?.(op); if (r instanceof Error) throw r; return r; },
      peek: async (fn: string, arg: Record<string, unknown>) => { p.log.push(`peek ${fn} ${JSON.stringify(arg)}`); return o.has?.(++asked); },
      viewport: async (id: string) => { p.log.push(`viewport ${id}`); },
    });
  }
  const go = (p: ReturnType<typeof devPage>, op: Parameters<typeof runOp>[1], args: Record<string, unknown> = {}) => runOp(p as unknown as PageHandle, op, args, { ...quick, poll: 1 });

  it('console: what the shell kept, checked; errors only when asked; the newest 100', async () => {
    const entries = [{ level: 'log', text: 'ready', at: 1 }, { level: 'error', text: 'boom', at: 2, url: 'https://a.test/app.js' }, { level: 'warning', text: 'careful', at: 3 }, null, { level: 7, text: { x: 1 } }];
    const p = devPage({ debug: () => ({ entries, fresh: false }) });
    const a = await go(p, 'console');
    expect(p.log).toEqual(['debug console']);
    expect(a.page).toEqual({ url: 'https://a.test/', title: 'T', text: '' });
    expect(a.console).toEqual([{ level: 'log', text: 'ready', at: 1 }, { level: 'error', text: 'boom', at: 2, url: 'https://a.test/app.js' }, { level: 'warning', text: 'careful', at: 3 }, { level: '7', text: '[object Object]', at: 0 }]);
    expect((await go(p, 'console', { errorsOnly: true })).console!.map((e) => e.text)).toEqual(['boom', 'careful']);
    const many = devPage({ debug: () => ({ entries: Array.from({ length: 200 }, (_, i) => ({ level: 'log', text: `m${i} ${'x'.repeat(3000)}`, at: i })) }) });
    const list = (await go(many, 'console')).console!;
    expect(list).toHaveLength(CONSOLE_MAX);
    expect(list[0].text.startsWith('m100 ')).toBe(true);
    expect(list[0].text.length).toBeLessThanOrEqual(1001);
  });

  it('the shell cannot read the page (DevTools open): its reason is the error', async () => {
    await expect(go(devPage({ debug: () => new Error('读不了这个页面的调试信息：它开着开发者工具（DevTools）') }), 'console')).rejects.toThrow(/DevTools/);
  });

  it('network: failed ones only when asked (a failure, or 400 and up); the earlier requests are said to be from resource timing', async () => {
    const entries = [{ method: 'GET', url: 'https://a.test/', status: 200, ms: 30, type: 'navigation' }, { method: 'GET', url: 'https://a.test/missing.png', status: 404, ms: 3 }, { method: 'POST', url: 'https://a.test/api', failed: 'net::ERR_FAILED' }, { method: 'GET', url: 'https://a.test/slow' }];
    const p = devPage({ debug: () => ({ entries, fresh: true, earlier: 2 }) });
    const a = await go(p, 'network');
    expect(a.network).toHaveLength(4);
    expect(a.note).toMatch(/资源计时/);
    const failed = await go(p, 'network', { failedOnly: true });
    expect(failed.network!.map((e) => e.url)).toEqual(['https://a.test/missing.png', 'https://a.test/api']);
    const quiet = devPage({ debug: () => ({ entries: [], fresh: false }) });
    expect((await go(quiet, 'network')).note).toBeUndefined();
    const many = devPage({ debug: () => ({ entries: Array.from({ length: 200 }, (_, i) => ({ method: 'GET', url: `https://a.test/${i}/${'p'.repeat(900)}` })) }) });
    const list = (await go(many, 'network')).network!;
    expect(list).toHaveLength(NETWORK_MAX);
    expect(list[0].url.startsWith('https://a.test/100/')).toBe(true);
    expect(list[0].url.length).toBeLessThanOrEqual(501);
  });

  it('network / console: the values of secret-looking query parameters never reach the model (S9); the rest is kept', async () => {
    expect(redactUrl('https://a.test/cb?code=abc123&state=xyz')).toBe('https://a.test/cb?code=…&state=xyz');
    expect(redactUrl('https://a.test/#access_token=t0k&token_type=bearer')).toBe('https://a.test/#access_token=…&token_type=bearer');
    expect(redactUrl('https://s3.example/o?X-Amz-Signature=deadbeef&X-Amz-Credential=AKIA%2F1&X-Amz-Date=2026')).toBe('https://s3.example/o?X-Amz-Signature=…&X-Amz-Credential=…&X-Amz-Date=2026');
    expect(redactUrl('https://a.test/q?API_KEY=1&apikey=2&key=3&sig=4&signature=5&id_token=6&refresh_token=7&password=8&secret=9&session=10&auth=11&X-Goog-Signature=12&page=2'))
      .toBe('https://a.test/q?API_KEY=…&apikey=…&key=…&sig=…&signature=…&id_token=…&refresh_token=…&password=…&secret=…&session=…&auth=…&X-Goog-Signature=…&page=2');
    // nothing to hide, or not a URL: as it was
    expect(redactUrl('https://a.test/search?q=cats&keyboard=1')).toBe('https://a.test/search?q=cats&keyboard=1');
    expect(redactUrl('data:text/plain,hi')).toBe('data:text/plain,hi');
    const p = devPage({ debug: (op) => ({ entries: op === 'network' ? [{ method: 'GET', url: 'https://a.test/cb?code=SECRET1' }] : [{ level: 'error', text: 'x', at: 1, url: 'https://a.test/app.js?token=SECRET2' }] }) });
    expect(JSON.stringify((await go(p, 'network')).network)).not.toContain('SECRET1');
    expect(JSON.stringify((await go(p, 'console')).console)).not.toContain('SECRET2');
  });

  it('snapshot: the outline of the shell as indented lines with the refs click takes, the page agent asked first', async () => {
    const nodes = [{ depth: 0, role: 'banner', name: '' }, { depth: 1, role: 'heading', name: 'Shop', level: 1 }, { depth: 1, role: 'link', name: 'Cart', ref: 'kqz3' }, { depth: 0, role: 'main', name: '' }, { depth: 1, role: 'textbox', name: 'Search', ref: 'kqz4', value: 'shoes', states: ['focused'] }, { depth: 1, role: 'checkbox', name: 'Remember', ref: 'kqz5', states: ['checked'] }, { depth: 2, role: 'option', name: '', more: 12 }, { depth: 1, role: 'button', name: '', ref: 'kqz6' }];
    const p = devPage({ debug: () => ({ nodes, truncated: false }) });
    const a = await go(p, 'snapshot');
    expect(p.log).toEqual(['read {"offset":0,"maxChars":200}', 'debug snapshot']);
    expect(a.page!.text).toBe([
      'banner',
      '  heading "Shop" (level 1)',
      '  link "Cart" [kqz3]',
      'main',
      '  textbox "Search" [kqz4] = "shoes" focused',
      '  checkbox "Remember" [kqz5] checked',
      '    … 还有 12 个选项',
      '  button [kqz6]',
    ].join('\n'));
    expect(a.note).toBeUndefined();
  });

  it('snapshot without the accessibility tree: the elements of the page agent, and why', async () => {
    const p = devPage({ debug: () => new Error('DevTools 开着'), elements: [{ ref: 'abc1', role: 'button', name: 'Go' }] });
    const a = await go(p, 'snapshot');
    expect(a.page!.text).toBe('button "Go" [abc1]');
    expect(a.note).toMatch(/DevTools 开着/);
  });

  it('outlineText: cut at a line to its budget, saying how many lines are left out; a big tree says so', async () => {
    const nodes = Array.from({ length: 1000 }, (_, i) => ({ depth: 0, role: 'button', name: `Button number ${i}`, ref: `r${i}` }));
    const o = outlineText(nodes, 2000);
    expect(o.text.length).toBeLessThanOrEqual(2000);
    expect(o.text.endsWith('[r' + (o.lines - 1) + ']')).toBe(true);
    expect(o.omitted).toBe(1000 - o.lines);
    const a = await go(devPage({ debug: () => ({ nodes, truncated: true }) }), 'snapshot');
    expect(a.page!.text.length).toBeLessThanOrEqual(SNAPSHOT_CHARS);
    expect(a.note).toMatch(/browser_find/);
    // a name from the page cannot start a line of its own, nor end its quotes early
    expect(outlineText([{ depth: 0, role: 'link', name: 'a\nbutton "fake" [x1]' }]).text).toBe('link "a button \\"fake\\" [x1]"');
  });

  it('wait: asks the page agent until it says so — without stopping a page that is loading', async () => {
    const p = devPage({ has: (n) => (n >= 3 ? { found: true } : { found: false }) });
    const a = await go(p, 'wait', { text: 'Saved', timeoutMs: 2000 });
    expect(p.log).toEqual(Array(3).fill('peek has {"text":"Saved"}'));
    expect(a.note).toMatch(/^等到了/);
    expect(a.note).not.toContain('Saved'); // the note is this side's words
    const r = devPage({ has: () => ({ found: true }) });
    expect((await go(r, 'wait', { ref: '[kqz9]' })).note).toContain('[kqz9]');
    expect(r.log).toEqual(['peek has {"ref":"kqz9"}']);
  });

  it('wait: gives up after its time (never more than 20 s); an element no longer on the page fails at once', async () => {
    const p = devPage({ has: () => ({ found: false }) });
    const t0 = Date.now();
    await expect(go(p, 'wait', { text: 'never', timeoutMs: 150 })).rejects.toThrow(/等了 0\.2 秒/);
    expect(Date.now() - t0).toBeLessThan(1000);
    const gone = devPage({ has: () => ({ found: false, missing: true }) });
    await expect(go(gone, 'wait', { ref: 'kqz1', timeoutMs: 5000 })).rejects.toThrow(/\[kqz1\]/);
    expect(gone.log).toHaveLength(1);
    // a page that does not answer in time (still loading) is a wait that did not come true
    await expect(go(devPage({ has: () => undefined }), 'wait', { text: 'x', timeoutMs: 100 })).rejects.toThrow(/等了/);
    await expect(go(devPage(), 'wait', {})).rejects.toThrow(/text/);
    expect(WAIT_MAX_MS).toBe(20_000);
  });

  it('viewport: set the way the menu sets it, then the page read back', async () => {
    const p = devPage();
    const a = await go(p, 'viewport', { preset: 'phone' });
    expect(p.log).toEqual(['viewport phone', 'settle 5', `read {"offset":0,"maxChars":${GLANCE_CHARS}}`]);
    expect(a.note).toBe('视口：手机 · 390×844。');
    await expect(go(p, 'viewport', { preset: 'watch' })).rejects.toThrow(/preset/);
  });
});

describe('browser_tabs: only the tabs of the conversation', () => {
  it('lists the tabs of this conversation (its Agent), marking the one its tools work in', () => {
    const tabs = [
      { id: 'u1', url: 'https://mine.example/', title: 'Mine', src: 'https://mine.example/' },
      { id: 'a1', url: 'https://a.example/', title: 'A', src: 'https://a.example/', agent: 's1' },
      { id: 'b1', url: 'https://b.example/', title: 'B', src: 'https://b.example/', agent: 's2' },
      { id: 'a2', url: '', title: '', agent: 's1' },
    ] as any;
    expect(agentTabsOf(tabs, 's1', 'a2')).toEqual([{ id: 'a1', url: 'https://a.example/', title: 'A', active: false }, { id: 'a2', url: '', title: '', active: true }]);
    // no current one remembered: the first is the one the tools use (state.ts agentTab)
    expect(agentTabsOf(tabs, 's1', undefined).map((t) => t.active)).toEqual([true, false]);
    expect(agentTabsOf(tabs, 's1', 'b1').map((t) => t.active)).toEqual([true, false]);
    expect(agentTabsOf(tabs, 'nobody', undefined)).toEqual([]);
  });
});

describe('hover / drag / select / eval, the cursor, 接管 (stage B task 7)', () => {
  /** fakePage + the page agent's point / select, a script runner and the cursor layer. */
  function page7(o: { evalResult?: string; evalError?: string } = {}) {
    const p = fakePage();
    const marks: string[] = [];
    const call0 = p.call;
    const at: Record<string, { x: number; y: number }> = { a: { x: 10, y: 20 }, b: { x: 110, y: 220 } };
    const ext = Object.assign(p, {
      call: async (fn: string, arg: Record<string, unknown>) => {
        if (fn === 'point') { p.log.push(`point ${JSON.stringify(arg)}`); const q = at[String(arg.ref)]; if (!q) throw new Error('元素不在页面上了'); return { ...q, width: 800, height: 600 }; }
        if (fn === 'select') { p.log.push(`select ${JSON.stringify(arg)}`); return { index: 2 }; }
        return call0(fn, arg);
      },
      evaluate: async (script: string) => { p.log.push(`eval ${script}`); if (o.evalError) throw new Error(o.evalError); return o.evalResult ?? '"ok"'; },
      show: (m: { kind: string; x: number; y: number; width: number; height: number }) => { marks.push(`${m.kind} ${m.x},${m.y} /${m.width}x${m.height}`); },
    });
    return { p: ext, marks };
  }

  it('hover: a real mouse moved to the middle of the element, the cursor shown there, then the glance', async () => {
    const { p, marks } = page7();
    const a = await run(p, 'hover', { ref: 'a' });
    expect(p.log.slice(0, 2)).toEqual(['point {"ref":"a"}', 'move 10,20']);
    expect(marks).toEqual(['move 10,20 /800x600']);
    expect(a.note).toContain('[a]');
    expect(a.page).toBeDefined();
  });

  it('drag: pressed on one element, moved in steps with the button held, released on the other', async () => {
    const { p, marks } = page7();
    await run(p, 'drag', { from: 'a', to: 'b' });
    expect(p.log[0]).toBe('point {"ref":"a"}');
    expect(p.log[1]).toBe('point {"ref":"b","noScroll":true}');
    expect(p.log[2]).toBe('move 10,20');
    expect(p.log[3]).toBe('down left 1 10,20');
    const moves = p.log.filter((l) => l.endsWith('held left'));
    expect(moves).toHaveLength(10);
    expect(moves.at(-1)).toBe('move 110,220 held left');
    expect(p.log).toContain('up left 1 110,220');
    expect(marks[0]).toBe('move 10,20 /800x600');
    expect(marks[1]).toBe('down 10,20 /800x600');
    expect(marks.at(-1)).toBe('up 110,220 /800x600');
  });

  it('select: the cursor goes there, the page agent picks the option, the glance', async () => {
    const { p, marks } = page7();
    const a = await run(p, 'select', { ref: 'a', value: 'Large' });
    expect(p.log.slice(0, 2)).toEqual(['point {"ref":"a"}', 'select {"ref":"a","value":"Large"}']);
    expect(marks).toEqual(['move 10,20 /800x600', 'down 10,20 /800x600']);
    expect(a.note).toContain('[a]');
  });

  it('click and type show the cursor first when there is a layer; an element the cursor cannot find still gets the op', async () => {
    const { p, marks } = page7();
    await run(p, 'click', { ref: 'a' });
    expect(p.log.slice(0, 2)).toEqual(['point {"ref":"a"}', 'click {"ref":"a"}']);
    expect(marks).toEqual(['move 10,20 /800x600', 'down 10,20 /800x600']);
    await run(p, 'click', { ref: 'zz' });
    expect(p.log).toContain('click {"ref":"zz"}');
  });

  it('eval: the script runs in the page and its result comes back with the page it ran on; an empty one never runs', async () => {
    const { p } = page7({ evalResult: '{"n":3}' });
    const a = await run(p, 'eval', { script: 'return 3' });
    expect(a).toEqual({ result: '{"n":3}', page: { url: 'https://a.test/', title: 'T', text: '' } });
    await expect(run(p, 'eval', { script: '  ' })).rejects.toThrow(/script/);
    const bad = page7({ evalError: '脚本出错：boom' });
    await expect(run(bad.p, 'eval', { script: 'boom()' })).rejects.toThrow('脚本出错：boom');
  });

  it('接管: page-changing ops — and the probe the server makes before one — are refused; reading is not', () => {
    const o = { takenOver: true, url: 'https://a.test/' };
    for (const op of ['click', 'type', 'key', 'scroll', 'computer', 'hover', 'drag', 'select', 'eval'] as const) expect(refusal(op, {}, o), op).toBe(TAKEN_OVER);
    expect(TAKEN_OVER).toContain('用户接管了浏览器');
    expect(refusal('read', { probe: true }, o)).toBe(TAKEN_OVER);
    // stage B fix wave (A2): only reading goes while taken over — open / back / viewport / tabs new·switch·close moved the
    // user's page or tab from under them, so they are refused now (this list used to include open, back, viewport)
    for (const op of ['read', 'find', 'snapshot', 'screenshot', 'console', 'network', 'wait'] as const) expect(refusal(op, {}, o), op).toBeNull();
    for (const op of ['open', 'back', 'viewport'] as const) expect(refusal(op, {}, o), op).toBe(TAKEN_OVER);
    expect(refusal('tabs', { action: 'list' }, o)).toBeNull();
    for (const action of ['new', 'switch', 'close']) expect(refusal('tabs', { action }, o), action).toBe(TAKEN_OVER);
    expect(refusal('computer', { action: 'screenshot' }, o)).toBeNull();
    expect(refusal('computer', { action: 'left_click', site: 'a.test' }, o)).toBe(TAKEN_OVER);
    expect(TAKEN_OVER).toMatch(/打开网址/);
    // 交还: the same ops go again
    expect(refusal('click', { site: 'a.test' }, { takenOver: false, url: 'https://a.test/' })).toBeNull();
    expect(refusal('open', {}, { takenOver: false, url: 'https://a.test/' })).toBeNull();
  });

  it('a page-changing op the server did not check (no site) is refused: the window never trusts the server\'s idea of the page (S1)', () => {
    const o = { takenOver: false, url: 'https://bank.example/' };
    for (const op of ['click', 'type', 'key', 'scroll', 'hover', 'drag', 'select', 'eval'] as const) expect(refusal(op, {}, o), op).toBe(NOT_CHECKED);
    expect(refusal('computer', { action: 'left_click' }, o)).toBe(NOT_CHECKED);
    // a picture or a pause is not a change: never asked about, so no site
    expect(refusal('computer', { action: 'screenshot' }, o)).toBeNull();
    expect(refusal('computer', { action: 'wait' }, o)).toBeNull();
    // the server judged a page with no host ('') and the tab is on one: refused with the real address
    expect(refusal('click', { site: '' }, o)).toBe(`${SITE_CHANGED}https://bank.example/`);
    expect(refusal('click', { site: '' }, { takenOver: false, url: 'about:blank' })).toBeNull();
    // a blob: page is its origin's site
    expect(hostOf('blob:https://Bank.example/0b1c')).toBe('bank.example');
    expect(refusal('click', { site: '' }, { takenOver: false, url: 'blob:https://bank.example/0b1c' })).toBe(`${SITE_CHANGED}blob:https://bank.example/0b1c`);
  });

  it('every answer says the page the tab is REALLY on, not what the page agent reported (S1: a page can forge location)', async () => {
    const p = fakePage();
    const forged = { ...p, call: async (fn: string, arg: Record<string, unknown>) => {
      const r = await p.call(fn, arg) as { page?: BrowserPage };
      return r.page ? { ...r, page: { ...r.page, url: 'https://forged.example/', title: 'Forged' } } : r;
    } };
    for (const op of ['read', 'find', 'snapshot'] as const) {
      const a = await runOp(forged as unknown as PageHandle, op, op === 'find' ? { query: 'x' } : {}, quick);
      expect(a.page?.url, op).toBe('https://a.test/');
      expect(a.page?.title, op).toBe('T');
    }
    const c = await runOp(forged as unknown as PageHandle, 'click', { ref: 'e1', site: 'a.test' }, quick);
    expect(c.page?.url).toBe('https://a.test/');
  });

  it('an op is stopped between its steps when the user takes over (A3): a long drag does not finish', async () => {
    const { p } = page7();
    const ctl = new AbortController();
    let moves = 0;
    const mouse0 = p.mouse;
    p.mouse = async (e: MouseAct) => { await mouse0(e); if (e.type === 'move' && ++moves === 3) ctl.abort(); };
    await expect(runOp(p as unknown as PageHandle, 'drag', { from: 'a', to: 'b', site: 'a.test' }, { ...quick, signal: ctl.signal })).rejects.toThrow(TAKEN_OVER);
    expect(p.log.filter((l) => l.startsWith('up'))).toEqual([]);
    expect(moves).toBe(3);
    // already aborted: nothing is done at all
    const q = fakePage();
    const done = new AbortController(); done.abort();
    await expect(runOp(q as unknown as PageHandle, 'click', { ref: 'e1', site: 'a.test' }, { ...quick, signal: done.signal })).rejects.toThrow(TAKEN_OVER);
    expect(q.log).toEqual([]);
  });

  it('withLimit: an op that never answers is given up on, the queue goes on (A5)', async () => {
    let late = 0;
    await expect(withLimit(new Promise(() => {}), 20, () => { late++; })).rejects.toThrow(/卡住/);
    expect(late).toBe(1);
    expect(await withLimit(Promise.resolve(3), 20, () => { late++; })).toBe(3);
    expect(late).toBe(1);
  });

  it('evalForm: the script is decided once, before it runs — an expression or a function body (A4)', () => {
    expect(evalForm('document.title')).toBe(false);
    expect(evalForm('await fetch("/x").then((r) => r.status)')).toBe(false);
    expect(evalForm('return 1')).toBe(true);
    expect(evalForm('const a = 1; a + 1')).toBe(true);
    expect(evalForm('location.href = "/x"; 1')).toBe(true);
    expect(evalForm('if (x) { y() }')).toBe(true);
    // neither parses: run once as written, the page reports the syntax error
    expect(evalForm('a = ;')).toBe(true);
  });

  it('a file: page is never driven; an op checked for another site says where the tab is now', () => {
    expect(refusal('click', {}, { takenOver: false, url: 'file:///C:/x.html' })).toMatch(/file:/);
    expect(refusal('read', {}, { takenOver: false, url: 'file:///C:/x.html' })).toBeNull();
    expect(refusal('click', { site: 'a.test' }, { takenOver: false, url: 'https://A.test:8080/x' })).toBeNull();
    expect(refusal('click', { site: 'a.test' }, { takenOver: false, url: 'https://b.test/' })).toBe(`${SITE_CHANGED}https://b.test/`);
    expect(refusal('click', { site: '::1' }, { takenOver: false, url: 'http://[::1]:3000/' })).toBeNull();
    expect(hostOf('not a url')).toBe('');
  });

  it('evalSource: an expression is returned, a body runs as is; looksLikeBody tells them apart', () => {
    expect(looksLikeBody('return 1')).toBe(true);
    expect(looksLikeBody('const n = 2; return n')).toBe(true);
    expect(looksLikeBody('document.title')).toBe(false);
    expect(looksLikeBody('returnValue')).toBe(false);
    expect(evalSource('document.title', false)).toContain('return (\ndocument.title\n);');
    expect(evalSource('return 1', true)).toContain('\nreturn 1\n');
    expect(evalSource('1', false)).toContain(String(EVAL_MAX_CHARS));
  });

  it('evalSource runs: JSON back, undefined / functions / cycles as words, a thrown error as an answer, the cut', async () => {
    // the wrapper is plain JS: it runs in Node the same way it runs in the page
    const go = (script: string, body: boolean) => (0, eval)(evalSource(script, body)) as Promise<{ ok: boolean; value?: string; error?: string }>;
    expect(await go('({ a: 1, b: [2, 3] })', false)).toEqual({ ok: true, value: '{"a":1,"b":[2,3]}' });
    expect(await go('const x = { n: 1 }; x.self = x; return x', true)).toEqual({ ok: true, value: '{"n":1,"self":"[circular]"}' });
    expect(await go('undefined', false)).toEqual({ ok: true, value: 'undefined' });
    expect(await go('({ f() {} })', false)).toEqual({ ok: true, value: '{"f":"[function]"}' });
    expect(await go('Promise.resolve(7)', false)).toEqual({ ok: true, value: '7' });
    expect(await go('throw new Error("boom")', true)).toEqual({ ok: false, error: 'boom' });
    expect((await go('"x".repeat(20000)', false)).value).toHaveLength(EVAL_MAX_CHARS);
    expect(() => (0, eval)(evalSource('a = ; b', false))).toThrow(SyntaxError);
  });
});
