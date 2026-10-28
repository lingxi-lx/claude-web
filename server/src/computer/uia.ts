/**
 * UI Automation trees → something a model can read and act on. Pure: the caller hands in what the Windows helper
 * saw (roles, names, bounds, supported patterns); nothing here touches a process, the screen or a clock.
 *
 * A raw UIA tree is far too big to send: thousands of decorative panes, every row of every list. `compressTree`
 * keeps at most 400 nodes and 8 levels, drops nodes that neither say anything nor lead to one that does, and gives
 * every control that can be acted on a short ref (`e12`). The model acts by ref; `refById` turns one back into the
 * node the helper must invoke.
 *
 * The tree is untrusted data: names and values come from whatever application is in front.
 */
import { tr } from '../i18n/index.js';

export interface Rect { x: number; y: number; width: number; height: number }

/** One control, as the helper reports it. Role is a UIA ControlType name ("Button", "Edit", "ListItem", …). */
export interface UiaNode {
  role: string;
  name?: string;
  value?: string;
  automationId?: string;
  className?: string;
  /** screen pixels */
  bounds?: Rect;
  enabled?: boolean;
  offscreen?: boolean;
  focused?: boolean;
  /** supported UIA patterns: "Invoke", "Value", "Toggle", "Select", "Expand", "RangeValue", … */
  patterns?: string[];
  children?: UiaNode[];
}

export interface UiaWindow {
  hwnd?: number;
  pid?: number;
  /** process name, without .exe */
  name?: string;
  /** the executable, when the helper can read it (the same fields a WindowApp has, for grant matching) */
  exe?: string;
  description?: string;
  product?: string;
  title?: string;
  rect?: Rect;
}

export interface UiaSnapshot {
  /** the application in front */
  app?: UiaWindow;
  /** the window the tree belongs to (usually the same as app) */
  window?: UiaWindow;
  root: UiaNode;
  takenAt?: number;
}

/** A node as it goes to the model: short field names, no empty fields, children only when it has any. */
export interface CompactNode {
  ref?: string;
  role: string;
  name?: string;
  value?: string;
  automationId?: string;
  bounds?: Rect;
  patterns?: string[];
  disabled?: boolean;
  offscreen?: boolean;
  focused?: boolean;
  /** children that were left out here (budget or depth) */
  truncated?: number;
  children?: CompactNode[];
}

export interface UiRef {
  ref: string;
  role: string;
  name: string;
  value?: string;
  automationId?: string;
  bounds?: Rect;
  patterns: string[];
  disabled?: boolean;
}

export interface CompressedTree {
  app?: UiaWindow;
  window?: UiaWindow;
  root: CompactNode;
  /** every actionable node in `root`, by ref */
  refs: UiRef[];
  /** the tree as indented lines, refs in square brackets — what the model reads */
  text: string;
  stats: { nodes: number; refs: number; omitted: number; depth: number; depthHit: boolean };
}

export interface CompressOptions {
  /** default 400 */
  maxNodes?: number;
  /** default 8 */
  maxDepth?: number;
}

export const MAX_TREE_NODES = 400;
export const MAX_TREE_DEPTH = 8;

const ACTIONABLE_ROLES = new Set([
  'button', 'checkbox', 'combobox', 'edit', 'hyperlink', 'listitem', 'menuitem', 'radiobutton', 'slider',
  'spinner', 'splitbutton', 'tabitem', 'treeitem', 'dataitem', 'headeritem', 'dropdownbutton',
]);

const ACTIONABLE_PATTERNS = new Set(['invoke', 'value', 'toggle', 'select', 'selectionitem', 'expand', 'rangevalue']);

/** Can this control be operated through UIA (Invoke / Value / Toggle / Select / Expand …)? */
export function isActionable(node: Pick<UiaNode, 'role' | 'patterns'>): boolean {
  const role = String(node.role ?? '').toLowerCase().replace(/[\s_-]/g, '');
  if (ACTIONABLE_ROLES.has(role)) return true;
  return (node.patterns ?? []).some((p) => ACTIONABLE_PATTERNS.has(String(p).toLowerCase().replace(/[\s_-]/g, '')));
}

/** "12" and "E12" both name e12. */
export function normalizeRef(ref: string): string {
  const s = String(ref ?? '').trim().toLowerCase();
  return /^\d+$/.test(s) ? `e${s}` : s;
}

const clip = (v: unknown, max: number): string => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  const chars = [...s];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : s;
};

const rect = (r: Rect | undefined): Rect | undefined => {
  if (!r) return undefined;
  const x = Number(r.x), y = Number(r.y), width = Number(r.width), height = Number(r.height);
  return [x, y, width, height].every(Number.isFinite) ? { x, y, width, height } : undefined;
};

