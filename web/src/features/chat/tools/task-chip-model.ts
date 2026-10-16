/** A worktree name for a suggested task: its title in ASCII letters, else `task-<MMDD>-<HHMM>` (a Chinese title). */
export function taskWorktreeName(title: string, now = new Date()): string {
  const slug = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
  if (slug.length >= 3) return slug;
  const p = (n: number) => String(n).padStart(2, '0');
  return `task-${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}
