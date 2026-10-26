import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { egoReset, egoStatus } from './ego.js';
import { SERVER_GATED_TOOLS, isServerGatedTool } from './launcher.js';
import { WEB_SEARCH_TOOL, configureWebMcp, setWebAgentBrowser, insertWebCodexConfig, setWebMcpEnabled, sweepWebTokens, webAcpMcpServers, webAllowedTools, webClaudeMcpServer, webCodexConfigArgs, webMcpEnabled, webMcpEntry } from './launcher.js';

let dir: string;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-webmcp-')); });
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });
afterEach(() => { configureWebMcp(null, dir); setWebMcpEnabled(true); });

const target = { sessionId: 'sess-1' };
const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const SECRET = 'a'.repeat(64);

describe('server-gated tools: one card, the server\'s', () => {
  it('ego_browser by any name an agent gives it — not its guide, not another tool', () => {
    expect(SERVER_GATED_TOOLS).toEqual(['mcp__web__ego_browser']);
    for (const n of ['mcp__web__ego_browser', 'ego_browser', 'ego_browser (web MCP Server)', 'web: ego_browser']) expect(isServerGatedTool(n), n).toBe(true);
    for (const n of ['mcp__web__ego_browser_guide', 'ego_browser_guide (web MCP Server)', 'Read package.json', 'my_ego_browser', 'mcp__web__browser_eval']) expect(isServerGatedTool(n), n).toBe(false);
    expect(isServerGatedTool(undefined, 'Read', { script: 'ego_browser' })).toBe(false);
    expect(isServerGatedTool(undefined, 'ego_browser (web)')).toBe(true);
  });
});

