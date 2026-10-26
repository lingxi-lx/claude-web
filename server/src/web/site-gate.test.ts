import { describe, expect, it } from 'vitest';
import type { BrowserOp, PermissionMode, PermissionRequestEvent } from '../protocol.js';
import { ALLOWED_SITES_AUTO_KEY, MUTATING_OPS, OPENING_OP, SCRIPT_PREVIEW_CHARS, SITE_TOOL, SiteAsk, allowedSitesOf, autoAllowHost, autoSitesOf, hostOfUrl, needsAsk, normHost, scriptHost, siteAllowed, siteAnswerOf } from './site-gate.js';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe('scriptHost: the site an ego lite script names first', () => {
  it('the first http(s) address in the script, as a host; \'\' when there is none', () => {
    expect(scriptHost("const p = task.page('p1');\nawait p.goto('https://GitHub.com/citrolabs/ego-lite'); await p.goto('https://b.example/')")).toBe('github.com');
    expect(scriptHost('await p.goto(`http://localhost:5173/x`)')).toBe('localhost');
    expect(scriptHost('console.log(1)')).toBe('');
    expect(scriptHost('')).toBe('');
  });
});

describe('siteAllowed: is a host on the allowed-sites list', () => {
  it('an exact entry is that host only — not its subdomains, not a look-alike', () => {
    expect(siteAllowed('example.com', ['example.com'])).toBe(true);
    expect(siteAllowed('www.example.com', ['example.com'])).toBe(false);
    expect(siteAllowed('example.com.evil.net', ['example.com'])).toBe(false);
    expect(siteAllowed('notexample.com', ['example.com'])).toBe(false);
    expect(siteAllowed('example.co', ['example.com'])).toBe(false);
  });

  it('*.example.com: the host and every subdomain', () => {
    const list = ['*.example.com'];
    expect(siteAllowed('example.com', list)).toBe(true);
    expect(siteAllowed('a.example.com', list)).toBe(true);
    expect(siteAllowed('a.b.example.com', list)).toBe(true);
    expect(siteAllowed('badexample.com', list)).toBe(false);
    expect(siteAllowed('example.com.evil.net', list)).toBe(false);
    // a bare "*." is nothing
    expect(siteAllowed('example.com', ['*.'])).toBe(false);
  });

  it('case, a trailing dot and the port do not count', () => {
    expect(siteAllowed('EXAMPLE.com', ['example.COM'])).toBe(true);
    expect(siteAllowed('example.com.', ['example.com'])).toBe(true);
    expect(siteAllowed('A.Example.Com', ['*.EXAMPLE.com'])).toBe(true);
    expect(siteAllowed('localhost', ['localhost:3000'])).toBe(true);
    expect(siteAllowed('localhost:5173', ['localhost'])).toBe(true);
    // an address pasted in counts by its host
    expect(siteAllowed('shop.example.com', ['https://shop.example.com:8443/cart'])).toBe(true);
  });

  it('IP addresses match only themselves (a wildcard never matches an IP)', () => {
    expect(siteAllowed('127.0.0.1', ['127.0.0.1'])).toBe(true);
    expect(siteAllowed('127.0.0.2', ['127.0.0.1'])).toBe(false);
    expect(siteAllowed('10.0.0.1', ['*.0.0.1'])).toBe(false);
    expect(siteAllowed('::1', ['[::1]'])).toBe(true);
    expect(siteAllowed('[::1]', ['::1'])).toBe(true);
    expect(siteAllowed('::2', ['::1'])).toBe(false);
  });

  it('localhost is not allowed by itself, and not by a look-alike entry', () => {
    expect(siteAllowed('localhost', [])).toBe(false);
    expect(siteAllowed('localhost.evil.com', ['localhost'])).toBe(false);
    expect(siteAllowed('localhost', ['LOCALHOST'])).toBe(true);
  });

  it('junk: no host, junk entries, not a list', () => {
    expect(siteAllowed('', ['example.com'])).toBe(false);
    expect(siteAllowed('example.com', [42, null, {}, '', '  '] as unknown[])).toBe(false);
    expect(siteAllowed('example.com', 'example.com' as unknown as string[])).toBe(false);
    expect(allowedSitesOf({ 'web.browser.allowedSites': ['a.com', 3, ' ', 'b.com'] })).toEqual(['a.com', 'b.com']);
    expect(allowedSitesOf({})).toEqual([]);
  });

  it('normHost / hostOfUrl', () => {
    expect(normHost(' Example.COM. ')).toBe('example.com');
    expect(normHost('[::1]:3000')).toBe('::1');
    expect(normHost('host:8080')).toBe('host');
    expect(hostOfUrl('http://LocalHost:3000/x')).toBe('localhost');
    expect(hostOfUrl('file:///C:/x.html')).toBe('');
    expect(hostOfUrl('about:blank')).toBe('');
    expect(hostOfUrl('not a url')).toBe('');
    // a blob: page belongs to its origin (ops.ts hostOf says the same)
    expect(hostOfUrl('blob:https://Bank.example/0b1c-2d')).toBe('bank.example');
  });
});

