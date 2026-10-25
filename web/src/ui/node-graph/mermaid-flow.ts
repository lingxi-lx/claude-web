import { tr } from '@/i18n';
import { NG_MAX_NODES, normalizeNodeGraph, type EdgeStyle, type NgEdgeIn, type NodeGraphData } from './schema';
// spec 2026-10-24 D4: a Mermaid flowchart drawn by the node graph. Only the common syntax; any line it does not know
// → ok:false and MermaidBlock keeps showing the original picture.

export type FlowResult = { ok: true; graph: NodeGraphData } | { ok: false; reason: string };
const HEADER = /^(?:flowchart|graph)\b(?:\s+(?:LR|RL|TD|TB|BT))?\s*$/i;
// only the keyword forms (`class A hot`, `style B fill:…`, a bare `end`): a node named class / style / click is a node
// (review D-minor) — what follows the keyword is not a link or an & group
const SKIP = /^(?:(?:classDef|class|style|linkStyle|click|direction|subgraph)\s+(?![-=.&<|])|acc(?:Title|Descr)\s*[:{]|end\s*$|subgraph\s*$)/;
const SHAPES: [string, ...string[]][] = [['([', '])'], ['[[', ']]'], ['[(', ')]'], ['((', '))'], ['{{', '}}'], ['[/', '/]', '\\]'], ['[\\', '\\]', '/]'], ['>', ']'], ['[', ']'], ['(', ')'], ['{', '}']];
const ID = /^[\p{L}\p{N}_]+/u;
const ARROW = /^<?(?:-{2,}>|-{3,}|={2,}>|={3,}|-\.+->|-\.+-|--[xo]|==[xo])/;
const MIDDLE = /^(--|==|-\.)\s+(.+?)\s+(-{2,}>|-{3,}|={2,}>|={3,}|\.+->|\.+-)/;
const clean = (t: string) => t.replace(/<br\s*\/?>/gi, ' ').replace(/^"(.*)"$/, '$1').replace(/\s+/g, ' ').trim();
const styleOf = (arrow: string): EdgeStyle => (arrow.includes('.') ? 'dashed' : arrow.includes('=') ? 'strong' : 'normal');

function statements(src: string): string[] {
  const out: string[] = [];
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    let cur = '', q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      if (ch === ';' && !q) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

export const isFlowchart = (src: string) => /^(?:flowchart|graph)\b/i.test(statements(src)[0] ?? '');

interface FNode { id: string; text?: string }
interface FLink { style: EdgeStyle; label?: string }

function nodeAt(s: string): { node: FNode; rest: string } | null {
  const m = ID.exec(s);
  if (!m) return null;
  const id = m[0];
  let rest = s.slice(id.length);
  for (const [open, ...closes] of SHAPES) {
    if (!rest.startsWith(open)) continue;
    let body = rest.slice(open.length), text: string;
    if (body.startsWith('"')) {
      const end = body.indexOf('"', 1);
      if (end < 0) return null;
      text = body.slice(1, end);
      body = body.slice(end + 1);
      const c = closes.find((x) => body.startsWith(x));
      if (!c) return null;
      rest = body.slice(c.length);
    } else {
      let at = -1, c = '';
      for (const x of closes) { const i = body.indexOf(x); if (i >= 0 && (at < 0 || i < at)) { at = i; c = x; } }
      if (at < 0) return null;
      text = body.slice(0, at);
      rest = body.slice(at + c.length);
    }
    return { node: { id, text: clean(text) }, rest: rest.replace(/^:::[\w-]+/, '') };
  }
  rest = rest.replace(/^:::[\w-]+/, '');
  if (rest && !/^(?:\s|&|[-=<.])/.test(rest)) return null;   // A@{…}, A!x …
  return { node: { id }, rest };
}

function linkAt(s: string): { link: FLink; rest: string } | null {
  const a = ARROW.exec(s);
  if (a) {
    let rest = s.slice(a[0].length), label: string | undefined;
    const p = /^\s*\|([^|]*)\|/.exec(rest);
    if (p) { label = clean(p[1]) || undefined; rest = rest.slice(p[0].length); }
    return { link: { style: styleOf(a[0]), label }, rest };
  }
  const m = MIDDLE.exec(s);
  return m ? { link: { style: styleOf(m[1] + m[3]), label: clean(m[2]) || undefined }, rest: s.slice(m[0].length) } : null;
}

function statement(s: string): { groups: FNode[][]; links: FLink[] } | null {
  let rest = s;
  const groups: FNode[][] = [], links: FLink[] = [];
  for (;;) {
    const g: FNode[] = [];
    for (;;) {
      const n = nodeAt(rest);
      if (!n) return null;
      g.push(n.node);
      rest = n.rest.trimStart();
      if (!rest.startsWith('&')) break;
      rest = rest.slice(1).trimStart();
    }
    groups.push(g);
    if (!rest) return { groups, links };
    const l = linkAt(rest);
    if (!l) return null;
    links.push(l.link);
    rest = l.rest.trimStart();
    if (!rest) return null;
  }
}

export function flowchartToGraph(src: string): FlowResult {
  const st = statements(src);
  const bad = (line: string): FlowResult => ({ ok: false, reason: tr('不认识这一行：{line}', { line }) });
  if (!st.length || !/^(?:flowchart|graph)\b/i.test(st[0])) return { ok: false, reason: tr('不是 flowchart / graph') };
  if (!HEADER.test(st[0])) return bad(st[0]);
  const titles = new Map<string, string>();
  const edges: NgEdgeIn[] = [];
  const see = (n: FNode) => {
    if (!titles.has(n.id)) titles.set(n.id, n.text ?? n.id);
    else if (n.text !== undefined && titles.get(n.id) === n.id) titles.set(n.id, n.text);
  };
  for (const s of st.slice(1)) {
    if (SKIP.test(s)) continue;
    const r = statement(s);
    if (!r) return bad(s);
    r.groups.flat().forEach(see);
    r.links.forEach((l, i) => { for (const a of r.groups[i]) for (const b of r.groups[i + 1]) edges.push({ id: `e${edges.length}`, from: a.id, to: b.id, label: l.label, style: l.style }); });
    if (titles.size > NG_MAX_NODES) return { ok: false, reason: tr('卡片太多（最多 {max} 张）', { max: NG_MAX_NODES }) };
  }
  if (!titles.size) return { ok: false, reason: tr('图里没有节点') };
  const res = normalizeNodeGraph({ nodes: [...titles].map(([id, title]) => ({ id, title })), edges });
  return res.ok ? { ok: true, graph: res.graph } : { ok: false, reason: res.error };
}