describe('web MCP launcher', () => {
  it('hands out nothing before the server is listening, and nothing while the switch is off', () => {
    expect(webClaudeMcpServer(target)).toEqual({});
    expect(webAcpMcpServers(target)).toEqual([]);
    expect(webCodexConfigArgs(target)).toEqual([]);
    expect(insertWebCodexConfig(['app-server'], target)).toEqual(['app-server']);
    expect(webAllowedTools()).toEqual([]);
    configureWebMcp({ url: 'http://127.0.0.1:3090', token: SECRET }, dir);
    expect(Object.keys(webClaudeMcpServer(target))).toEqual(['web']);
    setWebMcpEnabled(false);
    expect(webMcpEnabled()).toBe(false);
    expect(webClaudeMcpServer(target)).toEqual({});
    expect(webAcpMcpServers(target)).toEqual([]);
    expect(webCodexConfigArgs(target)).toEqual([]);
    expect(webAllowedTools()).toEqual([]);
  });

  it('gives Claude a stdio server that knows where this server is and which conversation it serves', () => {
    configureWebMcp({ url: 'http://127.0.0.1:51234', token: SECRET }, dir);
    const s = webClaudeMcpServer(target, NODE).web;
    expect(s.type).toBe('stdio');
    expect(s.command).toBe(NODE);
    expect(s.args[s.args.length - 1]).toBe(webMcpEntry());
    expect(path.basename(webMcpEntry())).toMatch(/^mcp\.(js|ts)$/);
    const tokenFile = path.join(dir, `${process.pid}.token`);
    expect(s.env).toEqual({ ELECTRON_RUN_AS_NODE: '1', CW_WEB_URL: 'http://127.0.0.1:51234', CW_WEB_TOKEN_FILE: tokenFile, CW_SESSION_ID: 'sess-1' });
    // the SDK puts this object on the CLI's command line: the secret must not be in it
    expect(JSON.stringify(s)).not.toContain(SECRET);
    expect(fs.readFileSync(tokenFile, 'utf8')).toBe(SECRET);
    // searching is the one tool pre-allowed
    expect(webAllowedTools()).toEqual(['mcp__web__web_search', 'mcp__web__ego_browser_guide', 'mcp__web__ego_browser', 'mcp__web__character_guide', 'mcp__web__character_draft', 'mcp__web__character_save', 'mcp__web__character_list', 'mcp__web__theme_guide', 'mcp__web__theme_draft', 'mcp__web__theme_get', 'mcp__web__theme_save', 'mcp__web__theme_list']);
    expect(WEB_SEARCH_TOOL).toBe('mcp__web__web_search');
    // a conversation whose id is not known yet still gets the server
    expect(webClaudeMcpServer({}, NODE).web.env.CW_SESSION_ID).toBe('');
  });

  it('gives ACP the same server with env as name/value pairs', () => {
    configureWebMcp({ url: 'http://127.0.0.1:51234', token: SECRET }, dir);
    const [s] = webAcpMcpServers(target, NODE);
    expect(s.name).toBe('web');
    expect(s.command).toBe(NODE);
    expect(s.env).toContainEqual({ name: 'CW_WEB_URL', value: 'http://127.0.0.1:51234' });
    expect(s.env).toContainEqual({ name: 'CW_SESSION_ID', value: 'sess-1' });
    expect(s.env).toContainEqual({ name: 'ELECTRON_RUN_AS_NODE', value: '1' });
    expect(s.env.every((e) => typeof e.name === 'string' && typeof e.value === 'string')).toBe(true);
  });

  it('gives Codex -c overrides that parse as TOML (Windows paths, spaces), in front of app-server, without the secret', () => {
    configureWebMcp({ url: 'http://127.0.0.1:51234', token: SECRET }, dir);
    const a = webCodexConfigArgs(target, NODE);
    expect(a.filter((x) => x === '-c')).toHaveLength(3);
    const doc = parseToml(a.filter((x) => x !== '-c').join('\n')) as any;
    expect(doc.mcp_servers.web.command).toBe(NODE);
    expect(doc.mcp_servers.web.args[doc.mcp_servers.web.args.length - 1]).toBe(webMcpEntry());
    expect(doc.mcp_servers.web.env).toEqual({ ELECTRON_RUN_AS_NODE: '1', CW_WEB_URL: 'http://127.0.0.1:51234', CW_WEB_TOKEN_FILE: path.join(dir, `${process.pid}.token`), CW_SESSION_ID: 'sess-1' });
    expect(a.join(' ')).not.toContain(SECRET);
    const spliced = insertWebCodexConfig(['-c', 'model="gpt-5"', 'app-server'], target, NODE);
    expect(spliced.slice(0, 2)).toEqual(['-c', 'model="gpt-5"']);
    expect(spliced[spliced.length - 1]).toBe('app-server');
    expect(spliced).toHaveLength(9);
    // a stand-in command with no subcommand is left exactly as configured
    expect(insertWebCodexConfig(['C:\\my-codex-shim.mjs'], target)).toEqual(['C:\\my-codex-shim.mjs']);
  });

  it('the secret file goes with the server, a restart replaces it, and files of servers that are gone are swept', () => {
    const mine = path.join(dir, `${process.pid}.token`);
    // a pid that cannot be a live process, and a file that is not one of ours
    const stale = path.join(dir, '999999999.token');
    const foreign = path.join(dir, 'notes.txt');
    fs.writeFileSync(stale, 'old');
    fs.writeFileSync(foreign, 'keep');
    configureWebMcp({ url: 'http://127.0.0.1:1', token: 'first' }, dir);
    expect(fs.readFileSync(mine, 'utf8')).toBe('first');
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(foreign)).toBe(true);
    configureWebMcp({ url: 'http://127.0.0.1:2', token: 'second' }, dir);
    expect(fs.readFileSync(mine, 'utf8')).toBe('second');
    expect(webClaudeMcpServer(target).web.env.CW_WEB_URL).toBe('http://127.0.0.1:2');
    configureWebMcp(null, dir);
    expect(fs.existsSync(mine)).toBe(false);
    expect(webClaudeMcpServer(target)).toEqual({});
    sweepWebTokens(path.join(dir, 'no-such-folder')); // nothing to sweep is not an error
    fs.rmSync(foreign);
  });

  it('when the secret file cannot be written the secret is passed inline, and a line says so', () => {
    const blocked = path.join(dir, 'a-file');
    fs.writeFileSync(blocked, 'x'); // a file where the folder should be: mkdir fails
    const warn = console.warn;
    const said: string[] = [];
    console.warn = (...a: unknown[]) => { said.push(a.join(' ')); };
    try { configureWebMcp({ url: 'http://127.0.0.1:3', token: SECRET }, blocked); } finally { console.warn = warn; }
    expect(said.join('\n')).toContain('[web]');
    expect(said.join('\n')).not.toContain(SECRET);
    const env = webClaudeMcpServer(target).web.env;
    expect(env.CW_WEB_TOKEN).toBe(SECRET);
    expect(env.CW_WEB_TOKEN_FILE).toBeUndefined();
    configureWebMcp(null, blocked);
    fs.rmSync(blocked);
  });

  it('ego lite: CW_WEB_BROWSER=ego only when its command was found and the setting is not the built-in browser', async () => {
    configureWebMcp({ url: 'http://127.0.0.1:3090', token: SECRET }, dir);
    const bin = path.join(dir, 'egobin');
    fs.mkdirSync(bin, { recursive: true });
    const fake = '#!/usr/bin/env node\nprocess.stdout.write("[ego-browser:skill] ego-browser v1.0.0\\n");\n';
    fs.writeFileSync(path.join(bin, 'ego-browser.js'), fake);
    if (process.platform === 'win32') fs.writeFileSync(path.join(bin, 'ego-browser.cmd'), '@ECHO off\r\nnode "%~dp0\\ego-browser.js" %*\r\n');
    else { fs.writeFileSync(path.join(bin, 'ego-browser'), fake); fs.chmodSync(path.join(bin, 'ego-browser'), 0o755); }
    const old = process.env.PATH;
    try {
      egoReset();
      process.env.PATH = path.join(dir, 'nothing-here');
      await egoStatus(false);
      expect(webClaudeMcpServer(target, NODE).web.env.CW_WEB_BROWSER).toBeUndefined();
      egoReset();
      process.env.PATH = `${bin}${path.delimiter}${old}`;
      await egoStatus(false);
      expect(webClaudeMcpServer(target, NODE).web.env.CW_WEB_BROWSER).toBe('ego');
      expect(webAcpMcpServers(target, NODE)[0].env).toContainEqual({ name: 'CW_WEB_BROWSER', value: 'ego' });
      setWebAgentBrowser('builtin');
      expect(webClaudeMcpServer(target, NODE).web.env.CW_WEB_BROWSER).toBeUndefined();
    } finally {
      process.env.PATH = old;
      setWebAgentBrowser('auto');
      egoReset();
    }
  });
});
