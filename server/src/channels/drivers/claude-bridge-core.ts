// Claude subscription bridge — the pure half (after Magpie internal/claudebridge + claudecode, MIT). An Anthropic
// Messages request becomes one non-interactive run of the user's own `claude` CLI (`-p`, stream-json in and out),
// and the CLI's stream-json lines become an Anthropic Messages response again (SSE or one JSON body).
//
// The CLI runs on the user's own Claude login. It must never be pointed back at claude-web (gateway → bridge →
// CLI → gateway … is an endless loop that burns the subscription): the env is built from an allow-list, every
// ANTHROPIC_* / CLAUDE_WEB_* / CLAUDE_CODE_* the server has is dropped, the user's settings files are not loaded
// (`--setting-sources project` in an empty temp folder), `--settings` clears the routing keys once more, and
// `loopRisk` refuses outright when anything that still applies (managed settings, a proxy) points at our own ports.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BRIDGE_CATALOG_ID = 'claude-bridge';
/** Inbound header that marks a request as coming from a bridge-run CLI: answered 508, never served. */
export const LOOP_HEADER = 'x-claude-web-bridge';

/** What the error body / status of a refused or failed request is. */
export class BridgeError extends Error {
  constructor(readonly status: number, readonly type: string, message: string) { super(message); }
}

// ---------------------------------------------------------------------------------------------------------------
// env

const KEEP = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'TEMP', 'TMP', 'TMPDIR', 'USER',
  'USERNAME', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'SHELL', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
  'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'CLAUDE_CONFIG_DIR', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE',
  'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'ALL_PROXY',
]);
const PROXY_KEYS = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY'];
/** Keys that route the CLI somewhere or change who pays: never handed down. */
const FORBIDDEN = /^(ANTHROPIC_|CLAUDE_WEB_|CLAUDE_CODE_(?!DISABLE_)|OPENAI_|AWS_|GOOGLE_|VERTEX_|CLOUD_ML_)/i;

/** The extra env we set on purpose (quiet, no memory files, no auto-update). */
export const BRIDGE_ENV: Record<string, string> = {
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_AUTOUPDATER: '1',
};

/** The CLI's env: an allow-list of the server's, plus BRIDGE_ENV. Never an API key, base URL or claude-web value. */
export function bridgeEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (typeof v !== 'string') continue;
    if (!KEEP.has(k.toUpperCase())) continue;
    if (FORBIDDEN.test(k)) continue;
    out[k] = v;
  }
  return { ...out, ...BRIDGE_ENV };
}

const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0)$/i;

/** host:port of a loopback URL, or null. */
function loopbackPort(value: string): number | null {
  let u: URL;
  try { u = new URL(value.includes('://') ? value : `http://${value}`); } catch { return null; }
  if (!LOOPBACK.test(u.hostname)) return null;
  return Number(u.port || (u.protocol === 'https:' ? 443 : 80));
}

/** The managed settings files every Claude Code honours, whatever `--setting-sources` says. */
export function managedSettingsPaths(platform = process.platform): string[] {
  if (platform === 'win32') return [path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'ClaudeCode', 'managed-settings.json'), 'C:\\Program Files\\ClaudeCode\\managed-settings.json'];
  if (platform === 'darwin') return ['/Library/Application Support/ClaudeCode/managed-settings.json'];
  return ['/etc/claude-code/managed-settings.json'];
}

/**
 * Why running the CLI with this env would (or could) loop back into claude-web, or null. Checked before every run.
 * `ownPorts` = the ports claude-web listens on (main server, gateway, this bridge).
 */
