// A CSS tokenizer after CSS Syntax Level 3 §4 — only as far as deciding what a browser would fetch from a theme's
// CSS (pack.ts cssRemoteRefs): strings, url tokens, functions, at-keywords and identifiers with their escapes decoded
// exactly as a browser decodes them. Pattern matching on the text was not enough (2026-10-22 review: an escaped
// newline in a string, an escaped quote in an identifier, a stray quote in a broken url( all got a request out).

export type CssToken = { type: 'ws' | 'string' | 'bad-string' | 'url' | 'bad-url' | 'function' | 'at' | 'ident' | 'number' | 'delim'; value: string };

const isNl = (c: string) => c === '\n' || c === '\r' || c === '\f';
const isWs = (c: string) => c === ' ' || c === '\t' || isNl(c);
const isHex = (c: string) => /^[0-9a-f]$/i.test(c);
const isNameStart = (c: string) => /^[a-z_]$/i.test(c) || (c !== '' && c.codePointAt(0)! >= 0x80);
const isName = (c: string) => isNameStart(c) || /^[0-9-]$/.test(c);
const isNonPrintable = (c: string) => { const n = c.codePointAt(0)!; return n <= 8 || n === 0xb || (n >= 0xe && n <= 0x1f) || n === 0x7f; };

export function cssTokens(src: string): CssToken[] {
  // preprocessing (§3.3): CRLF / CR / FF are newlines, NUL is U+FFFD
  const s = [...src.replace(/\r\n?|\f/g, '\n').replace(/\0/g, '\ufffd')];
  let i = 0;
  const out: CssToken[] = [];
  const at = (k = 0) => s[i + k] ?? '';
  const validEscape = (a: string, b: string) => a === '\\' && b !== '' && !isNl(b);
  const startsIdent = (a: string, b: string, c: string) =>
    a === '-' ? isNameStart(b) || b === '-' || validEscape(b, c) : isNameStart(a) || validEscape(a, b);

  // §4.3.7, after the backslash
  const escape = (): string => {
    const c = at();
    if (c === '') return '\ufffd';
    i++;
    if (!isHex(c)) return c;
    let h = c;
    while (h.length < 6 && isHex(at())) h += s[i++];
    if (isWs(at())) i++;
    const n = parseInt(h, 16);
    return n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? '\ufffd' : String.fromCodePoint(n);
  };
  const name = (): string => {
    let r = '';
    for (;;) {
      const c = at();
      if (isName(c)) { r += c; i++; } else if (validEscape(c, at(1))) { i++; r += escape(); } else return r;
    }
  };
  const string = (q: string): CssToken => {
    let r = '';
    for (;;) {
      const c = at();
      if (c === '') return { type: 'string', value: r };
      if (c === q) { i++; return { type: 'string', value: r }; }
      if (isNl(c)) return { type: 'bad-string', value: r };
      i++;
      if (c === '\\') {
        if (at() === '') continue;
        if (isNl(at())) { i++; continue; }
        r += escape();
      } else r += c;
    }
  };
  // §4.3.6: after `url(` with no quote
  const url = (): CssToken => {
    while (isWs(at())) i++;
    let r = '';
    const bad = (): CssToken => {
      // the rest of a bad url, up to its `)` (§4.3.14)
      while (at() !== '' && at() !== ')') { if (validEscape(at(), at(1))) { i++; escape(); } else i++; }
      if (at() === ')') i++;
      return { type: 'bad-url', value: '' };
    };
    for (;;) {
      const c = at();
      if (c === ')' || c === '') { i++; return { type: 'url', value: r }; }
      if (isWs(c)) {
        while (isWs(at())) i++;
        if (at() === ')' || at() === '') { i++; return { type: 'url', value: r }; }
        return bad();
      }
      if (c === '"' || c === "'" || c === '(' || isNonPrintable(c)) return bad();
      if (c === '\\') {
        if (validEscape(c, at(1))) { i++; r += escape(); continue; }
        return bad();
      }
      r += c; i++;
    }
  };

  while (i < s.length) {
    const c = at();
    if (c === '/' && at(1) === '*') {
      i += 2;
      while (i < s.length && !(at() === '*' && at(1) === '/')) i++;
      i += 2;
      continue;
    }
    if (isWs(c)) { while (isWs(at())) i++; out.push({ type: 'ws', value: ' ' }); continue; }
    if (c === '"' || c === "'") { i++; out.push(string(c)); continue; }
    if (c === '@' && startsIdent(at(1), at(2), at(3))) { i++; out.push({ type: 'at', value: name() }); continue; }
    if (/^[0-9]$/.test(c) || (c === '.' && /^[0-9]$/.test(at(1)))) {
      let r = '';
      while (/^[0-9.]$/.test(at())) r += s[i++];
      if (startsIdent(at(), at(1), at(2)) || at() === '%') r += at() === '%' ? s[i++] : name();
      out.push({ type: 'number', value: r });
      continue;
    }
    if (startsIdent(c, at(1), at(2))) {
      const n = name();
      if (at() === '(') {
        i++;
        if (n.toLowerCase() === 'url') {
          // `url(` then (after whitespace) a quote: a function with a string; anything else: one url token
          let k = 0;
          while (isWs(at(k))) k++;
          if (at(k) === '"' || at(k) === "'") { i += k; out.push({ type: 'function', value: 'url' }); }
          else out.push(url());
        } else out.push({ type: 'function', value: n.toLowerCase() });
      } else out.push({ type: 'ident', value: n });
      continue;
    }
    if (c === '\\' && !validEscape(c, at(1))) { i++; out.push({ type: 'delim', value: '\\' }); continue; }
    i++;
    out.push({ type: 'delim', value: c });
  }
  return out;
}
