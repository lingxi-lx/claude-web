// The token `claude setup-token` ends with, read off a terminal's output (settings → 账号与登录 → 添加 Claude 账号). Pure.

/** `claude setup-token` prints the token this way (long-lived, inference only). */
const TOKEN_HEAD = 'sk-ant-oat';
const TOKEN_CHAR = /[A-Za-z0-9_-]/;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/**
 * The token in a terminal's output, if it is there whole. The terminal may have wrapped it: a line that is nothing but
 * token characters continues it (「Store this token securely.」 has spaces, and ends it). Pure.
 */
export function tokenIn(output: string): string | null {
  // a Windows console (ConPTY) moves the cursor to the next row instead of writing a line break at times
  // eslint-disable-next-line no-control-regex
  const text = output.replace(/\x1b\[\d*(;\d*)?H/g, '\n').replace(ANSI, '').replace(/\r/g, '');
  const at = text.lastIndexOf(TOKEN_HEAD);
  if (at < 0) return null;
  let i = at, tok = '';
  for (;;) {
    while (i < text.length && TOKEN_CHAR.test(text[i])) tok += text[i++];
    // lines are padded with spaces (Ink, cmd's echo); the token's line must be complete — not still arriving
    let j = i;
    while (text[j] === ' ' || text[j] === '\t') j++;
    if (j >= text.length) return null;
    if (text[j] !== '\n') break;
    const end = text.indexOf('\n', j + 1);
    if (end < 0) break;
    const next = text.slice(j + 1, end).trim();
    if (!next || !/^[A-Za-z0-9_-]+$/.test(next)) break;
    i = text.indexOf(next, j + 1);
  }
  return /^sk-ant-oat\d{2}-[A-Za-z0-9_-]{40,}$/.test(tok) ? tok : null;
}