export function loopRisk(env: Record<string, string>, ownPorts: number[], managed: string[] = managedSettingsPaths()): string | null {
  for (const k of Object.keys(env)) {
    if (FORBIDDEN.test(k)) return `env ${k} would reach the CLI`;
  }
  const own = new Set(ownPorts.filter((p) => p > 0));
  for (const k of Object.keys(env)) {
    if (!PROXY_KEYS.includes(k.toUpperCase())) continue;
    const port = loopbackPort(env[k]);
    if (port !== null && own.has(port)) return `${k} points at claude-web itself (port ${port})`;
  }
  for (const file of managed) {
    let j: any;
    try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    const base = j?.env?.ANTHROPIC_BASE_URL;
    if (typeof base === 'string' && base.trim() && loopbackPort(base) !== null) return `managed settings (${file}) send Claude Code to a local address (${base})`;
    if (typeof j?.apiKeyHelper === 'string' && j.apiKeyHelper.trim()) return `managed settings (${file}) set an apiKeyHelper`;
  }
  return null;
}

/** Clears the routing keys again inside the CLI's own settings layer. */
export const SETTINGS_OVERRIDE = JSON.stringify({ env: { ANTHROPIC_BASE_URL: '', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_API_KEY: '' } });

// ---------------------------------------------------------------------------------------------------------------
// request → CLI run

const MODEL = /^[A-Za-z0-9._:\[\]\/-]{1,120}$/;

export interface CliTurn {
  model: string;
  system: string;
  /** the one stream-json line written to the CLI's stdin */
  input: string;
  stream: boolean;
}

export function cliArgs(turn: Pick<CliTurn, 'model'>, files: { systemFile: string; mcpFile: string; settingsFile: string }): string[] {
  return [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model', turn.model,
    '--system-prompt-file', files.systemFile,
    '--tools', '',
    '--strict-mcp-config', '--mcp-config', files.mcpFile,
    '--setting-sources', 'project',
    '--settings', files.settingsFile,
    '--disable-slash-commands',
    '--no-session-persistence',
    '--max-turns', '1',
  ];
}

const DEFAULT_SYSTEM = 'You are Claude, a helpful assistant.';

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b: any) => {
    if (!b || typeof b !== 'object') return '';
    switch (b.type) {
      case 'text': return String(b.text ?? '');
      case 'thinking': case 'redacted_thinking': return '';
      case 'image': return '[image]';
      case 'document': return '[document]';
      case 'tool_use': return `[tool call ${String(b.name ?? '')}: ${JSON.stringify(b.input ?? {})}]`;
      case 'tool_result': return `[tool result: ${textOf(b.content)}]`;
      default: return '';
    }
  }).filter(Boolean).join('\n');
}

function systemText(system: unknown): string {
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) return system.map((b: any) => (b && b.type === 'text' ? String(b.text ?? '') : '')).filter(Boolean).join('\n\n');
  return '';
}

/** The last user message's blocks the CLI takes as they are (text, images, PDFs); anything else as text. */
function lastBlocks(content: unknown): any[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  const out: any[] = [];
  for (const b of content) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'text') out.push({ type: 'text', text: String(b.text ?? '') });
    else if ((b.type === 'image' || b.type === 'document') && b.source && typeof b.source === 'object') out.push({ type: b.type, source: b.source });
    else {
      const t = textOf([b]);
      if (t) out.push({ type: 'text', text: t });
    }
  }
  return out;
}

/** Validate an Anthropic Messages body and turn it into one CLI run. Throws BridgeError(400) for what it cannot do. */
export function toCliTurn(body: unknown): CliTurn {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BridgeError(400, 'invalid_request_error', 'body must be a JSON object');
  const b = body as Record<string, any>;
  if (typeof b.model !== 'string' || !MODEL.test(b.model)) throw new BridgeError(400, 'invalid_request_error', 'model is missing or not a valid model id');
  if (!Array.isArray(b.messages) || !b.messages.length) throw new BridgeError(400, 'invalid_request_error', 'messages must be a non-empty array');
  const wantsTools = Array.isArray(b.tools) && b.tools.length > 0 && b.tool_choice?.type !== 'none';
  if (wantsTools) throw new BridgeError(400, 'invalid_request_error', 'the Claude subscription bridge serves plain chat only: tool use is not supported (send no tools, or route this request to another source)');
  const msgs = b.messages as any[];
  for (const m of msgs) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) throw new BridgeError(400, 'invalid_request_error', 'every message needs role user or assistant');
  }
  const last = msgs[msgs.length - 1];
  if (last.role !== 'user') throw new BridgeError(400, 'invalid_request_error', 'the last message must be from the user (assistant prefill is not supported by the bridge)');
  const blocks = lastBlocks(last.content);
  if (!blocks.length) throw new BridgeError(400, 'invalid_request_error', 'the last user message is empty');
  const history = msgs.slice(0, -1).map((m) => `[${m.role}]\n${textOf(m.content)}`).filter((s) => s.trim());
  const content = history.length
    ? [{ type: 'text', text: `<conversation_history>\n${history.join('\n\n')}\n</conversation_history>\n\nContinue the conversation. The user's new message follows.` }, ...blocks]
    : blocks;
  const input = JSON.stringify({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: '' });
  return { model: b.model, system: systemText(b.system).trim() || DEFAULT_SYSTEM, input, stream: b.stream === true };
}

