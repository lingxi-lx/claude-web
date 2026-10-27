// Executable plugins: each one runs in its own Node child process (spec §4.3).
//  - permissions are declared in plugin.json (network hosts, file read paths, secret names) and approved by the user;
//  - the child gets a minimal environment (no API keys, no proxy credentials from ours), Node's permission model
//    where available (file reads limited to its folder + declared paths; no child processes / workers / addons),
//    no raw sockets (net / http / tls / dns / child_process are refused at require), and a `host.fetch` that goes
//    through this process: host allow-list, the privacy hook, a timeout and a size cap;
//  - every call has a timeout (the child is killed when it runs out) and stdout / stderr are capped.
// Extension points: `requestBefore` / `responseAfter` (gateway, see gatewayPluginHooks) and `sources` (data only).
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChildToHost, HostToChild, PluginHook, PluginManifest } from './protocol.js';

const DEFAULT_TIMEOUT = 10_000;
const MAX_TIMEOUT = 60_000;
const DEFAULT_OUTPUT = 64 * 1024;
const MAX_OUTPUT = 1024 * 1024;
const MAX_RESULT = 2 * 1024 * 1024;
const MAX_FETCH_BODY = 4 * 1024 * 1024;
const READY_TIMEOUT = 10_000;

/** The optional privacy boundary (server/src/privacy). Present → every plugin request body passes through it. */
export interface PluginPrivacyHook {
  /** Redact what leaves this machine; throw to refuse sending (the request then fails, it never goes bare). */
  outbound(body: string, ctx: { source: string; url: string }): Promise<string>;
  /** Restore placeholders in what came back. */
  inbound?(body: string, ctx: { source: string; url: string }): Promise<string>;
}
let privacyHook: PluginPrivacyHook | null = null;
/** Called by the privacy module when it starts (optional: plugins work without it, with nothing redacted). */
export function setPluginPrivacyHook(h: PluginPrivacyHook | null): void { privacyHook = h; }

/** The child's bootstrap (CommonJS, written next to the plugins as .runtime/host.cjs). No template literals inside. */
export const BOOTSTRAP = [
  "'use strict';",
  "const Module = require('module');",
  "const entry = process.argv[2];",
  "const BLOCK = new Set(['net','tls','http','https','http2','dgram','dns','dns/promises','child_process','cluster','worker_threads','inspector','vm','v8','repl','trace_events','wasi']);",
  "const load = Module._load;",
  "Module._load = function (req) {",
  "  const name = String(req).replace(/^node:/, '');",
  "  if (BLOCK.has(name)) throw new Error('a plugin may not load ' + name + ' (use host.fetch)');",
  "  return load.apply(this, arguments);",
  "};",
  "let seq = 0; const waiting = new Map();",
  "function ask(msg) { return new Promise(function (res, rej) { const id = ++seq; waiting.set(id, { res: res, rej: rej }); msg.id = id; process.send(msg); }); }",
  "const host = Object.freeze({",
  "  fetch: async function (url, init) {",
  "    init = init || {};",
  "    const r = await ask({ t: 'fetch', url: String(url), method: init.method, headers: init.headers, body: typeof init.body === 'string' ? init.body : undefined });",
  "    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: r.headers || {}, text: async function () { return r.body || ''; }, json: async function () { return JSON.parse(r.body || 'null'); } };",
  "  },",
  "  secret: function (name) { return ask({ t: 'secret', name: String(name) }).then(function (r) { return r.value; }); },",
  "  log: function () { console.error.apply(console, arguments); },",
  "});",
  "globalThis.fetch = host.fetch;",
  "for (const k of ['WebSocket', 'EventSource', 'XMLHttpRequest']) { try { delete globalThis[k]; } catch (e) {} }",
  "const plugin = require(entry);",
  "const hooks = { 'request-before': plugin.requestBefore, 'response-after': plugin.responseAfter, 'source-provider': plugin.sources };",
  "process.on('message', async function (m) {",
  "  if (!m || typeof m !== 'object') return;",
  "  if (m.t === 'fetchResult' || m.t === 'secretResult') { const w = waiting.get(m.id); if (!w) return; waiting.delete(m.id); if (m.ok) w.res(m); else w.rej(new Error(m.error || 'denied')); return; }",
  "  if (m.t !== 'call') return;",
  "  const fn = hooks[m.hook];",
  "  try {",
  "    if (typeof fn !== 'function') throw new Error('hook not implemented: ' + m.hook);",
  "    const value = await fn(m.payload, host);",
  "    process.send({ t: 'result', id: m.id, ok: true, value: value === undefined ? null : value });",
  "  } catch (e) { process.send({ t: 'result', id: m.id, ok: false, error: String((e && e.message) || e) }); }",
  "});",
  "process.send({ t: 'ready', hooks: Object.keys(hooks).filter(function (k) { return typeof hooks[k] === 'function'; }) });",
].join('\n');