function subtreeCount(root: UiaNode): number {
  let n = 0;
  const stack: UiaNode[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    n++;
    for (const child of node.children ?? []) stack.push(child);
  }
  return n;
}

function valueOf(node: CompactNode | UiRef): string {
  return node.value ?? '';
}

/**
 * Cut a tree down to what is worth sending and number the actionable controls.
 *
 * Kept: every node with a name or value, every actionable control, the root, and any parent that leads to one of
 * those. Decorative leaves and subtrees past `maxDepth` are left out (the parent says how many children it left).
 * The budget is spent depth-first in the order the helper reported the controls.
 */
export function compressTree(snapshot: UiaSnapshot, opts: CompressOptions = {}): CompressedTree {
  const maxNodes = Math.max(1, Math.min(1000, Math.floor(opts.maxNodes ?? MAX_TREE_NODES)));
  const maxDepth = Math.max(0, Math.min(20, Math.floor(opts.maxDepth ?? MAX_TREE_DEPTH)));
  const total = subtreeCount(snapshot.root);
  const refs: UiRef[] = [];
  let used = 0;
  let deepest = 0;
  let depthHit = false;
  let seq = 0;

  const visit = (node: UiaNode, depth: number): CompactNode | null => {
    if (used >= maxNodes) return null;
    // take this node's slot before its children: a parent must never push the total past the budget
    used++;
    const children: CompactNode[] = [];
    let skipped = 0;
    let limitHit = false;
    if (depth >= maxDepth) {
      if ((node.children ?? []).length) { skipped = node.children!.length; depthHit = true; limitHit = true; }
    } else {
      for (const child of node.children ?? []) {
        const made = visit(child, depth + 1);
        if (made) children.push(made);
        else { skipped++; if (used >= maxNodes) limitHit = true; }
      }
    }
    const actionable = isActionable(node);
    const hasText = !!clip(node.name, 1) || !!clip(node.value, 1);
    if (depth !== 0 && !actionable && !hasText && !children.length) {
      used--;
      return null;
    }

    deepest = Math.max(deepest, depth);
    const out: CompactNode = { role: clip(node.role, 80) || 'Unknown' };
    const name = clip(node.name, 160);
    if (name) out.name = name;
    const value = clip(node.value, 200);
    if (value) out.value = value;
    const automationId = clip(node.automationId, 120);
    if (automationId) out.automationId = automationId;
    const b = rect(node.bounds);
    if (b) out.bounds = b;
    const patterns = [...new Set((node.patterns ?? []).filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim()))];
    if (patterns.length) out.patterns = patterns;
    if (node.enabled === false) out.disabled = true;
    if (node.offscreen === true) out.offscreen = true;
    if (node.focused === true) out.focused = true;
    if (actionable) {
      const ref = `e${++seq}`;
      out.ref = ref;
      refs.push({
        ref,
        role: out.role,
        name: name || '',
        ...(value ? { value } : {}),
        ...(automationId ? { automationId } : {}),
        ...(b ? { bounds: b } : {}),
        patterns,
        ...(node.enabled === false ? { disabled: true } : {}),
      });
    }
    if (children.length) out.children = children;
    if (skipped) out.truncated = skipped;
    if (limitHit && depth >= maxDepth) out.truncated = skipped;
    return out;
  };

  const root = visit(snapshot.root, 0) ?? { role: 'Unknown' };
  const text = renderTree(snapshot, root);
  return {
    ...(snapshot.app ? { app: snapshot.app } : {}),
    ...(snapshot.window ? { window: snapshot.window } : {}),
    root,
    refs,
    text,
    stats: { nodes: used, refs: refs.length, omitted: Math.max(0, total - used), depth: deepest, depthHit },
  };
}

const quote = (s: string): string => JSON.stringify(clip(s, 160));

