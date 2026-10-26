import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PermissionMode, ToolResult } from '../protocol.js';
import { SiteAsk, type SiteAnswer, type SiteRequest } from './site-gate.js';
import { WebService } from './service.js';
import { EGO_FALLBACK } from './ego.js';

// ego_browser behind the server's gate (spec 14.1 / 14.4): every agent is asked on the same card, except in 完全放开.
// ego lite itself is not run here: runEgoScript is a spy (ego.test.ts tests the real one against a fake ego-browser).
const ran = vi.hoisted(() => [] as { sid: string; script: string }[]);
vi.mock('./ego.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./ego.js')>();
  return {
    ...real,
    runEgoScript: vi.fn(async (sid: string, script: string): Promise<ToolResult> => {
      ran.push({ sid, script });
      return { content: [{ type: 'text', text: 'ran' }] };
    }),
  };
});


const secrets = { protect: async (s: string) => s, reveal: async (s: string | undefined) => s ?? '' };
const textOf = (r: { content: any[] }) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');

type Asked = { sid: string; req: SiteRequest };
function make(gate?: { answer?: SiteAnswer; mode?: PermissionMode; ask?: (sid: string, req: SiteRequest, signal?: AbortSignal) => Promise<SiteAnswer> }) {
  const asked: Asked[] = [];
  const settings: Record<string, unknown> = {};
  const web = new WebService({
    settings: () => settings,
    setSetting: async (k, v) => { settings[k] = v; },
    secrets,
    env: {},
    lookup: async () => [],
    ...(gate ? {
      gate: {
        ask: gate.ask ?? (async (sid, req) => { asked.push({ sid, req }); return gate.answer ?? 'once'; }),
        mode: () => gate.mode,
      },
    } : {}),
  });
  return { web, asked, settings };
}

const SCRIPT = "const task = await taskSpace(CW_SPACE);\nconst p = task.page('p1');\nawait p.goto('https://mail.example/inbox');\nawait p.goto('https://other.example/');\nconsole.log(await p.snapshot());";

afterEach(() => { ran.length = 0; });

describe('WebService: ego_browser asks through the server gate', () => {
  it('asks once with the whole script and the first site it names, and runs only after 允许一次', async () => {
    let release!: (a: SiteAnswer) => void;
    const asked: Asked[] = [];
    const { web } = make({ ask: (sid, req) => { asked.push({ sid, req }); return new Promise((r) => { release = r; }); } });
    const p = web.tool('conv-1', 'ego_browser', { script: SCRIPT });
    await new Promise((r) => setTimeout(r, 5));
    expect(asked).toEqual([{ sid: 'conv-1', req: { host: 'mail.example', op: 'eval', tool: 'ego_browser', eval: true, script: SCRIPT } }]);
    expect(ran).toEqual([]);
    release('once');
    const r = await p;
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toBe('ran');
    expect(ran).toEqual([{ sid: 'conv-1', script: SCRIPT }]);
  });

  it('a script that names no address: host \'\'', async () => {
    const { web, asked } = make({ answer: 'once' });
    await web.tool('conv-1', 'ego_browser', { script: 'console.log(1)' });
    expect(asked[0].req.host).toBe('');
    expect(ran).toHaveLength(1);
  });

  it('asked in each of the five other modes, every time', async () => {
    for (const mode of ['default', 'acceptEdits', 'plan', 'dontAsk', 'auto'] as PermissionMode[]) {
      const { web, asked } = make({ answer: 'once', mode });
      await web.tool('conv-2', 'ego_browser', { script: SCRIPT });
      await web.tool('conv-2', 'ego_browser', { script: SCRIPT });
      expect(asked, mode).toHaveLength(2);
    }
    expect(ran).toHaveLength(10);
  });

  it('完全放开 (bypassPermissions): nothing is asked, the script runs', async () => {
    const { web, asked, settings } = make({ answer: 'deny', mode: 'bypassPermissions' });
    const r = await web.tool('conv-3', 'ego_browser', { script: SCRIPT });
    expect(r.isError).toBeFalsy();
    expect(asked).toEqual([]);
    expect(ran).toHaveLength(1);
    // ego lite runs scripts, not site ops: 完全放开 puts nothing on 允许的网站 from it (spec 14.4)
    await new Promise((res) => setTimeout(res, 20));
    expect(settings).toEqual({});
  });

  it('拒绝: the script does not run, the model is told the user refused — and not to fall back to the built-in browser', async () => {
    const { web, asked } = make({ answer: 'deny', mode: 'default' });
    const r = await web.tool('conv-4', 'ego_browser', { script: SCRIPT });
    expect(asked).toHaveLength(1);
    expect(ran).toEqual([]);
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('没有允许');
    expect(textOf(r)).toContain('mail.example');
    expect(textOf(r)).not.toContain(EGO_FALLBACK);
    expect(textOf(r)).not.toContain('browser_*');
  });

  it('nobody answers in time (the real card, timed out) is a 拒绝', async () => {
    const siteAsk = new SiteAsk({ timeoutMs: 20 });
    const { web } = make({ ask: (sid, req, signal) => siteAsk.ask(sid, req, signal) });
    const r = await web.tool('conv-5', 'ego_browser', { script: SCRIPT });
    expect(ran).toEqual([]);
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('没有允许');
    expect(textOf(r)).not.toContain(EGO_FALLBACK);
  });

  it('the turn is stopped while the card waits: the card is withdrawn, nothing runs', async () => {
    const siteAsk = new SiteAsk();
    const { web } = make({ ask: (sid, req, signal) => siteAsk.ask(sid, req, signal) });
    const ac = new AbortController();
    const p = web.tool('conv-6', 'ego_browser', { script: SCRIPT }, ac.signal);
    await new Promise((r) => setTimeout(r, 5));
    expect(siteAsk.pendingFor('conv-6')).toHaveLength(1);
    ac.abort();
    expect((await p).isError).toBe(true);
    expect(siteAsk.pendingFor('conv-6')).toEqual([]);
    expect(ran).toEqual([]);
  });

  it('总是允许 is never offered for a script: an \'always\' is this once — the site is not added, the next script asks again', async () => {
    const { web, asked, settings } = make({ answer: 'always' });
    await web.tool('conv-7', 'ego_browser', { script: SCRIPT });
    await web.tool('conv-7', 'ego_browser', { script: SCRIPT });
    expect(asked).toHaveLength(2);
    expect(ran).toHaveLength(2);
    expect(settings['web.browser.allowedSites']).toBeUndefined();
  });

  it('no gate (unit tests, the CLI): the script runs, as the built-in browser does', async () => {
    const { web } = make();
    const r = await web.tool('conv-8', 'ego_browser', { script: SCRIPT });
    expect(r.isError).toBeFalsy();
    expect(ran).toHaveLength(1);
  });

  it('nothing to run / too long: refused before anyone is asked', async () => {
    const { web, asked } = make({ answer: 'once' });
    expect((await web.tool('conv-9', 'ego_browser', { script: '  ' })).isError).toBe(true);
    expect((await web.tool('conv-9', 'ego_browser', { script: 'x'.repeat(60_001) })).isError).toBe(true);
    expect(asked).toEqual([]);
    expect(ran).toEqual([]);
  });
});
