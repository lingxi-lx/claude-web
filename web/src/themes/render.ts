import type { Frame } from './frames';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** One frame as HTML: every character escaped, the coloured ones in var(--token); rows joined by a newline. */
export function frameHtml(frame: Frame, color?: Record<string, string>): string {
  return frame.map((row) => {
    let out = '';
    for (const ch of row) {
      const e = ESC[ch] ?? ch;
      const tok = color?.[ch];
      out += tok ? `<b style="color:var(--${tok})">${e}</b>` : e;
    }
    return out;
  }).join('\n');
}
