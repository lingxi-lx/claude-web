// 编辑项目's duplicate-folder test (ProjectDialog.tsx), kept apart so it can be tested without the store.
/** A Windows path (a drive letter or \\server): the same folder whatever the case. The browser may be on another
 *  machine than the server, so the project's own main path decides (stage C fix wave C-U4). */
export const isWinPath = (p: string) => /^[a-zA-Z]:|^\\\\/.test(p);
export const samePath = (a: string, b: string, win: boolean) => {
  const n = (p: string) => { const s = p.replace(/\\/g, '/').replace(/\/+$/, ''); return win ? s.toLowerCase() : s; };
  return n(a) === n(b);
};
