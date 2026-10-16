// diff 行评论 (spec 2026-10-16 review-pr §1): comments on diff lines, handed to Claude in one message.
import { tr } from '@/i18n';

export interface LineComment { id: string; path: string; line: number; side: 'new' | 'old'; code: string; text: string }

/** The message that asks Claude to act on the comments, in the order they sit in the files. */
export function formatComments(list: LineComment[]): string {
  const sorted = [...list].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  const items = sorted.map((c, i) => {
    const where = `${c.path}:${c.line}${c.side === 'old' ? tr('（改动前）') : ''}`;
    const code = c.code.trim() ? `\n   > ${c.code.trim()}` : '';
    return `${i + 1}. ${where}${code}\n   ${c.text.trim().split('\n').join('\n   ')}`;
  });
  return `${tr('请按下面这些代码审阅评论修改：')}\n\n${items.join('\n\n')}`;
}
