// 文件 panel → 本对话的文件 (spec E4): the files Claude read or changed in this conversation, first time first.

const PATH_KEY: Record<string, 'file_path' | 'notebook_path'> = {
  Read: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path',
};

export function touchedFiles(uses: Iterable<{ name: string; input: unknown }>): string[] {
  const seen = new Set<string>();
  for (const u of uses) {
    const key = PATH_KEY[u.name];
    if (!key || !u.input || typeof u.input !== 'object') continue;
    const p = (u.input as Record<string, unknown>)[key];
    if (typeof p === 'string' && p) seen.add(p);
  }
  return [...seen];
}
