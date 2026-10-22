import { REPO_URL } from './data/links';

/** CHANGELOG(.zh-CN).md for the page: no title and no language line (the page has both), repo links made absolute, stray tags escaped. */
export function changelogBody(md: string): string {
  const lines = md.split('\n');
  const title = lines.findIndex((l) => /^# /.test(l));
  return escapeTags(lines
    .filter((l, i) => i !== title && !/\]\(CHANGELOG(\.zh-CN)?\.md\)/.test(l))
    .join('\n')
    .replace(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g, `](${REPO_URL}/blob/main/$1)`));
}

/**
 * The page renders the markdown with raw HTML allowed, so a placeholder like `<relay host>` in the
 * prose would become an element and its words would vanish. Escape every `<` that starts something
 * tag-like, except `<kbd>` / `</kbd>` (used on purpose); code spans and fenced blocks are left alone.
 */
function escapeTags(md: string): string {
  let fenced = false;
  return md.split('\n').map((line) => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return line; }
    if (fenced) return line;
    const parts = line.split('`');
    // Odd parts are inside a code span, unless the last backtick on the line has no partner.
    return parts.map((p, i) => (i % 2 === 1 && i < parts.length - 1 ? p : p.replace(/<(?!\/?kbd>)(?=[A-Za-z/])/g, '&lt;'))).join('`');
  }).join('\n');
}