function renderTree(snapshot: UiaSnapshot, root: CompactNode): string {
  const lines: string[] = [];
  if (snapshot.window?.title) lines.push(tr('窗口：{title}', { title: clip(snapshot.window.title, 160) }));
  if (snapshot.app?.name) lines.push(tr('应用：{name}', { name: clip(snapshot.app.name, 80) }));
  const walk = (node: CompactNode, depth: number) => {
    const parts = [node.role];
    if (node.name) parts.push(quote(node.name));
    if (valueOf(node)) parts.push(`= ${quote(valueOf(node))}`);
    if (node.ref) parts.push(`[${node.ref}]`);
    if (node.patterns?.length) parts.push(`{${node.patterns.join(', ')}}`);
    const flags: string[] = [];
    if (node.disabled) flags.push(tr('不可用'));
    if (node.offscreen) flags.push(tr('不可见'));
    if (node.focused) flags.push(tr('有焦点'));
    if (flags.length) parts.push(`(${flags.join(', ')})`);
    if (node.truncated) parts.push(tr('…另有 {n} 项', { n: node.truncated }));
    lines.push(`${'  '.repeat(depth)}${parts.join(' ')}`);
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  walk(root, 0);
  return lines.join('\n');
}

/** Does the snapshot's application or window title contain `text`? */
export function windowMatches(tree: Pick<CompressedTree, 'app' | 'window'> | UiaSnapshot, text: string): boolean {
  const needle = String(text ?? '').trim().toLowerCase();
  if (!needle) return true;
  return [tree.window?.title, tree.window?.name, tree.app?.title, tree.app?.name]
    .some((v) => typeof v === 'string' && v.toLowerCase().includes(needle));
}

export interface FindQuery {
  /** exact role, case-insensitive ("Button", "Edit") */
  role?: string;
  /** name contains this, case-insensitive */
  name?: string;
  /** name, value or automation id contains this, case-insensitive */
  text?: string;
  /** exact automation id, case-insensitive */
  automationId?: string;
  /** the application / window title must contain this too */
  window?: string;
  /** only controls with a ref */
  actionableOnly?: boolean;
  /** default 20, at most 100 */
  limit?: number;
}

export interface UiMatch extends UiRef { depth: number }

const isCompressed = (t: CompressedTree | UiaSnapshot): t is CompressedTree =>
  Array.isArray((t as CompressedTree).refs) && !!(t as CompressedTree).root && typeof (t as CompressedTree).text === 'string';

/**
 * Find controls by role / name / text / window. Refs are the same ones `compressTree` gave them, so a result can be
 * handed straight to an action.
 */
export function findNodes(tree: CompressedTree | UiaSnapshot, query: FindQuery): UiMatch[] {
  const compressed = isCompressed(tree) ? tree : compressTree(tree);
  const role = String(query.role ?? '').trim().toLowerCase();
  const name = String(query.name ?? '').trim().toLowerCase();
  const text = String(query.text ?? '').trim().toLowerCase();
  const automationId = String(query.automationId ?? '').trim().toLowerCase();
  if (!role && !name && !text && !automationId) return [];
  if (query.window && !windowMatches(compressed, query.window)) return [];
  const limit = Math.max(1, Math.min(100, Math.floor(query.limit ?? 20)));
  const out: UiMatch[] = [];
  const stack: Array<{ node: CompactNode; depth: number }> = [{ node: compressed.root, depth: 0 }];
  while (stack.length && out.length < limit) {
    const { node, depth } = stack.pop()!;
    if (role && node.role.toLowerCase() !== role) { /* still walk children */ }
    else if (name && !(node.name ?? '').toLowerCase().includes(name)) { /* walk on */ }
    else if (automationId && (node.automationId ?? '').toLowerCase() !== automationId) { /* walk on */ }
    else if (text && ![node.name ?? '', node.value ?? '', node.automationId ?? ''].some((v) => v.toLowerCase().includes(text))) { /* walk on */ }
    else if (!query.actionableOnly || node.ref) {
      out.push({
        ...(node.ref ? { ref: node.ref } : { ref: '' }),
        role: node.role,
        name: node.name ?? '',
        ...(node.value ? { value: node.value } : {}),
        ...(node.automationId ? { automationId: node.automationId } : {}),
        ...(node.bounds ? { bounds: node.bounds } : {}),
        patterns: node.patterns ?? [],
        ...(node.disabled ? { disabled: true } : {}),
        depth,
      });
    }
    const children = node.children ?? [];
    for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i], depth: depth + 1 });
  }
  return out;
}

/** The node an action names. Null when the ref came from an older observation or was never handed out. */
export function refById(tree: CompressedTree | null | undefined, ref: string): UiRef | null {
  if (!tree) return null;
  const key = normalizeRef(ref);
  if (!key) return null;
  return tree.refs.find((r) => r.ref === key) ?? null;
}

/** A one-line summary for a tool answer. */
export function describeMatch(m: UiMatch): string {
  const at = m.bounds ? ` @ ${m.bounds.x},${m.bounds.y} ${m.bounds.width}x${m.bounds.height}` : '';
  const patterns = m.patterns.length ? ` {${m.patterns.join(', ')}}` : '';
  return `${m.ref ? `[${m.ref}] ` : ''}${m.role}${m.name ? ` ${quote(m.name)}` : ''}${at}${patterns}`;
}
