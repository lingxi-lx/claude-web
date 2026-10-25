import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { PageLog, RING, acquire, axOutline, earlierRequests, forgetDebug, guestDebug, holds, pageNavigated, release, type AXNodeLike } from './guest-debug';
import { emulate, forgetGuest } from './guest-tools';

let nextId = 1000;
/** A page with a DevTools protocol: what was sent, events to fire; `devtools`: DevTools holds it (attach refuses). */
function page(o: { devtools?: boolean; answer?: (method: string, params: any) => unknown } = {}) {
  const d = new EventEmitter() as any;
  let attached = false;
  const sent: string[] = [];
  let attaches = 0;
  d.isAttached = () => attached;
  d.attach = () => { if (o.devtools) throw new Error('Another debugger is already attached to this target'); attached = true; attaches++; };
  d.detach = () => { attached = false; };
  d.sendCommand = async (method: string, params: any) => { sent.push(method); return o.answer?.(method, params) ?? {}; };
  const fire = (method: string, params: unknown) => d.emit('message', {}, method, params);
  const guest = { id: nextId++, debugger: d, isDestroyed: () => false, getURL: () => 'https://app.example/', getUserAgent: () => 'UA', setUserAgent: () => {}, reload: () => {} } as any;
  return { guest, sent, fire, attached: () => attached, attaches: () => attaches };
}

