// 右键 → 引用到输入框 (desktop: desktop/src/context-menu.ts sends the selected text as `desktop:quoteSelection`): the
// selection goes into the input box as a Markdown quote. A window event like 「引用到输入框」 for a conversation
// (REFERENCE_EVENT): the composer of the focused pane's front tile takes it — a right click focuses the pane it lands
// in (Pane.tsx onMouseDownCapture), so that is the conversation the text was picked from.
export const QUOTE_EVENT = 'cw:composer-quote';
export interface QuoteDetail { text: string; handled: boolean }

/** `text` as a Markdown quote: every line `> `, blank lines kept as `>`, outer blank lines and trailing spaces dropped. */
export function quoteMarkdown(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.map((l) => (l ? `> ${l}` : '>')).join('\n');
}

/** What the box holds after the quote is added: the quote on its own lines after what is typed, then an empty line to write on. */
export function withQuote(cur: string, text: string): string {
  const q = quoteMarkdown(text);
  if (!q) return cur;
  const head = cur.replace(/\s+$/, '');
  return `${head}${head ? '\n\n' : ''}${q}\n\n`;
}

/** False: no input box took it (no conversation in front). */
export function quoteInComposer(text: string): boolean {
  const detail: QuoteDetail = { text, handled: false };
  window.dispatchEvent(new CustomEvent<QuoteDetail>(QUOTE_EVENT, { detail }));
  return detail.handled;
}
