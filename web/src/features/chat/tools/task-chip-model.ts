/**
 * A worktree name for a suggested task: its title in ASCII letters, else `task-<MMDD>-<HHMM>` (a Chinese title), and the
 * end of the suggestion's id — two suggestions with the same title must not land in one worktree (the CLI reuses one).
 */
export function taskWorktreeName(title: string, id = '', now = new Date()): string {
  const slug = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
  const p = (n: number) => String(n).padStart(2, '0');
  const base = slug.length >= 3 ? slug : `task-${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  const tail = id.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toLowerCase();
  return tail ? `${base}-${tail}` : base;
}
