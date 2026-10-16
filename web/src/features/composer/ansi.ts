// statusLine output (phase 6 §3) is what a terminal would draw: SGR colour codes, nothing else worth keeping.
// Split into runs of text with the style they had; every other escape (cursor moves, OSC titles / links) is dropped.

export interface AnsiStyle { fg?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean }
export interface AnsiRun { text: string; style: AnsiStyle }

/** The 16 colours in a theme's own tokens (light and dark both read them), indexed 0–15 like the terminal's. */
const BASIC = ['var(--ansi-0)', 'var(--ansi-1)', 'var(--ansi-2)', 'var(--ansi-3)', 'var(--ansi-4)', 'var(--ansi-5)', 'var(--ansi-6)', 'var(--ansi-7)',
  'var(--ansi-8)', 'var(--ansi-9)', 'var(--ansi-10)', 'var(--ansi-11)', 'var(--ansi-12)', 'var(--ansi-13)', 'var(--ansi-14)', 'var(--ansi-15)'];

function color256(n: number): string | undefined {
  if (!(n >= 0 && n <= 255)) return undefined;
  if (n < 16) return BASIC[n];
  if (n >= 232) { const v = 8 + (n - 232) * 10; return `rgb(${v},${v},${v})`; }
  const i = n - 16;
  const c = (x: number) => (x === 0 ? 0 : 55 + x * 40);
  return `rgb(${c(Math.floor(i / 36))},${c(Math.floor(i / 6) % 6)},${c(i % 6)})`;
}

function applySgr(st: AnsiStyle, params: number[]): AnsiStyle {
  const s = { ...st };
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (p === 0) { for (const k of Object.keys(s)) delete s[k as keyof AnsiStyle]; }
    else if (p === 1) s.bold = true;
    else if (p === 2) s.dim = true;
    else if (p === 3) s.italic = true;
    else if (p === 4) s.underline = true;
    else if (p === 22) { delete s.bold; delete s.dim; }
    else if (p === 23) delete s.italic;
    else if (p === 24) delete s.underline;
    else if (p >= 30 && p <= 37) s.fg = BASIC[p - 30];
    else if (p >= 90 && p <= 97) s.fg = BASIC[p - 90 + 8];
    else if (p === 39) delete s.fg;
    else if (p >= 40 && p <= 47) s.bg = BASIC[p - 40];
    else if (p >= 100 && p <= 107) s.bg = BASIC[p - 100 + 8];
    else if (p === 49) delete s.bg;
    else if (p === 38 || p === 48) {
      const key = p === 38 ? 'fg' : 'bg';
      if (params[i + 1] === 5) { const c = color256(params[i + 2]); if (c) s[key] = c; i += 2; }
      else if (params[i + 1] === 2) {
        const [r, g, b] = params.slice(i + 2, i + 5);
        if ([r, g, b].every((x) => x >= 0 && x <= 255)) s[key] = `rgb(${r},${g},${b})`;
        i += 4;
      }
    }
  }
  return s;
}

// CSI … final byte | OSC … BEL / ST | a lone two-byte escape
// eslint-disable-next-line no-control-regex
const ESC = /\x1b\[([0-9;:?]*)([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

export function parseAnsi(input: string): AnsiRun[] {
  const out: AnsiRun[] = [];
  let style: AnsiStyle = {};
  let last = 0;
  const push = (text: string) => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev && JSON.stringify(prev.style) === JSON.stringify(style)) prev.text += text;
    else out.push({ text, style });
  };
  for (const m of input.matchAll(ESC)) {
    push(input.slice(last, m.index));
    last = m.index! + m[0].length;
    if (m[2] === 'm') style = applySgr(style, (m[1] || '0').split(/[;:]/).map((x) => (x === '' ? 0 : Number(x))));
  }
  push(input.slice(last));
  return out;
}