describe('needsAsk: when the user is asked', () => {
  const list = ['allowed.com'];
  it('page-changing ops on a new site ask; on an allowed site they do not', () => {
    for (const op of ['click', 'type', 'key', 'scroll', 'computer', 'hover', 'drag', 'select'] as BrowserOp[]) {
      expect(MUTATING_OPS.has(op)).toBe(true);
      expect(needsAsk(op, 'new.com', { list })).toBe('site');
      expect(needsAsk(op, 'allowed.com', { list })).toBe('no');
      expect(needsAsk(op, undefined, { list })).toBe('site');
    }
  });

  it('reading the page that is open never asks (its site was allowed or answered when it was opened)', () => {
    for (const op of ['read', 'find', 'snapshot', 'screenshot', 'console', 'network', 'tabs', 'wait', 'back', 'viewport', 'search'] as BrowserOp[]) {
      expect(needsAsk(op, 'new.com', { list: [] })).toBe('no');
    }
  });

  it('opening a site (op open: browser_open, a new tab with an address) is asked about once on a site not on the list, in every mode but 完全放开', () => {
    expect(OPENING_OP).toBe('open');
    expect(MUTATING_OPS.has('open')).toBe(false); // the window's own check is about the page that is open; opening is checked before it
    for (const mode of [undefined, 'default', 'acceptEdits', 'plan', 'dontAsk', 'auto'] as (PermissionMode | undefined)[]) {
      expect(needsAsk('open', 'new.com', { list, mode }), String(mode)).toBe('site');
      expect(needsAsk('open', 'allowed.com', { list, mode }), String(mode)).toBe('no');
      expect(needsAsk('open', 'www.allowed.com', { list, mode }), String(mode)).toBe('site'); // a bare entry is that host only
      expect(needsAsk('open', 'www.allowed.com', { list: ['*.allowed.com'], mode }), String(mode)).toBe('no');
      expect(needsAsk('open', 'allowed.com.evil.net', { list, mode }), String(mode)).toBe('site');
    }
    expect(needsAsk('open', 'new.com', { list: [], mode: 'bypassPermissions' })).toBe('no');
  });

  it('完全放开 (bypassPermissions): no site is asked about; other modes still ask', () => {
    expect(needsAsk('click', 'new.com', { list: [], mode: 'bypassPermissions' })).toBe('no');
    expect(needsAsk('click', 'new.com', { list: [], mode: 'acceptEdits' })).toBe('site');
    expect(needsAsk('click', 'new.com', { list: [], mode: 'auto' })).toBe('site');
    expect(needsAsk('click', 'new.com', { list: [], mode: 'default' })).toBe('site');
  });

  it('a script asks every time — on an allowed site too — in every mode but 完全放开', () => {
    expect(needsAsk('eval', 'allowed.com', { list })).toBe('eval');
    expect(needsAsk('eval', 'new.com', { list: [] })).toBe('eval');
    expect(needsAsk('eval', undefined, { list: [] })).toBe('eval');
    for (const mode of ['default', 'acceptEdits', 'plan', 'dontAsk', 'auto'] as PermissionMode[]) {
      expect(needsAsk('eval', 'allowed.com', { list, mode })).toBe('eval');
      expect(needsAsk('eval', 'new.com', { list: [], mode })).toBe('eval');
    }
  });

  it('完全放开 (bypassPermissions, spec 14.4) asks nothing: not a script, not a site', () => {
    const mode: PermissionMode = 'bypassPermissions';
    expect(needsAsk('eval', 'allowed.com', { list, mode })).toBe('no');
    expect(needsAsk('eval', 'new.com', { list: [], mode })).toBe('no');
    expect(needsAsk('eval', undefined, { list: [], mode })).toBe('no');
    for (const op of MUTATING_OPS) expect(needsAsk(op, 'new.com', { list: [], mode })).toBe('no');
  });

  it('site ops in the five other modes: unchanged (asked on a new site, not on an allowed one)', () => {
    for (const mode of ['default', 'acceptEdits', 'plan', 'dontAsk', 'auto'] as PermissionMode[]) {
      expect(needsAsk('click', 'new.com', { list, mode })).toBe('site');
      expect(needsAsk('click', 'allowed.com', { list, mode })).toBe('no');
      expect(needsAsk('read', 'new.com', { list, mode })).toBe('no');
    }
  });
});

