// A character theme's pack (spec 2026-10-22 §1): theme.json, parsed and checked, plus its backdrop source and CSS.
// The errors are read by the theme skill, so they stay Chinese (not tr()'d).
import { DEFAULT_ANIMS } from './default-anims';
import { checkAnim, type ProcessAnim } from './frames';
import { PROCESSES, type Process } from './process';

export interface ThemePack {
  id: string;
  name: { zh: string; en: string };
  mode: 'dark' | 'light';
  /** primitives, without the leading `--` (bg, fg, accent, …) */
  colors: Record<string, string>;
  /** the backdrop behind a conversation: how strong, and how fast against the welcome page */
  chatDim: { opacity: number; speed: number };
  processes: Partial<Record<Process, ProcessAnim>>;
  /** per process: what is wrong with the one the pack has (it falls back to the default) */
  broken: Partial<Record<Process, string[]>>;
  backdrop?: string;
  css?: string;
}

export const REQUIRED_COLORS: readonly string[] = [
  'bg', 'bg-1', 'bg-2', 'bg-3', 'bg-elev', 'line', 'line-1', 'fg', 'fg-1', 'fg-2', 'fg-3',
  'accent', 'accent-text', 'accent-fg', 'primary', 'primary-fg', 'user-bg', 'green', 'red', 'yellow', 'blue',
  ...Array.from({ length: 10 }, (_, i) => `agent-${i + 1}`),
];
const OPTIONAL_COLORS = ['shade', 'shade-a', 'e1', 'e2', 'e3'];
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

export function parsePack(raw: unknown, extra: { backdrop?: string; css?: string } = {}): { pack?: ThemePack; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(raw)) return { errors: ['theme.json 必须是一个对象'] };
  const id = raw.id;
  if (typeof id !== 'string' || !ID.test(id)) errors.push('id 只能用小写字母、数字和连字符，最长 32 个字符');
  const name = isObj(raw.name) ? raw.name : {};
  if (typeof name.zh !== 'string' || !name.zh.trim() || typeof name.en !== 'string' || !name.en.trim()) errors.push('name 要有 zh 和 en 两个名字');
  if (raw.mode !== 'dark' && raw.mode !== 'light') errors.push('mode 只能是 dark 或 light');
  const colors: Record<string, string> = {};
  const rc = isObj(raw.colors) ? raw.colors : {};
  if (!isObj(raw.colors)) errors.push('缺少 colors');
  for (const k of REQUIRED_COLORS) {
    const v = rc[k];
    if (typeof v !== 'string' || !HEX.test(v)) errors.push(`colors.${k} 缺少或不是 #rrggbb 形式的颜色`);
    else colors[k] = v;
  }
  for (const k of OPTIONAL_COLORS) {
    const v = rc[k];
    if (v === undefined) continue;
    if (typeof v !== 'string' || /[;{}<>]/.test(v)) errors.push(`colors.${k} 的值不合法`);
    else colors[k] = v;
  }
  const dim = isObj(raw.chatDim) ? raw.chatDim : {};
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : d);
  const chatDim = { opacity: num(dim.opacity, 0, 0.5, 0.12), speed: num(dim.speed, 0.05, 1, 0.33) };
  const processes: ThemePack['processes'] = {};
  const broken: ThemePack['broken'] = {};
  const rp = isObj(raw.processes) ? raw.processes : {};
  for (const [k, a] of Object.entries(rp)) {
    if (!(PROCESSES as readonly string[]).includes(k)) { errors.push(`processes 里的「${k}」不是认识的过程，只能用：${PROCESSES.join(' ')}`); continue; }
    const e = checkAnim(a);
    if (e.length) { broken[k as Process] = e; errors.push(...e.map((x) => `processes.${k}: ${x}`)); }
    else processes[k as Process] = a as ProcessAnim;
  }
  // a broken process falls back on its own; anything else wrong and there is no pack
  const fatal = errors.filter((e) => !e.startsWith('processes.'));
  if (fatal.length) return { errors };
  return {
    pack: { id, name: { zh: name.zh, en: name.en }, mode: raw.mode, colors, chatDim, processes, broken, backdrop: extra.backdrop, css: extra.css },
    errors,
  };
}

/** The pack's primitives as a rule on <html data-ascii="id">; `html:` makes it outrank the classic theme blocks. */
export function paletteCss(p: ThemePack): string {
  const decl = Object.entries(p.colors).map(([k, v]) => `  --${k}: ${v};`).join('\n');
  return `html:root[data-ascii='${p.id}'] {\n${decl}\n  color-scheme: ${p.mode};\n}\n`;
}

/** A theme's CSS stays offline: no remote @import, no remote url(). */
export function sanitizeCss(css: string): string {
  return css
    .replace(/@import\s+(url\()?\s*['"]?\s*(https?:)?\/\/[^;]*;?/gi, '')
    .replace(/url\(\s*['"]?\s*(https?:)?\/\/[^)]*\)/gi, 'none');
}

/** The animation a process plays under this pack: its own when it has a good one, else the default's (inline too). */
export function animFor(p: ThemePack | null, proc: Process): ProcessAnim {
  const own = p?.processes[proc];
  const d = DEFAULT_ANIMS[proc];
  if (!own) return d;
  return own.inline ? own : { ...own, inline: d.inline };
}