/** A temp folder with nothing in it (no .claude/, no CLAUDE.md) for the CLI to run in, and the system prompt file. */
export function makeWorkDir(root: string, system: string): { dir: string; systemFile: string; mcpFile: string; settingsFile: string } {
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'run-'));
  const systemFile = path.join(dir, 'system.txt');
  fs.writeFileSync(systemFile, system, { mode: 0o600 });
  // JSON goes in files, not on the command line: on Windows `claude` is a .cmd shim run through cmd.exe, which mangles the quotes
  const mcpFile = path.join(dir, 'mcp.json');
  fs.writeFileSync(mcpFile, '{"mcpServers":{}}', { mode: 0o600 });
  const settingsFile = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsFile, SETTINGS_OVERRIDE, { mode: 0o600 });
  return { dir, systemFile, mcpFile, settingsFile };
}

export const defaultWorkRoot = () => path.join(os.tmpdir(), 'claude-web-bridge');

// ---------------------------------------------------------------------------------------------------------------
// CLI output → Anthropic message

export interface AnthropicMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: any[];
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: Record<string, number>;
}

/**
 * Folds the CLI's stream-json lines into one message. Only the first API message of the run counts (max-turns 1
 * already keeps it to one). `onEvent` gets each raw Anthropic stream event of that message, for SSE pass-through.
 */
export class CliOutput {
  message: AnthropicMessage | null = null;
  /** saw `stream_event` lines (else the message is rebuilt from `assistant` lines) */
  streamed = false;
  done = false;
  error: { status: number; type: string; message: string } | null = null;
  private finished = false;
  private fallback: any[] = [];
  private fallbackUsage: Record<string, number> | null = null;

  constructor(private model: string, private onEvent?: (event: any) => void) {}

  line(raw: string): void {
    const s = raw.trim();
    if (!s || s[0] !== '{') return;
    let j: any;
    try { j = JSON.parse(s); } catch { return; }
    if (j.type === 'stream_event' && j.event && typeof j.event === 'object') this.event(j.event);
    else if (j.type === 'assistant' && j.message && Array.isArray(j.message.content)) {
      for (const b of j.message.content) if (b && (b.type === 'text' || b.type === 'thinking')) this.fallback.push(b);
      if (j.message.usage) this.fallbackUsage = j.message.usage;
    } else if (j.type === 'result') {
      this.done = true;
      if (j.is_error || (j.subtype && j.subtype !== 'success')) this.error = classify(String(j.result || j.error || j.subtype || 'claude CLI failed'));
      if (j.usage && typeof j.usage === 'object') this.fallbackUsage = { ...(this.fallbackUsage ?? {}), ...usageKeys(j.usage) };
    }
  }

