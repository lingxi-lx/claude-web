import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clip, egoGuide, egoReset, egoStatus, looksUnreachable, runEgoScript, spaceOf, versionOf } from './ego.js';

/**
 * A fake `ego-browser`: `skill` prints a guide, `nodejs -e "await import('file:///…')"` imports the round file with
 * the given globals — enough to see what ego lite would be handed and what comes back. FAKE_EGO_MODE switches failures.
 */
const FAKE = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const [cmd, flag, code] = process.argv.slice(2);
const log = process.env.FAKE_EGO_LOG;
if (log) fs.appendFileSync(log, JSON.stringify(process.argv.slice(2)) + '\\n');
const mode = process.env.FAKE_EGO_MODE || '';
if (cmd === 'skill') {
  if (mode === 'noskill') process.exit(3);
  process.stdout.write('[ego-browser:skill] ego-browser v1.4.2\\n# Guide\\nconst task = await taskSpace(name)\\n');
  process.exit(0);
}
if (cmd !== 'nodejs' || flag !== '-e') { process.stderr.write('usage'); process.exit(2); }
if (mode === 'down') { process.stderr.write('Error: connect ECONNREFUSED 127.0.0.1:9333 (is ego lite running?)'); process.exit(1); }
globalThis.taskSpace = async (n) => ({ name: n });
(async () => { await eval('(async () => {' + code + '})()'); })().catch((e) => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });
`;

let dir: string;
let bin: string;
let log: string;
const oldPath = process.env.PATH;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ego-'));
  bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'ego-browser.js'), FAKE);
  if (process.platform === 'win32') fs.writeFileSync(path.join(bin, 'ego-browser.cmd'), '@ECHO off\r\nnode "%~dp0\\ego-browser.js" %*\r\n');
  else { fs.writeFileSync(path.join(bin, 'ego-browser'), FAKE); fs.chmodSync(path.join(bin, 'ego-browser'), 0o755); }
  log = path.join(dir, 'calls.log');
  process.env.FAKE_EGO_LOG = log;
});
afterAll(() => { process.env.PATH = oldPath; delete process.env.FAKE_EGO_LOG; fs.rmSync(dir, { recursive: true, force: true }); });
afterEach(() => { egoReset(); process.env.PATH = oldPath; delete process.env.FAKE_EGO_MODE; });

const withEgo = () => { process.env.PATH = `${bin}${path.delimiter}${oldPath}`; };
const text = (r: { content: { type: string; text?: string }[] }) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');

describe('ego lite', () => {
  it('reads the version from the guide header', () => {
    expect(versionOf('[ego-browser:skill] ego-browser v1.4.2\n# x')).toBe('1.4.2');
    expect(versionOf('[ego-browser:skill] v2.0.0-beta.1')).toBe('2.0.0-beta.1');
    expect(versionOf('# no header')).toBeUndefined();
  });

  it('is not found without the command, and says to use the built-in browser', async () => {
    process.env.PATH = path.join(dir, 'empty');
    expect(await egoStatus(false)).toEqual({ found: false });
    const r = await runEgoScript('sess-none', 'console.log(1)', { root: dir });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('browser_*');
  });

  it('finds the command and its version', async () => {
    withEgo();
    const st = await egoStatus(false);
    expect(st.found).toBe(true);
    expect(st.version).toBe('1.4.2');
    expect(path.basename(st.path!)).toMatch(/^ego-browser(\.cmd)?$/);
  });

  it('a command whose guide fails is not counted as installed', async () => {
    withEgo();
    process.env.FAKE_EGO_MODE = 'noskill';
    expect((await egoStatus(false)).found).toBe(false);
  });

  it('puts our convention in front of the guide', async () => {
    withEgo();
    const t = text(await egoGuide('abcdef1234'));
    expect(t).toContain('claude-web abcdef12');
    expect(t).toContain('CW_OUT');
    expect(t).toContain('const task = await taskSpace(name)');
  });

  it('runs a round from a UTF-8 .mjs file with the Space and output folder set, through import()', async () => {
    withEgo();
    fs.writeFileSync(log, '');
    const script = 'const t = await taskSpace(CW_SPACE);\nconsole.log("空间:" + t.name + " 中文 \\"引号\\" $HOME `x`");\nconst fs = await import("node:fs");\nconst path = await import("node:path");\nfs.writeFileSync(path.join(CW_OUT, "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));';
    const r = await runEgoScript('sess-utf8-xyz', script, { root: dir });
    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain('空间:claude-web sess-utf 中文 "引号" $HOME `x`');
    expect(text(r)).toContain('不可信');
    const img = r.content.find((c) => c.type === 'image') as { data: string; mimeType: string } | undefined;
    expect(img?.mimeType).toBe('image/png');
    expect(Buffer.from(img!.data, 'base64')).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const round = path.join(dir, 'sess-utf', 'round-01.mjs');
    const written = fs.readFileSync(round, 'utf8');
    expect(written.startsWith(`globalThis.CW_SPACE = ${JSON.stringify(spaceOf('sess-utf8-xyz'))};\n`)).toBe(true);
    expect(written.endsWith(script)).toBe(true);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((a) => a[0] === 'nodejs');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe('-e');
    expect(calls[0][2]).toMatch(/^await import\("file:\/\/\/.*round-01\.mjs"\)$/);
    // the next round gets the next number; an old picture is not handed over again
    const r2 = await runEgoScript('sess-utf8-xyz', 'console.log("again")', { root: dir });
    expect(fs.existsSync(path.join(dir, 'sess-utf', 'round-02.mjs'))).toBe(true);
    expect(r2.content.some((c) => c.type === 'image')).toBe(false);
  });

  it('a failing script comes back as an error with its stderr', async () => {
    withEgo();
    const r = await runEgoScript('sess-fail', 'throw new Error("boom-3")', { root: dir });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('boom-3');
    expect(text(r)).not.toContain('browser_*');
  });

  it('ego lite not running: the error says to fall back to the built-in browser', async () => {
    withEgo();
    await egoStatus(false);
    process.env.FAKE_EGO_MODE = 'down';
    const r = await runEgoScript('sess-down', 'console.log(1)', { root: dir });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('ECONNREFUSED');
    expect(text(r)).toContain('browser_*');
  });

  it('stops a round that runs past its time', async () => {
    withEgo();
    const t0 = Date.now();
    const r = await runEgoScript('sess-slow', 'await new Promise((r) => setTimeout(r, 60000));', { root: dir, timeoutMs: 5_000 });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('5 秒');
    expect(Date.now() - t0).toBeLessThan(20_000);
  }, 30_000);

  it('rounds of one conversation run one after another', async () => {
    withEgo();
    const mark = path.join(dir, 'order.txt');
    fs.writeFileSync(mark, '');
    const s = (tag: string, ms: number) => `const fs = await import("node:fs"); fs.appendFileSync(${JSON.stringify(mark)}, "${tag}<"); await new Promise((r) => setTimeout(r, ${ms})); fs.appendFileSync(${JSON.stringify(mark)}, ">${tag} ");`;
    await Promise.all([runEgoScript('sess-q', s('a', 600), { root: dir }), runEgoScript('sess-q', s('b', 10), { root: dir })]);
    expect(fs.readFileSync(mark, 'utf8').trim()).toBe('a<>a b<>b');
  }, 30_000);

  it('long output keeps its start and end', () => {
    const s = 'A'.repeat(50) + 'M'.repeat(1000) + 'Z'.repeat(50);
    const c = clip(s, 100);
    expect(c.startsWith('A'.repeat(50))).toBe(true);
    expect(c.endsWith('Z'.repeat(50))).toBe(true);
    expect(c).toContain('1000');
  });

  it('knows the words of a dead connection', () => {
    expect(looksUnreachable('connect ECONNREFUSED 127.0.0.1:1')).toBe(true);
    expect(looksUnreachable('TypeError: x is not a function')).toBe(false);
  });
});
