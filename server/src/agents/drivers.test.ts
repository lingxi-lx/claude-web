import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcpDriver } from './acp-driver.js';
import { CodexDriver } from './codex-driver.js';
import { AgentTranscripts } from './transcript.js';
import { configureWebMcp } from '../web/launcher.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let tmp: string;
let transcripts: AgentTranscripts;
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-agents-'));
  process.env.CLAUDE_WEB_DIR = tmp;
  transcripts = new AgentTranscripts();
});
afterAll(async () => { await new Promise((r) => setTimeout(r, 300)); await fs.rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });

const collect = (d: any) => {
  const msgs: any[] = [];
  d.on('message', (m: any) => msgs.push(m));
  return msgs;
};
const waitFor = (fn: () => boolean, ms = 8000) => new Promise<void>((res, rej) => { const t0 = Date.now(); const i = setInterval(() => { if (fn()) { clearInterval(i); res(); } else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error('timeout')); } }, 20); });

describe('AcpDriver (mock agent)', () => {
  it('streams text/thinking, runs a tool through a permission request, ends the turn with a result', async () => {
    const d = new AcpDriver('gemini', { command: process.execPath, args: [path.join(here, '__mocks__', 'acp-agent.mjs')], env: {}, name: 'Mock ACP' }, { cwd: tmp }, transcripts, null);
    const msgs = collect(d);
    await waitFor(() => d.state === 'idle');
    expect(msgs.find((m) => m.type === 'system' && m.subtype === 'init')).toBeTruthy();
    expect(d.info.slashCommands?.[0]?.name).toBe('help');
    let perm: any;
    d.on('permission', (e) => { perm = e; });
    const sent: any[] = [];
    d.on('sent', (m: any) => sent.push(m));
    d.send('please use a tool', undefined, false, 'u-acp');
    // what was asked, for the windows that did not send it
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'user', uuid: 'u-acp' });
    expect(JSON.stringify(sent[0].message.content)).toContain('please use a tool');
    await waitFor(() => !!perm);
    expect(perm.toolName).toBe('Read');
    expect(perm.input.file_path).toBe('C:/x/package.json');
    expect(d.state).toBe('waiting');
    d.respondPermission(perm.requestId, { behavior: 'allow' });
    await waitFor(() => msgs.some((m) => m.type === 'result'));
    const result = msgs.find((m) => m.type === 'result');
    expect(result.is_error).toBe(false);
    const texts = msgs.filter((m) => m.type === 'stream_event' && m.event.type === 'content_block_delta' && m.event.delta.type === 'text_delta').map((m) => m.event.delta.text).join('');
    expect(texts).toContain('Echo: please use a tool');
    expect(texts).toContain('(read ok)');
    const thinking = msgs.filter((m) => m.type === 'stream_event' && m.event.delta?.type === 'thinking_delta');
    expect(thinking.length).toBe(1);
    const toolUse = msgs.find((m) => m.type === 'assistant' && m.message.content[0]?.type === 'tool_use');
    expect(toolUse.message.content[0].name).toBe('Read');
    const toolResult = msgs.find((m) => m.type === 'user' && m.message.content[0]?.type === 'tool_result');
    expect(toolResult.message.content[0].content[0].text).toBe('{"name":"x"}');
    const final = msgs.filter((m) => m.type === 'assistant').pop();
    expect(final.message.content.some((c: any) => c.type === 'text' && c.text.includes('Echo:'))).toBe(true);
    expect(d.state).toBe('idle');
    // transcript persisted with a head
    const head = await transcripts.head(d.sessionId);
    expect(head?.agent).toBe('gemini');
    expect(head?.nativeSessionId).toBe('acp-sess-1');
    const loaded = await transcripts.load(d.sessionId);
    expect(loaded.some((m) => m.type === 'result')).toBe(true);
    await d.close();
    expect(d.state).toBe('closed');
  });

  it('resumes through session/resume when the agent advertises it instead of loadSession (DeepSeek Harness)', async () => {
    const id = 'dsh-resume-1';
    await transcripts.create({ sessionId: id, agent: 'dsh', cwd: tmp, title: '', createdAt: Date.now(), nativeSessionId: 'acp-old' });
    const d = new AcpDriver('dsh', { command: process.execPath, args: [path.join(here, '__mocks__', 'acp-agent.mjs')], env: { MOCK_ACP_RESUME: '1' }, name: 'Mock DSH' }, { sessionId: id, cwd: tmp }, transcripts, null);
    const msgs = collect(d);
    await waitFor(() => d.state === 'idle');
    // the mock only answers this way after a session/resume (session/new would be acp-sess-1)
    await waitFor(() => msgs.some((m) => JSON.stringify(m).includes('resumed acp-old')));
    expect((await transcripts.head(id))?.nativeSessionId).toBe('acp-old');
    await d.close();
  });

  it('plan updates become TodoWrite; denied permission marks the tool result as error', async () => {
    const d = new AcpDriver('qwen', { command: process.execPath, args: [path.join(here, '__mocks__', 'acp-agent.mjs')], env: {}, name: 'Mock' }, { cwd: tmp }, transcripts, null);
    const msgs = collect(d);
    await waitFor(() => d.state === 'idle');
    let perm: any;
    d.on('permission', (e) => { perm = e; });
    d.send('tool and plan');
    await waitFor(() => !!perm);
    d.respondPermission(perm.requestId, { behavior: 'deny', message: 'no' });
    await waitFor(() => msgs.some((m) => m.type === 'result'));
    expect(msgs.some((m) => m.type === 'assistant' && m.message.content[0]?.name === 'TodoWrite')).toBe(true);
    const tr = msgs.find((m) => m.type === 'user' && m.message.content[0]?.tool_use_id === 'call-1');
    expect(tr.message.content[0].is_error).toBe(true);
    await d.close();
  });

  it('hands the shared memory store to the agent, and starts anyway if it is refused', async () => {
    const mock = path.join(here, '__mocks__', 'acp-agent.mjs');
    const textOf = (msgs: any[]) => msgs.filter((m) => m.type === 'stream_event' && m.event.delta?.type === 'text_delta').map((m) => m.event.delta.text).join('');

    const d = new AcpDriver('gemini', { command: process.execPath, args: [mock], env: {}, name: 'Mock ACP' }, { cwd: tmp }, transcripts, null);
    const msgs = collect(d);
    await waitFor(() => d.state === 'idle');
    d.send('what mcp servers do you have');
    await waitFor(() => msgs.some((m) => m.type === 'result'));
    expect(textOf(msgs)).toContain('[mcp: claude-web-memory]');
    await d.close();

    // an agent that rejects inline MCP servers must still get a usable session
    const d2 = new AcpDriver('qwen', { command: process.execPath, args: [mock], env: { MOCK_REJECT_MCP: '1' }, name: 'Picky' }, { cwd: tmp }, transcripts, null);
    const msgs2 = collect(d2);
    await waitFor(() => d2.state === 'idle');
    expect(msgs2.some((m) => m.type === 'system' && String(m.note ?? '').includes('共享记忆'))).toBe(true);
    d2.send('mcp?');
    await waitFor(() => msgs2.some((m) => m.type === 'result'));
    expect(textOf(msgs2)).toContain('[mcp: none]');
    await d2.close();
  });

  it('hands 联网 (the `web` server) over next to the memory store once the server is listening; a refusal names both', async () => {
    const mock = path.join(here, '__mocks__', 'acp-agent.mjs');
    const textOf = (msgs: any[]) => msgs.filter((m) => m.type === 'stream_event' && m.event.delta?.type === 'text_delta').map((m) => m.event.delta.text).join('');
    configureWebMcp({ url: 'http://127.0.0.1:45678', token: 'y'.repeat(64) }, path.join(tmp, 'web-mcp'));
    try {
      const d = new AcpDriver('gemini', { command: process.execPath, args: [mock], env: {}, name: 'Mock ACP' }, { cwd: tmp }, transcripts, null);
      const msgs = collect(d);
      await waitFor(() => d.state === 'idle');
      d.send('what mcp servers do you have');
      await waitFor(() => msgs.some((m) => m.type === 'result'));
      expect(textOf(msgs)).toContain('[mcp: claude-web-memory,web]');
      await d.close();

      const d2 = new AcpDriver('qwen', { command: process.execPath, args: [mock], env: { MOCK_REJECT_MCP: '1' }, name: 'Picky' }, { cwd: tmp }, transcripts, null);
      const msgs2 = collect(d2);
      await waitFor(() => d2.state === 'idle');
      expect(msgs2.some((m) => m.type === 'system' && String(m.note ?? '').includes('共享记忆 / 联网 MCP'))).toBe(true);
      await d2.close();
    } finally {
      configureWebMcp(null, path.join(tmp, 'web-mcp'));
    }
  });

  it('reports a launch failure as error state', async () => {
    const d = new AcpDriver('kimi', { command: 'definitely-not-a-real-binary-xyz', args: [], env: {}, name: 'Nope' }, { cwd: tmp }, transcripts, null);
    await waitFor(() => d.state === 'error');
    expect(d.info.error).toContain('Nope');
  });
});

