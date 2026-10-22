import { REPO_URL } from './data/links';

/** CHANGELOG(.zh-CN).md for the page: no title and no language line (the page has both), repo links made absolute. */
export function changelogBody(md: string): string {
  const lines = md.split('\n');
  const title = lines.findIndex((l) => /^# /.test(l));
  return lines
    .filter((l, i) => i !== title && !/\]\(CHANGELOG(\.zh-CN)?\.md\)/.test(l))
    .join('\n')
    .replace(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g, `](${REPO_URL}/blob/main/$1)`);
}
