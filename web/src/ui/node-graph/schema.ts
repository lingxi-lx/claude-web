import { tr } from '@/i18n';
// spec 2026-10-24 D1 / D4: the node graph's input — what Claude writes in a ```nodegraph block (JSON) and what the
// background page / orchestra build directly (already normalized). Pure; the component only takes NodeGraphData.

export type EdgeStyle = 'normal' | 'strong' | 'error' | 'dashed';
export const EDGE_STYLES: readonly EdgeStyle[] = ['normal', 'strong', 'error', 'dashed'];
export type NodeState = 'idle' | 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'stopped';
export const NODE_STATES: readonly NodeState[] = ['idle', 'queued', 'running', 'waiting', 'done', 'failed', 'stopped'];
export const NG_MAX_NODES = 500;
export const NG_MAX_EDGES = 2000;

// ---- input: the JSON Claude writes (spec D1's format + options' marks + edges' pulse) ----
export interface NgOptionIn { value: string; label?: string; marks?: Record<string, EdgeStyle> }
export interface NgRowIn { id?: string; label: string; value: string; options?: (string | NgOptionIn)[] }
export interface NgListIn { title: string; items: (string | { text: string; tags?: string[] })[] }
export interface NgNodeIn { id: string; title: string; subtitle?: string; icon?: string; rows?: NgRowIn[]; list?: NgListIn; state?: NodeState; x?: number; y?: number }
export interface NgEdgeIn { id?: string; from: string; to: string; fromRow?: string; label?: string; style?: EdgeStyle; pulse?: boolean }
export type NgBadgeIn = string | { count?: EdgeStyle; text: string; okText: string };
export interface NodeGraphIn { title?: string; subtitle?: string; badge?: NgBadgeIn; nodes: NgNodeIn[]; edges?: NgEdgeIn[] }

// ---- normalized: the component only takes this; D2 / D3 build it directly ----
export interface NgOption { value: string; label: string; marks: Record<string, EdgeStyle> }
export interface NgRow { id: string; label: string; value: string; options: NgOption[] }
export interface NgListItem { text: string; tags: string[] }
export interface NgList { title: string; items: NgListItem[] }
export interface NgNode {
  id: string; title: string; subtitle?: string; icon?: string; rows: NgRow[]; list?: NgList; state?: NodeState; x?: number; y?: number;
  /** callers only (not read from JSON): the card icon's colour, a `var(--agent-n)` */ accent?: string;
  /** callers only: hover tip */ tip?: string;
}
export interface NgEdge { id: string; from: string; to: string; /** a row id */ fromRow?: string; label?: string; style: EdgeStyle; pulse?: boolean }
export type NgBadge = { kind: 'text'; text: string } | { kind: 'count'; count: EdgeStyle; text: string; okText: string };
export interface NodeGraphData { title?: string; subtitle?: string; badge?: NgBadge; nodes: NgNode[]; edges: NgEdge[] }
export type ParseResult = { ok: true; graph: NodeGraphData } | { ok: false; error: string };

class Bad extends Error {}
function fail(path: string, why: string): never { throw new Bad(`${path}: ${why}`); }
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, p: string): string => (typeof v === 'string' && v.trim() ? v : fail(p, tr('要是非空字符串')));
const optStr = (v: unknown, p: string): string | undefined => (v === undefined || v === null ? undefined : typeof v === 'string' ? v : fail(p, tr('要是字符串')));
const optNum = (v: unknown, p: string): number | undefined => (v === undefined || v === null ? undefined : typeof v === 'number' && Number.isFinite(v) ? v : fail(p, tr('要是数字')));
const arr = (v: unknown, p: string): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : fail(p, tr('要是数组')));
const styleOf = (v: unknown, p: string): EdgeStyle => (v === undefined ? 'normal' : (EDGE_STYLES as readonly unknown[]).includes(v) ? (v as EdgeStyle) : fail(p, tr('不认识的线样式 {style}（只能是 normal / strong / error / dashed）', { style: String(v) })));

export function parseNodeGraph(text: string): ParseResult {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { return { ok: false, error: tr('不是 JSON：{msg}', { msg: (e as Error).message }) }; }
  return normalizeNodeGraph(raw);
}

export function normalizeNodeGraph(raw: unknown): ParseResult {
  try { return { ok: true, graph: build(raw) }; } catch (e) { if (e instanceof Bad) return { ok: false, error: e.message }; throw e; }
}