describe('CodexDriver (mock app-server)', () => {
  it('starts a thread, streams deltas, routes command approval, records usage', async () => {
    const d = new CodexDriver('codex', { command: process.execPath, args: [path.join(here, '__mocks__', 'codex-server.mjs')], env: {}, name: 'Mock Codex' }, { cwd: tmp, permissionMode: 'default' }, transcripts);
    const msgs = collect(d);
    await waitFor(() => d.state === 'idle');
    expect(d.info.model).toBe('gpt-5-codex');
    expect(d.info.models?.[0]?.value).toBe('gpt-5-codex');
    let perm: any;
    d.on('permission', (e) => { perm = e; });
    const sent: any[] = [];
    d.on('sent', (m: any) => sent.push(m));
    d.send('run it', undefined, false, 'u-codex');
    expect(sent.map((m) => m.uuid)).toEqual(['u-codex']);
    await waitFor(() => !!perm);
    expect(perm.toolName).toBe('Bash');
    expect(perm.input.command).toBe('echo hi');
    d.respondPermission(perm.requestId, { behavior: 'allow' });
    await waitFor(() => msgs.some((m) => m.type === 'result'));
    const result = msgs.find((m) => m.type === 'result');
    // the whole turn (two model calls, one update re-sent), with the cached part taken out of input
    expect(result.usage).toMatchObject({ input_tokens: 25, cache_read_input_tokens: 23, cache_creation_input_tokens: 2, output_tokens: 14 });
    // Codex reports no price: unknown, never shown as $0
    expect(result).toMatchObject({ total_cost_usd: 0, cost_unknown: true });
    const tr = msgs.find((m) => m.type === 'user' && m.message.content[0]?.tool_use_id === 'cmd-1');
    expect(tr.tool_use_result.stdout).toBe('hi\n');
    expect(tr.message.content[0].is_error).toBe(false);
    const final = msgs.filter((m) => m.type === 'assistant').pop();
    expect(final.message.content.find((c: any) => c.type === 'text').text).toBe('Codex says: run it');
    expect((await transcripts.head(d.sessionId))?.nativeSessionId).toBe('thr-1');
    await d.close();
  });

  it('a project’s extra folders become writable roots of the workspace-write sandbox (stage C2); not in a read-only one', async () => {
    const log = path.join(tmp, 'rpc-extra.log');
    // an empty CODEX_HOME: the machine's own ~/.codex/config.toml must not leak into the expectation
    const codexHome = path.join(tmp, 'codex-home-empty');
    await fs.mkdir(codexHome, { recursive: true });
    const start = async (permissionMode: 'default' | 'plan') => {
      await fs.rm(log, { force: true });
      const d = new CodexDriver('codex', { command: process.execPath, args: [path.join(here, '__mocks__', 'codex-server.mjs')], env: { CW_MOCK_RPC_LOG: log, CODEX_HOME: codexHome }, name: 'Mock' }, { cwd: tmp, permissionMode }, transcripts, { extraDirs: ['D:\\lib'] });
      await waitFor(() => d.state === 'idle');
      await d.close();
      const lines = (await fs.readFile(log, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
      return lines.find((l) => l.method === 'thread/start').params;
    };
    expect((await start('default')).config).toEqual({ 'sandbox_workspace_write.writable_roots': ['D:\\lib'] });
    expect((await start('plan')).config).toBeUndefined();
  });

  it('the user’s own writable_roots (CODEX_HOME/config.toml) are kept: the override is the union, deduped (C-S1); thread/resume carries it too', async () => {
    const log = path.join(tmp, 'rpc-union.log');
    const codexHome = path.join(tmp, 'codex-home-user');
    await fs.mkdir(codexHome, { recursive: true });
    const mine = process.platform === 'win32' ? 'C:\\Mine' : '/mine';
    const lib = process.platform === 'win32' ? 'D:\\Lib' : '/lib';
    const libAgain = process.platform === 'win32' ? 'd:\\lib\\' : '/lib/';
    await fs.writeFile(path.join(codexHome, 'config.toml'), `model = "gpt-5"\n[sandbox_workspace_write]\nwritable_roots = [${JSON.stringify(mine)}, ${JSON.stringify(lib)}]\n`);
    const env = { CW_MOCK_RPC_LOG: log, CODEX_HOME: codexHome };
    const args = [path.join(here, '__mocks__', 'codex-server.mjs')];
    const d = new CodexDriver('codex', { command: process.execPath, args, env, name: 'Mock' }, { cwd: tmp, permissionMode: 'default' }, transcripts, { extraDirs: [libAgain, 'E:\\extra'] });
    await waitFor(() => d.state === 'idle');
    const sid = d.sessionId;
    await d.close();
    const lines = () => fs.readFile(log, 'utf8').then((t) => t.trim().split('\n').map((l) => JSON.parse(l)));
    const want = { 'sandbox_workspace_write.writable_roots': [mine, lib, 'E:\\extra'] };
    expect((await lines()).find((l) => l.method === 'thread/start').params.config).toEqual(want);
    const r = new CodexDriver('codex', { command: process.execPath, args, env, name: 'Mock' }, { cwd: tmp, permissionMode: 'default', sessionId: sid }, transcripts, { extraDirs: [libAgain, 'E:\\extra'] });
    await waitFor(() => r.state === 'idle');
    await r.close();
    expect((await lines()).find((l) => l.method === 'thread/resume').params.config).toEqual(want);
  });

  it('acceptEdits auto-approves file changes but still asks for commands; bypass approves everything', async () => {
    const d = new CodexDriver('codex', { command: process.execPath, args: [path.join(here, '__mocks__', 'codex-server.mjs')], env: {}, name: 'Mock' }, { cwd: tmp, permissionMode: 'bypassPermissions' }, transcripts);
    const msgs = collect(d);
    await waitFor(() => d.state === 'idle');
    let asked = false;
    d.on('permission', () => { asked = true; });
    d.send('run again');
    await waitFor(() => msgs.some((m) => m.type === 'result'));
    expect(asked).toBe(false);
    const tr = msgs.find((m) => m.type === 'user' && m.message.content[0]?.tool_use_id === 'cmd-1');
    expect(tr.tool_use_result.stdout).toBe('hi\n');
    await d.close();
  });

  it('usage is per turn: a second turn and a resumed thread report their own turn, not the running total', async () => {
    const args = [path.join(here, '__mocks__', 'codex-server.mjs')];
    const d = new CodexDriver('codex', { command: process.execPath, args, env: {}, name: 'Mock' }, { cwd: tmp, permissionMode: 'bypassPermissions' }, transcripts);
    const msgs = collect(d);
    await waitFor(() => d.state === 'idle');
    const results = () => msgs.filter((m) => m.type === 'result');
    d.send('one');
    await waitFor(() => results().length === 1);
    d.send('two');
    await waitFor(() => results().length === 2);
    const want = { input_tokens: 25, cache_read_input_tokens: 23, cache_creation_input_tokens: 2, output_tokens: 14 };
    expect(results()[0].usage).toMatchObject(want);
    expect(results()[1].usage).toMatchObject(want);
    const sid = d.sessionId;
    await d.close();
    const r = new CodexDriver('codex', { command: process.execPath, args, env: {}, name: 'Mock' }, { cwd: tmp, permissionMode: 'bypassPermissions', sessionId: sid }, transcripts);
    const msgs2 = collect(r);
    await waitFor(() => r.state === 'idle');
    r.send('three');
    await waitFor(() => msgs2.some((m) => m.type === 'result'));
    expect(msgs2.find((m) => m.type === 'result').usage).toMatchObject(want);
    await r.close();
  });

  it('resuming: the turns the Codex CLI added come into the mirror first, the next prompt lands after them', async () => {
    const args = [path.join(here, '__mocks__', 'codex-server.mjs')];
    const d = new CodexDriver('codex', { command: process.execPath, args, env: {}, name: 'Mock' }, { cwd: tmp, permissionMode: 'bypassPermissions' }, transcripts);
    const msgs = collect(d);
    await waitFor(() => d.state === 'idle');
    d.send('web one');
    await waitFor(() => msgs.some((m) => m.type === 'result'));
    const sid = d.sessionId;
    await d.close();
    // the library's sync: slow, and appends the CLI's turn to the mirror
    let hookRan = false;
    const beforeResume = async () => {
      await new Promise((r) => setTimeout(r, 300));
      transcripts.append(sid, { type: 'user', uuid: 'cli-1', message: { role: 'user', content: [{ type: 'text', text: 'typed in the codex cli' }] } });
      hookRan = true;
    };
    const r = new CodexDriver('codex', { command: process.execPath, args, env: {}, name: 'Mock' }, { cwd: tmp, permissionMode: 'bypassPermissions', sessionId: sid }, transcripts, { beforeResume });
    r.send('web two'); // straight away, as the window does on reopen
    const msgs2 = collect(r);
    await waitFor(() => msgs2.some((m) => m.type === 'result'));
    expect(hookRan).toBe(true);
    const said = (await transcripts.load(sid)).filter((m) => m.type === 'user' && m.message.content[0]?.type === 'text').map((m) => m.message.content[0].text);
    expect(said).toEqual(['web one', 'typed in the codex cli', 'web two']);
    await r.close();
  });

  it('a model outside model/list is swapped for the default — except behind the model gateway', async () => {
    const args = [path.join(here, '__mocks__', 'codex-server.mjs')];
    const plain = new CodexDriver('codex', { command: process.execPath, args, env: {}, name: 'Mock' }, { cwd: tmp, permissionMode: 'default', model: 'claude-sonnet-4-5' }, transcripts);
    await waitFor(() => plain.state === 'idle');
    expect(plain.info.model).toBe('gpt-5-codex');
    await plain.close();
    const viaGw = new CodexDriver('codex', { command: process.execPath, args, env: { CW_GATEWAY_KEY: 'cwg-x' }, name: 'Mock' }, { cwd: tmp, permissionMode: 'default', model: 'claude-sonnet-4-5' }, transcripts);
    await waitFor(() => viaGw.state === 'idle');
    expect(viaGw.info.model).toBe('claude-sonnet-4-5');
    await viaGw.close();
  });
});
