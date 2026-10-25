// 导入 claude.ai 数据 (stage F4): the export zip claude.ai mails you (Settings → Privacy → Export data) has
// `conversations.json`, `projects.json` and `users.json`. Parsed as the official export actually looks; a field missing
// skips that one item, never the whole file. Pure — the service stores, the library source shows.
import { tr } from '../i18n/index.js';

export interface ClaudeAiMessage { uuid: string; sender: 'human' | 'assistant'; text: string; content: any[]; createdAt: string; attachments: { name: string; text?: string }[]; files: string[] }
export interface ClaudeAiConversation { uuid: string; name: string; createdAt: string; updatedAt: string; projectUuid?: string; messages: ClaudeAiMessage[] }
export interface ClaudeAiProject { uuid: string; name: string; description: string; instructions: string; createdAt: string; updatedAt: string; starter: boolean; docs: { filename: string; content: string }[] }
export interface ClaudeAiExport { conversations: ClaudeAiConversation[]; projects: ClaudeAiProject[]; user?: { name: string; email: string }; skipped: number }

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

function fileByBase(files: Map<string, Buffer>, base: string): Buffer | undefined {
  let best: [string, Buffer] | undefined;
  for (const [name, buf] of files) {
    if (name.split('/').pop() !== base) continue;
    if (!best || name.length < best[0].length) best = [name, buf];
  }
  return best?.[1];
}

function json(buf: Buffer | undefined): unknown {
  if (!buf) return undefined;
  try { return JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, '')); } catch { return undefined; }
}

function message(m: any): ClaudeAiMessage | null {
  if (!m || typeof m !== 'object') return null;
  const sender = m.sender === 'human' || m.sender === 'assistant' ? m.sender : null;
  if (!sender) return null;
  return {
    uuid: str(m.uuid) || `${str(m.created_at)}-${sender}`,
    sender,
    text: str(m.text),
    content: arr(m.content).filter((b) => b && typeof b === 'object'),
    createdAt: str(m.created_at),
    attachments: arr(m.attachments).filter((a) => a && typeof a === 'object' && str(a.file_name)).map((a) => ({ name: str(a.file_name), ...(typeof a.extracted_content === 'string' ? { text: a.extracted_content } : {}) })),
    files: arr(m.files).map((f) => str(f?.file_name)).filter(Boolean),
  };
}

export function parseExport(files: Map<string, Buffer>): ClaudeAiExport {
  const convRaw = json(fileByBase(files, 'conversations.json'));
  const projRaw = json(fileByBase(files, 'projects.json'));
  const userRaw = json(fileByBase(files, 'users.json'));
  if (!Array.isArray(convRaw) && !Array.isArray(projRaw)) throw new Error(tr('这不是 claude.ai 的数据导出包（里面没有 conversations.json / projects.json）'));
  let skipped = 0;
  const conversations: ClaudeAiConversation[] = [];
  for (const c of arr(convRaw)) {
    try {
      if (!c || typeof c !== 'object' || !str(c.uuid) || !Array.isArray(c.chat_messages)) { skipped++; continue; }
      const created = str(c.created_at);
      const messages = c.chat_messages.map(message).filter((m: ClaudeAiMessage | null): m is ClaudeAiMessage => !!m);
      const projectUuid = str(c.project_uuid) || str(c.project?.uuid);
      conversations.push({ uuid: c.uuid, name: str(c.name).trim(), createdAt: created, updatedAt: str(c.updated_at, created), ...(projectUuid ? { projectUuid } : {}), messages });
    } catch { skipped++; }
  }
  const projects: ClaudeAiProject[] = [];
  for (const p of arr(projRaw)) {
    try {
      if (!p || typeof p !== 'object' || !str(p.uuid)) { skipped++; continue; }
      if (p.is_starter_project === true) continue; // Anthropic's example project, not the user's
      projects.push({
        uuid: p.uuid, name: str(p.name).trim() || p.uuid, description: str(p.description), instructions: str(p.prompt_template),
        createdAt: str(p.created_at), updatedAt: str(p.updated_at, str(p.created_at)), starter: false,
        docs: arr(p.docs).filter((d) => d && typeof d === 'object' && str(d.filename) && typeof d.content === 'string').map((d) => ({ filename: d.filename, content: d.content })),
      });
    } catch { skipped++; }
  }
  const u = arr(userRaw)[0];
  const user = u && typeof u === 'object' && (str(u.full_name) || str(u.email_address)) ? { name: str(u.full_name), email: str(u.email_address) } : undefined;
  return { conversations, projects, ...(user ? { user } : {}), skipped };
}

