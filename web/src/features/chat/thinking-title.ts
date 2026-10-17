/**
 * The title of a thinking block, the way the official app names its rows: summarized thinking comes as paragraphs, each
 * headed by a bold line (`**Inspecting the zip**`). While it streams the row says what it is on now (the last
 * heading); once done, what it set out to do (the first). No heading (other providers' raw reasoning) → none.
 */
export function thinkingTitle(text: string, streaming: boolean): string {
  const heads: string[] = [];
  const re = /^\s*\*\*([^*\n]{2,120})\*\*\s*$/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) heads.push(m[1].trim());
  if (!heads.length) return '';
  return (streaming ? heads[heads.length - 1] : heads[0]).replace(/[.:：。]+$/, '');
}