function build(raw: unknown): NodeGraphData {
  if (!isObj(raw)) fail('$', tr('要是一个对象'));
  if (!Array.isArray(raw.nodes)) fail('nodes', tr('要有 nodes 数组'));
  const nodesIn = raw.nodes as unknown[];
  if (!nodesIn.length) fail('nodes', tr('至少要有一张卡片'));
  if (nodesIn.length > NG_MAX_NODES) fail('nodes', tr('卡片太多（最多 {max} 张）', { max: NG_MAX_NODES }));
  const edgesIn = arr(raw.edges, 'edges');
  if (edgesIn.length > NG_MAX_EDGES) fail('edges', tr('线太多（最多 {max} 条）', { max: NG_MAX_EDGES }));
  const nodes = nodesIn.map((n, i) => node(n, `nodes[${i}]`));
  const byId = new Map<string, NgNode>();
  nodes.forEach((n, i) => { if (byId.has(n.id)) fail(`nodes[${i}].id`, tr('卡片 id 重复：{id}', { id: n.id })); byId.set(n.id, n); });
  const edges: NgEdge[] = [];
  const ids = new Set<string>();
  edgesIn.forEach((e, i) => {
    const p = `edges[${i}]`;
    if (!isObj(e)) fail(p, tr('要是一个对象'));
    const from = str(e.from, `${p}.from`);
    const to = str(e.to, `${p}.to`);
    if (!byId.has(from)) fail(`${p}.from`, tr('没有 id 为 {id} 的卡片', { id: from }));
    if (!byId.has(to)) fail(`${p}.to`, tr('没有 id 为 {id} 的卡片', { id: to }));
    const fr = optStr(e.fromRow, `${p}.fromRow`);
    let fromRow: string | undefined;
    if (fr !== undefined) {
      const row = byId.get(from)!.rows.find((x) => x.id === fr || x.label === fr);
      if (!row) fail(`${p}.fromRow`, tr('{row} 不是卡片 {node} 里的一行', { row: fr, node: from }));
      fromRow = row.id;
    }
    let id = optStr(e.id, `${p}.id`);
    if (id !== undefined && ids.has(id)) fail(`${p}.id`, tr('线 id 重复：{id}', { id }));
    if (id === undefined) { id = `${from}>${to}`; for (let k = 2; ids.has(id); k++) id = `${from}>${to}#${k}`; }
    ids.add(id);
    const pulse = e.pulse === undefined ? undefined : typeof e.pulse === 'boolean' ? e.pulse : fail(`${p}.pulse`, tr('要是 true 或 false'));
    edges.push({ id, from, to, fromRow, label: optStr(e.label, `${p}.label`), style: styleOf(e.style, `${p}.style`), pulse });
  });
  nodes.forEach((n, i) => n.rows.forEach((r, j) => r.options.forEach((o, k) => {
    for (const eid of Object.keys(o.marks)) if (!ids.has(eid)) fail(`nodes[${i}].rows[${j}].options[${k}].marks`, tr('没有 id 为 {id} 的线', { id: eid }));
  })));
  // only now (the error paths above use the author's indexes): a value that is not among its options comes first
  for (const n of nodes) for (const r of n.rows) if (r.options.length && !r.options.some((o) => o.value === r.value)) r.options.unshift({ value: r.value, label: r.value, marks: {} });
  return { title: optStr(raw.title, 'title'), subtitle: optStr(raw.subtitle, 'subtitle'), badge: badge(raw.badge), nodes, edges };
}

function node(v: unknown, p: string): NgNode {
  if (!isObj(v)) fail(p, tr('要是一个对象'));
  const id = str(v.id, `${p}.id`);
  const title = str(v.title, `${p}.title`);
  const rows = arr(v.rows, `${p}.rows`).map((r, j) => row(r, `${p}.rows[${j}]`, j));
  const seen = new Set<string>();
  rows.forEach((r, j) => { if (seen.has(r.id)) fail(`${p}.rows[${j}].id`, tr('行 id 重复：{id}', { id: r.id })); seen.add(r.id); });
  const state = v.state === undefined ? undefined : (NODE_STATES as readonly unknown[]).includes(v.state) ? (v.state as NodeState) : fail(`${p}.state`, tr('不认识的状态 {state}', { state: String(v.state) }));
  return { id, title, subtitle: optStr(v.subtitle, `${p}.subtitle`), icon: optStr(v.icon, `${p}.icon`), rows, list: v.list === undefined ? undefined : list(v.list, `${p}.list`), state, x: optNum(v.x, `${p}.x`), y: optNum(v.y, `${p}.y`) };
}

function row(v: unknown, p: string, j: number): NgRow {
  if (!isObj(v)) fail(p, tr('要是一个对象'));
  return { id: optStr(v.id, `${p}.id`) ?? `r${j}`, label: str(v.label, `${p}.label`), value: str(v.value, `${p}.value`), options: arr(v.options, `${p}.options`).map((o, k) => option(o, `${p}.options[${k}]`)) };
}

function option(v: unknown, p: string): NgOption {
  if (typeof v === 'string') return { value: v, label: v, marks: {} };
  if (!isObj(v)) fail(p, tr('要是字符串或对象'));
  const value = str(v.value, `${p}.value`);
  const marks: Record<string, EdgeStyle> = {};
  if (v.marks !== undefined) {
    if (!isObj(v.marks)) fail(`${p}.marks`, tr('要是一个对象'));
    for (const [k, s] of Object.entries(v.marks)) marks[k] = styleOf(s, `${p}.marks`);
  }
  return { value, label: optStr(v.label, `${p}.label`) ?? value, marks };
}

function list(v: unknown, p: string): NgList {
  if (!isObj(v)) fail(p, tr('要是一个对象'));
  return {
    title: str(v.title, `${p}.title`),
    items: arr(v.items, `${p}.items`).map((x, k) => {
      if (typeof x === 'string') return { text: x, tags: [] };
      if (!isObj(x)) fail(`${p}.items[${k}]`, tr('要是字符串或对象'));
      return { text: str(x.text, `${p}.items[${k}].text`), tags: arr(x.tags, `${p}.items[${k}].tags`).map((t, m) => str(t, `${p}.items[${k}].tags[${m}]`)) };
    }),
  };
}

function badge(v: unknown): NgBadge | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return { kind: 'text', text: v };
  if (!isObj(v)) fail('badge', tr('要是字符串或对象'));
  return { kind: 'count', count: v.count === undefined ? 'error' : styleOf(v.count, 'badge.count'), text: str(v.text, 'badge.text'), okText: str(v.okText, 'badge.okText') };
}