describe('autoAllowHost: the site 完全放开 puts on 允许的网站 (spec 14.4, last bullet)', () => {
  const bypass: PermissionMode = 'bypassPermissions';
  it('a site op or opening a page on an http(s) site, in 完全放开: its host', () => {
    for (const op of ['click', 'type', 'key', 'scroll', 'computer', 'hover', 'drag', 'select', 'open'] as BrowserOp[]) {
      expect(autoAllowHost(op, 'https://Shop.Example:8443/cart', bypass), op).toBe('shop.example');
    }
    expect(autoAllowHost('click', 'http://localhost:5173/', bypass)).toBe('localhost');
    expect(autoAllowHost('click', 'http://127.0.0.1/', bypass)).toBe('127.0.0.1');
  });
  it('a script never; reading never', () => {
    for (const op of ['eval', 'read', 'find', 'snapshot', 'screenshot', 'console', 'network', 'tabs', 'wait', 'back', 'viewport'] as BrowserOp[]) {
      expect(autoAllowHost(op, 'https://shop.example/', bypass), op).toBe('');
    }
  });
  it('the five other modes (and no mode): never', () => {
    for (const mode of ['default', 'acceptEdits', 'plan', 'dontAsk', 'auto', undefined] as (PermissionMode | undefined)[]) {
      expect(autoAllowHost('click', 'https://shop.example/', mode)).toBe('');
      expect(autoAllowHost('open', 'https://shop.example/', mode)).toBe('');
    }
  });
  it('a page that is not a web site: about:blank, file:, data:, chrome:, blob:, junk, nothing', () => {
    for (const url of ['about:blank', 'file:///C:/x.html', 'data:text/html,hi', 'chrome://settings', 'devtools://x', 'blob:https://shop.example/uuid', 'not a url', '', undefined]) {
      expect(autoAllowHost('click', url, bypass), String(url)).toBe('');
    }
  });
});

describe('autoSitesOf: the 完全放开 marks next to the list', () => {
  it('the marks as stored (strings only, normalised); junk is none', () => {
    expect(autoSitesOf({ [ALLOWED_SITES_AUTO_KEY]: ['A.example', 1, '', ' b.example '] })).toEqual(['a.example', 'b.example']);
    expect(autoSitesOf({ [ALLOWED_SITES_AUTO_KEY]: 'x' })).toEqual([]);
    expect(autoSitesOf({})).toEqual([]);
  });
});