const LANG: Record<string, string> = {
  'text/html': 'html', 'text/markdown': 'markdown', 'image/svg+xml': 'svg', 'application/vnd.ant.react': 'jsx', 'application/vnd.ant.mermaid': 'mermaid',
};

function artifactText(input: any): string {
  const title = str(input?.title) || str(input?.id) || 'artifact';
  const lang = str(input?.language) || LANG[str(input?.type)] || '';
  const body = str(input?.content) || str(input?.new_str);
  if (!body) return `**${title}**`;
  return `**${title}**\n\n\`\`\`${lang}\n${body}\n\`\`\``;
}

const isArtifact = (b: any) => b?.name === 'artifacts' || (b?.input && typeof b.input === 'object' && typeof b.input.content === 'string' && typeof b.input.type === 'string' && 'command' in b.input);

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  return arr(content).map((c) => [str(c?.title), str(c?.url), str(c?.text)].filter(Boolean).join('\n')).filter(Boolean).join('\n\n');
}

/** The SDK-shaped rows the app renders (and `continueInClaude` replays). Stable ids: the same conversation reads the same. */
export function toSdkMessages(c: ClaudeAiConversation, sessionId: string): any[] {
  const out: any[] = [];
  const row = (type: 'user' | 'assistant', uuid: string, content: any[], timestamp: string) => out.push({ type, uuid, session_id: sessionId, ...(timestamp ? { timestamp } : {}), message: { role: type, content } });
  for (const m of c.messages) {
    if (m.sender === 'human') {
      const blocks: any[] = m.content.filter((b) => b.type === 'text' && typeof b.text === 'string' && b.text).map((b) => ({ type: 'text', text: b.text }));
      if (!blocks.length && m.text) blocks.push({ type: 'text', text: m.text });
      for (const a of m.attachments) blocks.push({ type: 'text', text: `${tr('［附件 {name}］', { name: a.name })}${a.text ? `\n${a.text}` : ''}` });
      for (const f of m.files) blocks.push({ type: 'text', text: tr('［文件 {name}（导出包里没有内容）］', { name: f }) });
      if (blocks.length) row('user', m.uuid, blocks, m.createdAt);
      continue;
    }
    let blocks: any[] = [];
    let seg = 0;
    let lastTool = '';
    const flush = () => { if (blocks.length) row('assistant', seg ? `${m.uuid}-a${seg}` : m.uuid, blocks, m.createdAt); blocks = []; seg++; };
    m.content.forEach((b, i) => {
      if (b.type === 'text' && typeof b.text === 'string') { if (b.text) blocks.push({ type: 'text', text: b.text }); }
      else if (b.type === 'thinking' && typeof b.thinking === 'string') blocks.push({ type: 'thinking', thinking: b.thinking });
      else if (b.type === 'tool_use') {
        if (isArtifact(b)) { blocks.push({ type: 'text', text: artifactText(b.input) }); lastTool = ''; return; }
        lastTool = `${m.uuid}-t${i}`;
        blocks.push({ type: 'tool_use', id: lastTool, name: str(b.name, 'tool'), input: b.input && typeof b.input === 'object' ? b.input : {} });
      } else if (b.type === 'tool_result') {
        if (!lastTool) return; // an artifact's "OK"
        flush();
        row('user', `${m.uuid}-r${i}`, [{ type: 'tool_result', tool_use_id: lastTool, content: resultText(b.content), is_error: b.is_error === true }], m.createdAt);
        lastTool = '';
      }
    });
    if (seg === 0 && !blocks.length && m.text) blocks.push({ type: 'text', text: m.text });
    flush();
  }
  return out;
}

export function planImport(convs: ClaudeAiConversation[], existing: Map<string, string>): { add: string[]; update: string[]; same: string[] } {
  const add: string[] = [], update: string[] = [], same: string[] = [];
  for (const c of convs) {
    const had = existing.get(c.uuid);
    if (had === undefined) add.push(c.uuid);
    else if (Date.parse(c.updatedAt) > Date.parse(had) || (Number.isNaN(Date.parse(had)) && had !== c.updatedAt)) update.push(c.uuid);
    else same.push(c.uuid);
  }
  return { add, update, same };
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function safeName(s: string, fallback: string): string {
  let n = s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '');
  if (!n || /^\.+$/.test(n)) return fallback;
  if (RESERVED.test(n)) n += '_';
  return n.slice(0, 120);
}