/** Which permission flag this Node has ('--permission' from 22.13 / 23.5, '--experimental-permission' before). */
export function permissionFlag(): string | null {
  const flags = process.allowedNodeEnvironmentFlags;
  if (flags.has('--permission')) return '--permission';
  if (flags.has('--experimental-permission')) return '--experimental-permission';
  return null;
}

/** `api.example.com` or `*.example.com` (one or more labels). */
export function hostAllowed(host: string, allow: string[] = []): boolean {
  const h = host.toLowerCase();
  return allow.some((p) => {
    const q = p.trim().toLowerCase();
    if (!q) return false;
    if (q.startsWith('*.')) return h.endsWith(q.slice(1)) && h.length > q.length - 1;
    return h === q;
  });
}

const clampTimeout = (m: PluginManifest) => Math.min(MAX_TIMEOUT, Math.max(1000, m.timeoutMs ?? DEFAULT_TIMEOUT));
const clampOutput = (m: PluginManifest) => Math.min(MAX_OUTPUT, Math.max(1024, m.maxOutputBytes ?? DEFAULT_OUTPUT));

export interface RunnerOptions {
  /** the bootstrap file (written by the service) */
  bootstrap: string;
  /** an approved secret's value, or undefined (not declared / not approved / not set) */
  secret(name: string): Promise<string | undefined>;
}