describe('SiteAsk: the card, and its three answers', () => {
  function make(over: ConstructorParameters<typeof SiteAsk>[0] = {}) {
    const ask = new SiteAsk(over);
    const asked: PermissionRequestEvent[] = [];
    const resolved: string[] = [];
    ask.on('permission', (e) => asked.push(e));
    ask.on('permissionResolved', (id) => resolved.push(id));
    return { ask, asked, resolved };
  }

  it('a site card: once / always / deny', async () => {
    const { ask, asked, resolved } = make();
    const p = ask.ask('c1', { host: 'shop.com', op: 'click', tool: 'browser_click' });
    await tick();
    expect(asked[0]).toMatchObject({ sessionId: 'c1', toolName: SITE_TOOL, input: { host: 'shop.com', op: 'click', tool: 'browser_click' } });
    expect(asked[0].input.eval).toBeUndefined();
    expect(ask.pendingFor('c1')).toEqual([asked[0]]);
    expect(ask.pendingFor('c2')).toEqual([]);
    expect(ask.respond('nope', { behavior: 'allow' })).toBe(false);
    expect(ask.respond(asked[0].requestId, { behavior: 'allow' })).toBe(true);
    expect(await p).toBe('once');
    expect(resolved).toEqual([asked[0].requestId]);

    const q = ask.ask('c1', { host: 'shop.com', op: 'type', tool: 'browser_type' });
    await tick();
    ask.respond(asked[1].requestId, { behavior: 'allow', updatedInput: { allow: 'always' } });
    expect(await q).toBe('always');

    const r = ask.ask('c1', { host: 'shop.com', op: 'type', tool: 'browser_type' });
    await tick();
    ask.respond(asked[2].requestId, { behavior: 'deny', message: 'no' });
    expect(await r).toBe('deny');
  });

  it('a script card shows the first 400 characters and never takes 总是允许', async () => {
    const { ask, asked } = make();
    const script = 'x'.repeat(1000);
    const p = ask.ask('c1', { host: 'a.com', op: 'eval', tool: 'browser_eval', eval: true, script });
    await tick();
    expect(asked[0].input.eval).toBe(true);
    expect(String(asked[0].input.script)).toHaveLength(SCRIPT_PREVIEW_CHARS);
    expect(asked[0].input.scriptLength).toBe(1000);
    ask.respond(asked[0].requestId, { behavior: 'allow', updatedInput: { allow: 'always' } });
    expect(await p).toBe('once');
    expect(siteAnswerOf({ behavior: 'allow', updatedInput: { allow: 'always' } }, true)).toBe('once');
    expect(siteAnswerOf({ behavior: 'allow', updatedInput: { allow: 'always' } }, false)).toBe('always');
    expect(siteAnswerOf({ behavior: 'deny', message: '' }, false)).toBe('deny');
  });

  it('an ego lite script card carries the whole script (the user reads every line of what runs with their sign-ins)', async () => {
    const { ask, asked } = make();
    const script = `await page.goto('https://mail.example/inbox')\n${'y'.repeat(59_000)}`;
    const p = ask.ask('c1', { host: 'mail.example', op: 'eval', tool: 'ego_browser', eval: true, script });
    await tick();
    expect(asked[0]).toMatchObject({ toolName: SITE_TOOL, input: { host: 'mail.example', tool: 'ego_browser', eval: true, scriptLength: script.length } });
    expect(asked[0].input.script).toBe(script);
    ask.respond(asked[0].requestId, { behavior: 'allow', updatedInput: { allow: 'always' } });
    expect(await p).toBe('once');
  });

  it('nobody answers / unknown conversation / the conversation closes / the caller goes: deny', async () => {
    const t = make({ timeoutMs: 20 });
    expect(await t.ask.ask('c1', { host: 'a.com', op: 'click', tool: 'browser_click' })).toBe('deny');
    expect(t.resolved).toHaveLength(1);

    const k = make({ knows: () => false });
    expect(await k.ask.ask('c1', { host: 'a.com', op: 'click', tool: 'browser_click' })).toBe('deny');
    expect(k.asked).toHaveLength(0);
    expect(await make().ask.ask('', { host: 'a.com', op: 'click', tool: 'browser_click' })).toBe('deny');

    const d = make();
    const p = d.ask.ask('c1', { host: 'a.com', op: 'click', tool: 'browser_click' });
    await tick();
    d.ask.drop('c1');
    expect(await p).toBe('deny');

    const ac = new AbortController();
    const q = d.ask.ask('c2', { host: 'a.com', op: 'click', tool: 'browser_click' }, ac.signal);
    await tick();
    ac.abort();
    expect(await q).toBe('deny');
    expect(d.ask.pendingFor('c2')).toEqual([]);
  });
});