describe('one DevTools protocol per page, shared', () => {
  it('the viewport and the console log share one attachment; it goes when the last of them lets go', () => {
    const p = page();
    expect(acquire(p.guest, 'viewport')).toBeNull();
    expect(acquire(p.guest, 'capture')).toBeNull();
    expect(p.attaches()).toBe(1);
    release(p.guest, 'viewport'); // back to auto: the log stays
    expect(p.attached()).toBe(true);
    expect(holds(p.guest.id, 'capture')).toBe(true);
    release(p.guest, 'capture');
    expect(p.attached()).toBe(false);
    release(p.guest, 'capture'); // twice: nothing
    expect(p.attached()).toBe(false);
  });

  it('DevTools open: a clear error, nothing kept', async () => {
    const p = page({ devtools: true });
    expect(acquire(p.guest, 'capture')).toMatch(/开发者工具（DevTools）/);
    expect(holds(p.guest.id, 'capture')).toBe(false);
    expect(await guestDebug(p.guest, { op: 'console' })).toEqual({ error: expect.stringMatching(/DevTools/) });
    expect(await guestDebug(p.guest, { op: 'snapshot' })).toEqual({ error: expect.stringMatching(/DevTools/) });
  });

  it('the viewport going back to auto does not take the console log away (guest-tools emulate)', async () => {
    const p = page();
    const o = { base: 'Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36', uaFor: () => 'UA' };
    await emulate(p.guest, { w: 390, h: 844, touch: true, mobile: true }, o);
    expect(p.sent).toContain('Emulation.setDeviceMetricsOverride');
    await guestDebug(p.guest, { op: 'console' });
    await emulate(p.guest, null, o);
    expect(p.sent).toContain('Emulation.clearDeviceMetricsOverride');
    expect(p.attached()).toBe(true);
    expect(p.attaches()).toBe(1);
    // and the other way: the log does not keep a device size; turning the viewport on again attaches nothing new
    await emulate(p.guest, { w: 820, h: 1180, touch: true, mobile: true }, o);
    expect(p.attaches()).toBe(1);
    forgetGuest(p.guest.id);
    expect(holds(p.guest.id, 'capture')).toBe(false);
    expect(holds(p.guest.id, 'viewport')).toBe(false);
  });

  it('console: started on first use, the messages the page had logged come over, later ones are kept', async () => {
    const p = page({ answer: (m) => { if (m === 'Runtime.enable') p.fire('Runtime.consoleAPICalled', { type: 'error', args: [{ type: 'string', value: 'boom' }], timestamp: 1_760_000_000_000 }); return {}; } });
    const first = (await guestDebug(p.guest, { op: 'console' })) as any;
    expect(first.fresh).toBe(true);
    expect(first.entries).toEqual([{ level: 'error', text: 'boom', at: 1_760_000_000_000 }]);
    expect(p.sent).toEqual(['Runtime.enable', 'Log.enable', 'Network.enable', 'Runtime.evaluate']);
    p.fire('Log.entryAdded', { entry: { source: 'network', level: 'error', text: 'Failed to load resource: 404', url: 'https://app.example/x.png', timestamp: 1_760_000_000_500 } });
    const second = (await guestDebug(p.guest, { op: 'console' })) as any;
    expect(second.fresh).toBe(false);
    expect(second.entries.map((e: any) => e.text)).toEqual(['boom', 'Failed to load resource: 404']);
    expect(p.sent.filter((m) => m === 'Runtime.enable')).toHaveLength(1);
    forgetDebug(p.guest.id);
    expect(holds(p.guest.id, 'capture')).toBe(false);
  });

  it('network: the requests from before the log started come from the page\'s resource timing, not listed twice', async () => {
    const p = page({ answer: (m) => (m === 'Runtime.evaluate' ? { result: { value: [{ url: 'https://app.example/', type: 'navigation', ms: 40, status: 200 }, { url: 'https://app.example/missing.png', type: 'img', ms: 3, status: 404 }, { url: 'https://app.example/api', type: 'fetch', ms: 9, status: 0 }] } } : {}) });
    const r = (await guestDebug(p.guest, { op: 'network' })) as any;
    expect(r.fresh).toBe(true);
    expect(r.earlier).toBe(3);
    expect(r.entries).toEqual([
      { method: 'GET', url: 'https://app.example/', type: 'navigation', ms: 40, status: 200 },
      { method: 'GET', url: 'https://app.example/missing.png', type: 'img', ms: 3, status: 404 },
      { method: '?', url: 'https://app.example/api', type: 'fetch', ms: 9 },
    ]);
    p.fire('Network.requestWillBeSent', { requestId: '1', request: { url: 'https://app.example/later', method: 'POST' }, type: 'Fetch', timestamp: 10 });
    const again = (await guestDebug(p.guest, { op: 'network' })) as any;
    expect(again.fresh).toBe(false);
    expect(again.entries.at(-1)).toEqual({ method: 'POST', url: 'https://app.example/later', type: 'Fetch' });
    expect(again.earlier).toBe(0); // said once
    forgetDebug(p.guest.id);
  });

  it('the page goes to another address: the old page\'s console and requests are dropped (A6)', async () => {
    const p = page();
    await guestDebug(p.guest, { op: 'console' });
    p.fire('Runtime.exceptionThrown', { exceptionDetails: { text: 'old boom' } });
    p.fire('Network.requestWillBeSent', { requestId: '1', request: { url: 'https://old.example/api' } });
    pageNavigated(p.guest.id);
    p.fire('Network.requestWillBeSent', { requestId: '2', request: { url: 'https://new.example/app.js' } });
    expect(((await guestDebug(p.guest, { op: 'console' })) as any).entries).toEqual([]);
    expect(((await guestDebug(p.guest, { op: 'network' })) as any).entries.map((e: any) => e.url)).toEqual(['https://new.example/app.js']);
    pageNavigated(424242); // a page with no log: nothing to do
    forgetDebug(p.guest.id);
  });

  it('two first looks at once share one start; a failed start does not take the other\'s hold (A7)', async () => {
    let release1!: () => void;
    const gate = new Promise<void>((r) => { release1 = r; });
    const p = page({ answer: async (m) => { if (m === 'Runtime.enable') { await gate; p.fire('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'early' }] }); } return {}; } });
    const a = guestDebug(p.guest, { op: 'console' });
    const b = guestDebug(p.guest, { op: 'console' });
    release1();
    const [ra, rb] = (await Promise.all([a, b])) as any[];
    // the second look waited for the start: it sees what the page had logged
    expect(ra.entries.map((e: any) => e.text)).toEqual(['early']);
    expect(rb.entries.map((e: any) => e.text)).toEqual(['early']);
    expect(p.sent.filter((m) => m === 'Runtime.enable')).toHaveLength(1);
    forgetDebug(p.guest.id);

    // both looks at once and the start fails: both are told, nothing is held
    const f = page({ answer: (m) => { if (m === 'Network.enable') throw new Error('broken'); return {}; } });
    const both = (await Promise.all([guestDebug(f.guest, { op: 'console' }), guestDebug(f.guest, { op: 'network' })])) as any[];
    expect(both.map((x) => String(x.error))).toEqual([expect.stringMatching(/broken/), expect.stringMatching(/broken/)]);
    expect(holds(f.guest.id, 'capture')).toBe(false);
    expect(f.attached()).toBe(false);

    // the viewport holds the protocol, the start fails: the viewport keeps it
    const q = page({ answer: (m) => { if (m === 'Log.enable') throw new Error('nope'); return {}; } });
    acquire(q.guest, 'viewport');
    const r = (await guestDebug(q.guest, { op: 'console' })) as any;
    expect(String(r.error ?? r)).toMatch(/nope/);
    expect(holds(q.guest.id, 'viewport')).toBe(true);
    expect(holds(q.guest.id, 'capture')).toBe(false);
    expect(q.attached()).toBe(true);
    release(q.guest, 'viewport');
    expect(q.attached()).toBe(false);
  });

  it('network after console: the earlier requests were taken when the log started, and said on the first look', async () => {
    const p = page({ answer: (m) => (m === 'Runtime.evaluate' ? { result: { value: [{ url: 'https://app.example/missing.png', type: 'img', ms: 3, status: 404 }] } } : {}) });
    await guestDebug(p.guest, { op: 'console' });
    const r = (await guestDebug(p.guest, { op: 'network' })) as any;
    expect(r.fresh).toBe(false);
    expect(r.earlier).toBe(1);
    expect(r.entries).toEqual([{ method: 'GET', url: 'https://app.example/missing.png', type: 'img', ms: 3, status: 404 }]);
    forgetDebug(p.guest.id);
  });
});

describe('PageLog: the protocol\'s events as console lines and requests', () => {
  it('console calls, uncaught errors, the browser\'s own lines; never the same console call twice', () => {
    const log = new PageLog();
    log.onEvent('Runtime.consoleAPICalled', { type: 'log', args: [{ type: 'string', value: 'n =' }, { type: 'number', value: 3 }, { type: 'object', description: 'Object' }, { type: 'number', unserializableValue: 'NaN' }], timestamp: 1_760_000_000_000, stackTrace: { callFrames: [{ url: 'https://a.example/app.js' }] } });
    log.onEvent('Runtime.consoleAPICalled', { type: 'warning', args: [{ type: 'string', value: 'careful' }] }, 5);
    log.onEvent('Runtime.consoleAPICalled', { type: 'assert', args: [{ type: 'string', value: 'nope' }] }, 5);
    log.onEvent('Runtime.exceptionThrown', { timestamp: 1_760_000_000_001, exceptionDetails: { text: 'Uncaught', url: 'https://a.example/app.js', exception: { description: 'TypeError: x is undefined\n    at f (app.js:1:2)' } } });
    log.onEvent('Log.entryAdded', { entry: { source: 'console-api', level: 'info', text: 'dup' } });
    log.onEvent('Runtime.consoleAPICalled', { type: 'warning', args: [{ type: 'string', value: 'Electron Security Warning' }], stackTrace: { callFrames: [{ url: 'node:electron/js2c/sandbox_bundle' }] } });
    log.onEvent('Log.entryAdded', { entry: { source: 'violation', level: 'verbose', text: 'slow handler' } }, 7);
    expect(log.console).toEqual([
      { level: 'log', text: 'n = 3 Object NaN', at: 1_760_000_000_000, url: 'https://a.example/app.js' },
      { level: 'warning', text: 'careful', at: 5 },
      { level: 'error', text: 'nope', at: 5 },
      { level: 'error', text: 'TypeError: x is undefined\n    at f (app.js:1:2)', at: 1_760_000_000_001, url: 'https://a.example/app.js' },
      { level: 'debug', text: 'slow handler', at: 7 },
    ]);
  });

  it('keeps the last 200 of each; a huge message is cut', () => {
    const log = new PageLog();
    for (let i = 0; i < 250; i++) log.onEvent('Runtime.consoleAPICalled', { type: 'log', args: [{ type: 'string', value: `m${i}` }] });
    for (let i = 0; i < 250; i++) log.onEvent('Network.requestWillBeSent', { requestId: String(i), request: { url: `https://a.example/${i}`, method: 'GET' } });
    expect(log.console).toHaveLength(RING);
    expect(log.console[0].text).toBe('m50');
    expect(log.network).toHaveLength(RING);
    expect(log.network.at(-1)!.url).toBe('https://a.example/249');
    log.onEvent('Runtime.consoleAPICalled', { type: 'log', args: [{ type: 'string', value: 'x'.repeat(50_000) }] });
    expect(log.console.at(-1)!.text.length).toBeLessThan(2_100);
  });

  it('a request: its status, its time, why it failed; a redirect is a hop of its own', () => {
    const log = new PageLog();
    log.onEvent('Network.requestWillBeSent', { requestId: 'a', request: { url: 'https://a.example/missing.png', method: 'GET' }, type: 'Image', timestamp: 100 });
    log.onEvent('Network.responseReceived', { requestId: 'a', response: { status: 404 }, type: 'Image' });
    log.onEvent('Network.loadingFinished', { requestId: 'a', timestamp: 100.012 });
    log.onEvent('Network.requestWillBeSent', { requestId: 'b', request: { url: 'http://localhost:1/api', method: 'POST' }, type: 'Fetch', timestamp: 101 });
    log.onEvent('Network.loadingFailed', { requestId: 'b', errorText: 'net::ERR_CONNECTION_REFUSED', timestamp: 101.5 });
    log.onEvent('Network.requestWillBeSent', { requestId: 'c', request: { url: 'http://a.example/', method: 'GET' }, type: 'Document', timestamp: 102 });
    log.onEvent('Network.requestWillBeSent', { requestId: 'c', request: { url: 'https://a.example/', method: 'GET' }, type: 'Document', timestamp: 102.1, redirectResponse: { status: 301 } });
    log.onEvent('Network.requestWillBeSent', { requestId: 'd', request: { url: 'https://a.example/slow', method: 'GET' }, timestamp: 103 });
    log.onEvent('Network.loadingFailed', { requestId: 'zzz', errorText: 'unknown request' });
    expect(log.network).toEqual([
      { method: 'GET', url: 'https://a.example/missing.png', type: 'Image', status: 404, ms: 12 },
      { method: 'POST', url: 'http://localhost:1/api', type: 'Fetch', failed: 'net::ERR_CONNECTION_REFUSED', ms: 500 },
      { method: 'GET', url: 'http://a.example/', type: 'Document', status: 301, ms: 100 },
      { method: 'GET', url: 'https://a.example/', type: 'Document' },
      { method: 'GET', url: 'https://a.example/slow' },
    ]);
  });

  it('resource timing entries: only what has an address; the method only where it is sure', () => {
    expect(earlierRequests([{ url: 'https://a.example/s.js', type: 'script', ms: 4, status: 200 }, { url: '' }, null, 'x', { url: 'https://a.example/b', type: 'beacon', ms: -1 }])).toEqual([
      { method: 'GET', url: 'https://a.example/s.js', type: 'script', ms: 4, status: 200 },
      { method: '?', url: 'https://a.example/b', type: 'beacon' },
    ]);
    expect(earlierRequests('nope')).toEqual([]);
  });
});

describe('axOutline: the accessibility tree pressed into one element a line', () => {
  const node = (nodeId: string, role: string, name = '', extra: Partial<AXNodeLike> = {}): AXNodeLike => ({ nodeId, role: { value: role }, name: { value: name }, ...extra });

  it('landmarks, headings and what can be acted on, indented; generic boxes and text only pass their children on', () => {
    const tree = [
      node('1', 'RootWebArea', 'Shop', { childIds: ['2', '3'] }),
      node('2', 'banner', '', { parentId: '1', childIds: ['4', '5'] }),
      node('4', 'heading', 'Shop', { parentId: '2', properties: [{ name: 'level', value: { value: 1 } }] }),
      node('5', 'generic', '', { parentId: '2', childIds: ['6'] }),
      node('6', 'link', 'Cart', { parentId: '5', backendDOMNodeId: 66 }),
      node('3', 'main', '', { parentId: '1', childIds: ['7', '8', '9', '10', '11'] }),
      node('7', 'StaticText', 'Some words', { parentId: '3' }),
      node('8', 'textbox', 'Search', { parentId: '3', backendDOMNodeId: 88, value: { value: 'shoes' }, properties: [{ name: 'focused', value: { value: true } }] }),
      node('9', 'checkbox', 'Remember me', { parentId: '3', backendDOMNodeId: 99, properties: [{ name: 'checked', value: { value: 'true' } }, { name: 'disabled', value: { value: false } }] }),
      node('10', 'button', 'Hidden', { parentId: '3', ignored: true, childIds: ['12'] }),
      node('12', 'button', 'Inner', { parentId: '10', backendDOMNodeId: 120 }),
      node('11', 'img', '', { parentId: '3' }),
    ];
    const r = axOutline(tree);
    expect(r.truncated).toBe(false);
    expect(r.nodes).toEqual([
      { depth: 0, role: 'banner', name: '' },
      { depth: 1, role: 'heading', name: 'Shop', level: 1 },
      { depth: 1, role: 'link', name: 'Cart', backendId: 66 },
      { depth: 0, role: 'main', name: '' },
      { depth: 1, role: 'textbox', name: 'Search', value: 'shoes', states: ['focused'], backendId: 88 },
      { depth: 1, role: 'checkbox', name: 'Remember me', states: ['checked'], backendId: 99 },
      { depth: 1, role: 'button', name: 'Inner', backendId: 120 },
    ]);
  });

  it('a long list of options is cut to 25 with a count; the whole outline to its line budget', () => {
    const opts = Array.from({ length: 230 }, (_, i) => node(`o${i}`, 'option', `Country ${i}`, { parentId: 's' }));
    const tree = [node('r', 'RootWebArea', '', { childIds: ['s'] }), node('s', 'listbox', 'Country', { parentId: 'r', childIds: opts.map((o) => o.nodeId) }), ...opts];
    const r = axOutline(tree);
    expect(r.nodes).toHaveLength(1 + 25 + 1);
    expect(r.nodes.at(-1)).toEqual({ depth: 1, role: 'option', name: '', more: 205 });
    const many = Array.from({ length: 500 }, (_, i) => node(`b${i}`, 'button', `B${i}`, { parentId: 'r' }));
    const big = axOutline([node('r', 'RootWebArea', '', { childIds: many.map((b) => b.nodeId) }), ...many], 100);
    expect(big.nodes).toHaveLength(100);
    expect(big.truncated).toBe(true);
  });

  it('a name cannot spread over lines or run on; a tree that loops ends', () => {
    const r = axOutline([node('1', 'RootWebArea', '', { childIds: ['2'] }), node('2', 'button', `Buy\n\n   now ${'x'.repeat(300)}`, { parentId: '1', childIds: ['1', '2'] })]);
    expect(r.nodes).toHaveLength(1);
    expect(r.nodes[0].name.startsWith('Buy now x')).toBe(true);
    expect(r.nodes[0].name.length).toBeLessThanOrEqual(121);
    expect(axOutline([])).toEqual({ nodes: [], truncated: false });
  });
});

describe('the snapshot puts the page agent\'s refs on the outline', () => {
  it('resolves each element it can act on and asks the page agent for its ref, in one call; the protocol is let go after', async () => {
    const calls: any[] = [];
    const p = page({
      answer: (m, params) => {
        calls.push([m, params]);
        if (m === 'Accessibility.getFullAXTree') return { nodes: [{ nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2', '3'] }, { nodeId: '2', parentId: '1', role: { value: 'button' }, name: { value: 'Buy' }, backendDOMNodeId: 7 }, { nodeId: '3', parentId: '1', role: { value: 'link' }, name: { value: 'Help' }, backendDOMNodeId: 8 }] };
        if (m === 'DOM.resolveNode') return { object: { objectId: `obj-${params.backendNodeId}` } };
        if (m === 'Runtime.callFunctionOn') return { result: { value: ['kqz12', '<script>'] } };
        return {};
      },
    });
    const r = (await guestDebug(p.guest, { op: 'snapshot' })) as any;
    expect(r).toEqual({ nodes: [{ depth: 0, role: 'button', name: 'Buy', ref: 'kqz12' }, { depth: 0, role: 'link', name: 'Help' }], truncated: false });
    const fn = calls.find((c) => c[0] === 'Runtime.callFunctionOn')[1];
    expect(fn.arguments).toEqual([{ objectId: 'obj-7' }, { objectId: 'obj-8' }]);
    expect(fn.functionDeclaration).toContain('__cwAgent');
    expect(p.sent).toContain('Runtime.releaseObjectGroup');
    expect(p.attached()).toBe(false); // nobody else needed it
  });
});