/** One executable plugin's child process: started on first call, killed on timeout / stop. */
export class PluginRunner {
  private child: ChildProcess | null = null;
  private ready: Promise<string[]> | null = null;
  private calls = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; timer: NodeJS.Timeout }>();
  private seq = 0;
  private output = '';
  private outputCut = false;
  readonly isolation: 'permission' | 'process' = permissionFlag() ? 'permission' : 'process';

  constructor(readonly dir: string, readonly manifest: PluginManifest, private opts: RunnerOptions) {}

  get running(): boolean { return !!this.child && this.child.exitCode === null; }
  lastOutput(): string { return this.output + (this.outputCut ? '\n…' : ''); }

  private entry(): string {
    const f = path.resolve(this.dir, this.manifest.main);
    const rel = path.relative(this.dir, f);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('plugin main must be inside its folder');
    return f;
  }

  private readPaths(): string[] {
    const list = [this.dir, path.join(this.dir, '*'), this.opts.bootstrap];
    for (const p of this.manifest.permissions.fileRead ?? []) {
      const abs = path.resolve(this.dir, p);
      list.push(abs, path.join(abs, '*'));
    }
    return list;
  }

  private start(): Promise<string[]> {
    if (this.ready && this.running) return this.ready;
    const entry = this.entry();
    const flag = permissionFlag();
    const args = flag ? [flag, ...this.readPaths().map((p) => `--allow-fs-read=${p}`)] : [];
    // a minimal environment: nothing of ours (keys, proxies, tokens) is inherited
    const env: Record<string, string> = { NODE_ENV: 'production', CW_PLUGIN_ID: this.manifest.id };
    for (const k of ['SystemRoot', 'TEMP', 'TMP', 'LANG']) if (process.env[k]) env[k] = process.env[k]!;
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
    const child = spawn(process.execPath, [...args, this.opts.bootstrap, entry], {
      cwd: this.dir,
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
      serialization: 'json',
    });
    this.child = child;
    this.output = '';
    this.outputCut = false;
    const cap = clampOutput(this.manifest);
    const take = (b: Buffer) => {
      if (this.output.length >= cap) { this.outputCut = true; return; }
      this.output += b.toString('utf8').slice(0, cap - this.output.length);
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    this.ready = new Promise<string[]>((resolve, reject) => {
      const t = setTimeout(() => { reject(new Error('plugin did not start in time')); this.stop(); }, READY_TIMEOUT);
      child.on('message', (m: ChildToHost) => {
        if (m?.t === 'ready') { clearTimeout(t); resolve(Array.isArray(m.hooks) ? m.hooks : []); return; }
        void this.onMessage(m);
      });
      child.on('exit', (code) => {
        clearTimeout(t);
        reject(new Error(`plugin exited (${code ?? 'killed'})`));
        for (const [, c] of this.calls) { clearTimeout(c.timer); c.reject(new Error(`plugin exited (${code ?? 'killed'})`)); }
        this.calls.clear();
        if (this.child === child) { this.child = null; this.ready = null; }
      });
      child.on('error', (e) => { clearTimeout(t); reject(e); });
    });
    this.ready.catch(() => {});
    return this.ready;
  }

  private send(m: HostToChild) { try { this.child?.send(m); } catch { /* exited */ } }

  private async onMessage(m: ChildToHost) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'result') {
      const c = this.calls.get(m.id);
      if (!c) return;
      this.calls.delete(m.id);
      clearTimeout(c.timer);
      if (!m.ok) return c.reject(new Error(String(m.error ?? 'plugin error').slice(0, 500)));
      const size = JSON.stringify(m.value ?? null).length;
      if (size > MAX_RESULT) return c.reject(new Error('plugin result too large'));
      return c.resolve(m.value);
    }
    if (m.t === 'secret') {
      const declared = (this.manifest.permissions.secrets ?? []).includes(m.name);
      const value = declared ? await this.opts.secret(m.name).catch(() => undefined) : undefined;
      this.send(value === undefined
        ? { t: 'secretResult', id: m.id, ok: false, error: declared ? 'secret not approved or not set' : 'secret not declared' }
        : { t: 'secretResult', id: m.id, ok: true, value });
      return;
    }
    if (m.t === 'fetch') {
      try {
        this.send({ t: 'fetchResult', id: m.id, ok: true, ...(await this.fetch(m)) });
      } catch (e) {
        this.send({ t: 'fetchResult', id: m.id, ok: false, error: (e as Error).message });
      }
    }
  }

  private async fetch(m: Extract<ChildToHost, { t: 'fetch' }>): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    let u: URL;
    try { u = new URL(m.url); } catch { throw new Error('bad url'); }
    if (u.protocol !== 'https:') throw new Error('only https');
    if (!hostAllowed(u.hostname, this.manifest.permissions.network)) throw new Error(`host not allowed: ${u.hostname}`);
    const source = `plugin:${this.manifest.id}`;
    let body = typeof m.body === 'string' ? m.body : undefined;
    if (body !== undefined && body.length > MAX_FETCH_BODY) throw new Error('request body too large');
    if (body !== undefined && privacyHook) body = await privacyHook.outbound(body, { source, url: u.origin });
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(m.headers ?? {})) if (typeof v === 'string' && !/^(host|cookie|proxy-)/i.test(k)) headers[k] = v;
    const r = await fetch(u, { method: m.method ?? 'GET', headers, body, redirect: 'manual', signal: AbortSignal.timeout(clampTimeout(this.manifest)) });
    let text = await r.text();
    if (text.length > MAX_FETCH_BODY) text = text.slice(0, MAX_FETCH_BODY);
    if (privacyHook?.inbound) text = await privacyHook.inbound(text, { source, url: u.origin });
    const outHeaders: Record<string, string> = {};
    r.headers.forEach((v, k) => { if (!/^set-cookie$/i.test(k)) outHeaders[k] = v; });
    return { status: r.status, headers: outHeaders, body: text };
  }

  /** One hook call; the child is killed when it runs past the manifest's timeout. */
  async call<T = unknown>(hook: PluginHook, payload: unknown): Promise<T> {
    if (!this.manifest.hooks.includes(hook)) throw new Error(`plugin does not declare ${hook}`);
    const hooks = await this.start();
    if (!hooks.includes(hook)) throw new Error(`plugin does not implement ${hook}`);
    const id = ++this.seq;
    const ms = clampTimeout(this.manifest);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        reject(new Error(`plugin timed out after ${ms} ms`));
        this.stop();
      }, ms);
      this.calls.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.send({ t: 'call', id, hook, payload });
    });
  }

  stop(): void {
    const c = this.child;
    this.child = null;
    this.ready = null;
    if (c && c.exitCode === null) { try { c.kill(); } catch { /* gone */ } }
  }
}

/** Read and validate `<dir>/plugin.json`. */
export async function readManifest(dir: string): Promise<PluginManifest> {
  const raw = JSON.parse(await fs.readFile(path.join(dir, 'plugin.json'), 'utf8'));
  const id = String(raw?.id ?? '');
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(id)) throw new Error('plugin.json: bad id');
  const hooks = (Array.isArray(raw.hooks) ? raw.hooks : []).filter((h: string) => ['request-before', 'response-after', 'source-provider'].includes(h));
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 50) : []);
  const p = raw.permissions ?? {};
  return {
    id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 100) : id,
    version: typeof raw.version === 'string' ? raw.version.slice(0, 40) : '0.0.0',
    ...(typeof raw.description === 'string' ? { description: raw.description.slice(0, 300) } : {}),
    main: typeof raw.main === 'string' && raw.main ? raw.main : 'index.js',
    hooks,
    permissions: { network: strs(p.network), fileRead: strs(p.fileRead), secrets: strs(p.secrets) },
    ...(typeof raw.timeoutMs === 'number' ? { timeoutMs: raw.timeoutMs } : {}),
    ...(typeof raw.maxOutputBytes === 'number' ? { maxOutputBytes: raw.maxOutputBytes } : {}),
  };
}
