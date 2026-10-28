/**
 * UI Automation as `ComputerAutomation`: the helper's `uia.snapshot` / `uia.act` answers, translated to the pure tree
 * types of `uia.ts` and the actions of `service.ts`.
 *
 * A snapshot is read once and compressed by the service, which hands out refs; when an action names a ref the service
 * also hands over the control's role / name / automationId / bounds (`AutomationTarget`). The helper finds that control
 * again in the window as it is at that moment — a ref is never trusted to mean "the nth element", and a control that is
 * gone is refused instead of acted on. `expect` carries the foreground window the service looked at; the helper checks
 * it once more at the last moment, like every other input op. Only Windows has this helper.
 */
import { HelperError, type HelperLike } from './helper-win.js';
import { parseKeys, parseModifiers } from './keys.js';
import type { AutomationActOptions, AutomationAction, AutomationResult, ComputerAutomation } from './service.js';
import type { Rect, UiaNode, UiaSnapshot, UiaWindow } from './uia.js';

const SNAPSHOT_TIMEOUT_MS = 30_000;
const ACTION_TIMEOUT_MS = 30_000;

const record = (v: unknown): Record<string, any> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : null;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

function rectOf(v: unknown): Rect | undefined {
  const r = record(v);
  if (!r) return undefined;
  const x = num(r.x), y = num(r.y), width = num(r.width), height = num(r.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  return { x, y, width, height };
}

function windowOf(v: unknown): UiaWindow | undefined {
  const w = record(v);
  if (!w) return undefined;
  const hwnd = num(w.hwnd), pid = num(w.pid);
  const name = str(w.name), exe = str(w.exe), description = str(w.description), product = str(w.product);
  const title = str(w.title), rect = rectOf(w.rect);
  const out: UiaWindow = {
    ...(hwnd !== undefined ? { hwnd } : {}),
    ...(pid !== undefined ? { pid } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(exe ? { exe } : {}),
    ...(description ? { description } : {}),
    ...(product ? { product } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(rect ? { rect } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

function nodeOf(v: unknown): UiaNode | null {
  const n = record(v);
  if (!n) return null;
  const role = str(n.role);
  if (!role) return null;
  const out: UiaNode = { role };
  const name = str(n.name), value = str(n.value), automationId = str(n.automationId), className = str(n.className);
  if (name) out.name = name;
  if (value !== undefined) out.value = value;
  if (automationId) out.automationId = automationId;
  if (className) out.className = className;
  const bounds = rectOf(n.bounds);
  if (bounds) out.bounds = bounds;
  if (typeof n.enabled === 'boolean') out.enabled = n.enabled;
  if (typeof n.offscreen === 'boolean') out.offscreen = n.offscreen;
  if (n.focused === true) out.focused = true;
  if (Array.isArray(n.patterns)) {
    const patterns = n.patterns.filter((p: unknown): p is string => typeof p === 'string' && !!p.trim());
    if (patterns.length) out.patterns = patterns;
  }
  if (Array.isArray(n.children)) {
    const children = n.children.map(nodeOf).filter((c: UiaNode | null): c is UiaNode => c !== null);
    if (children.length) out.children = children;
  }
  return out;
}

/** The helper's JSON answer to `uia.snapshot` as a `UiaSnapshot`. Throws when it holds no tree at all. */
export function snapshotFromHelper(r: Record<string, any>, takenAt: number = Date.now()): UiaSnapshot {
  const root = nodeOf(r.root);
  if (!root) throw new HelperError(`uia.snapshot returned no control tree${r.error ? `: ${r.error}` : ''}`);
  const app = windowOf(r.app);
  const window = windowOf(r.window);
  return { ...(app ? { app } : {}), ...(window ? { window } : {}), root, takenAt };
}

export class HelperAutomation implements ComputerAutomation {
  constructor(private readonly helper: HelperLike, private readonly deps: { now?: () => number } = {}) {}

  async observe(opts: { window?: string } = {}): Promise<UiaSnapshot> {
    const window = opts.window?.trim();
    const r = await this.call('uia.snapshot', { ...(window ? { window } : {}) }, SNAPSHOT_TIMEOUT_MS);
    if (r.ok !== true) throw new HelperError(String(r.error ?? 'uia.snapshot failed'));
    return snapshotFromHelper(r, (this.deps.now ?? Date.now)());
  }

  async act(action: AutomationAction, opts: AutomationActOptions = {}): Promise<AutomationResult> {
    if (opts.signal?.aborted) return { ok: false, error: 'Stopped before the action was sent.' };
    const name = String(action.action ?? '').trim();
    const target = opts.target ? this.targetJson(opts.target) : undefined;
    switch (name) {
      case 'invoke':
      case 'toggle':
      case 'expand':
      case 'collapse': {
        if (!target) return stale();
        const r = await this.call('uia.act', { action: name, target, expect: opts.expect });
        return this.result(r);
      }
      case 'value': {
        if (!target) return stale();
        const r = await this.call('uia.act', { action: name, target, text: action.value ?? action.text ?? '', expect: opts.expect });
        return this.result(r);
      }
      case 'select': {
        if (!target) return stale();
        const r = await this.call('uia.act', { action: name, target, ...(typeof action.text === 'string' ? { text: action.text } : {}), expect: opts.expect });
        return this.result(r);
      }
      case 'click': {
        const mods = parseModifiers(action.text);
        if (!mods.ok) return { ok: false, error: mods.error };
        if (target) {
          const r = await this.call('uia.act', { action: 'click', target, count: action.count ?? 1, mods: mods.mods, expect: opts.expect });
          return this.result(r);
        }
        if (!action.coordinate) return { ok: false, error: 'click needs a ref or a coordinate' };
        const r = await this.call('click', {
          x: action.coordinate[0], y: action.coordinate[1], button: 'left', count: action.count ?? 1, mods: mods.mods, expect: opts.expect,
        });
        return this.result(r);
      }
      case 'type': {
        const text = action.text ?? '';
        if (!text.length) return { ok: false, error: 'type needs text' };
        const r = await this.call('type', { text, expect: opts.expect }, 20_000 + text.length * 8);
        return this.result(r);
      }
      case 'key': {
        const parsed = parseKeys(action.text);
        if (!parsed.ok) return { ok: false, error: parsed.error };
        const r = await this.call('keys', { chords: parsed.chords, expect: opts.expect }, 15_000 + parsed.chords.length * 150);
        return this.result(r);
      }
      case 'scroll': {
        const point = action.coordinate ?? this.centre(opts.target);
        if (!point) return { ok: false, error: 'scroll needs a ref or a coordinate' };
        const mods = parseModifiers(action.text);
        if (!mods.ok) return { ok: false, error: mods.error };
        const notches = Math.max(1, Math.min(100, Math.floor(action.count ?? 3)));
        const r = await this.call('scroll', { x: point[0], y: point[1], dx: 0, dy: -notches, mods: mods.mods, expect: opts.expect }, 15_000 + notches * 40);
        return this.result(r);
      }
      default:
        return { ok: false, error: `Unknown action ${name}.` };
    }
  }

  private call(op: string, args: Record<string, unknown>, timeoutMs = ACTION_TIMEOUT_MS): Promise<Record<string, any>> {
    return this.helper.call(op, args, timeoutMs);
  }

  private targetJson(t: NonNullable<AutomationActOptions['target']>): Record<string, unknown> {
    return {
      ...(t.hwnd !== undefined ? { hwnd: t.hwnd } : {}),
      role: t.role,
      ...(t.name ? { name: t.name } : {}),
      ...(t.automationId ? { automationId: t.automationId } : {}),
      ...(t.bounds ? { bounds: t.bounds } : {}),
    };
  }

  private centre(t: AutomationActOptions['target']): [number, number] | undefined {
    const b = t?.bounds;
    if (!b || !(b.width > 0) || !(b.height > 0)) return undefined;
    return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)];
  }

  private result(r: Record<string, any>): AutomationResult {
    if (r.ok === true) return { ok: true, ...(typeof r.text === 'string' && r.text ? { text: r.text } : {}) };
    return {
      ok: false,
      error: String(r.error ?? 'The action failed.'),
      ...(r.changed === true ? { changed: true } : {}),
      ...(r.self === true ? { self: true } : {}),
      ...(typeof r.sent === 'number' ? { sent: r.sent } : {}),
    };
  }
}

/** The ref came from a snapshot the adapter was not given the target for (an old ref, or a fake driver). */
function stale(): AutomationResult {
  return { ok: false, error: 'The control reference is stale: observe the window again before acting on it.' };
}