  private event(ev: any): void {
    if (this.finished) return;
    this.streamed = true;
    switch (ev.type) {
      case 'message_start':
        if (this.message) return;
        this.message = { id: ev.message?.id || `msg_bridge_${Date.now().toString(36)}`, type: 'message', role: 'assistant', model: ev.message?.model || this.model, content: [], stop_reason: null, stop_sequence: null, usage: pickUsage(ev.message?.usage) };
        break;
      case 'content_block_start':
        if (!this.message) return;
        this.message.content[ev.index ?? this.message.content.length] = JSON.parse(JSON.stringify(ev.content_block ?? { type: 'text', text: '' }));
        break;
      case 'content_block_delta': {
        const block = this.message?.content[ev.index ?? 0];
        const d = ev.delta ?? {};
        if (!block) return;
        if (d.type === 'text_delta') block.text = (block.text ?? '') + (d.text ?? '');
        else if (d.type === 'thinking_delta') block.thinking = (block.thinking ?? '') + (d.thinking ?? '');
        else if (d.type === 'signature_delta') block.signature = (block.signature ?? '') + (d.signature ?? '');
        else if (d.type === 'input_json_delta') block._json = (block._json ?? '') + (d.partial_json ?? '');
        break;
      }
      case 'content_block_stop': {
        const block = this.message?.content[ev.index ?? 0];
        if (block && typeof block._json === 'string') { try { block.input = JSON.parse(block._json || '{}'); } catch { /* keep as is */ } delete block._json; }
        break;
      }
      case 'message_delta':
        if (!this.message) return;
        if (ev.delta?.stop_reason !== undefined) this.message.stop_reason = ev.delta.stop_reason;
        if (ev.delta?.stop_sequence !== undefined) this.message.stop_sequence = ev.delta.stop_sequence;
        if (ev.usage) this.message.usage = { ...this.message.usage, ...usageKeys(ev.usage) };
        break;
      case 'message_stop':
        if (!this.message) return;
        this.finished = true;
        break;
      default:
        if (!this.message) return;
    }
    this.onEvent?.(ev);
  }

  /** The final message: the streamed one, or one rebuilt from the `assistant` lines of an older CLI. */
  result(): AnthropicMessage | null {
    if (this.message) return { ...this.message, content: this.message.content.filter(Boolean) };
    if (!this.fallback.length) return null;
    return { id: `msg_bridge_${Date.now().toString(36)}`, type: 'message', role: 'assistant', model: this.model, content: this.fallback, stop_reason: 'end_turn', stop_sequence: null, usage: pickUsage(this.fallbackUsage) };
  }
}

/** Only the usage counters that are present. */
function usageKeys(u: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (!u || typeof u !== 'object') return out;
  for (const k of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) if (typeof u[k] === 'number') out[k] = u[k];
  return out;
}

function pickUsage(u: any): Record<string, number> {
  return { input_tokens: 0, output_tokens: 0, ...usageKeys(u) };
}

/** The CLI's error text → an Anthropic error status / type. */
export function classify(message: string): { status: number; type: string; message: string } {
  const m = message.slice(0, 2000);
  if (/log ?in|\/login|invalid api key|oauth|unauthori[sz]ed|authenticat/i.test(m)) return { status: 401, type: 'authentication_error', message: m };
  if (/rate.?limit|usage limit|limit reached|429|too many/i.test(m)) return { status: 429, type: 'rate_limit_error', message: m };
  if (/overloaded|529/i.test(m)) return { status: 529, type: 'overloaded_error', message: m };
  return { status: 502, type: 'api_error', message: m };
}

/** The full SSE sequence of a finished message (for a CLI that sent no stream events). */
export function synthesizeEvents(msg: AnthropicMessage): any[] {
  const out: any[] = [{ type: 'message_start', message: { ...msg, content: [], stop_reason: null, usage: { ...msg.usage, output_tokens: 0 } } }];
  msg.content.forEach((b, index) => {
    if (b.type === 'thinking') {
      out.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '' } });
      out.push({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: b.thinking ?? '' } });
      if (b.signature) out.push({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: b.signature } });
    } else {
      out.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      out.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text ?? '' } });
    }
    out.push({ type: 'content_block_stop', index });
  });
  out.push({ type: 'message_delta', delta: { stop_reason: msg.stop_reason ?? 'end_turn', stop_sequence: null }, usage: { output_tokens: msg.usage.output_tokens ?? 0 } });
  out.push({ type: 'message_stop' });
  return out;
}

export const sse = (ev: any): string => `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;
