// 编辑项目 (stage C2, spec C2): a project's name, its folders (the main one first, not removable; extra ones added
// with the folder picker, removed with ×) and 从侧栏移除项目. Saved through `workspaces.update`; a folder that no longer
// exists is refused by the server (toast, the dialog stays). Opened from the project's ··· menu (`openProjectDialog`).
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import type { Workspace } from '@shared';
import { useStore } from '@/store';
import { ws } from '@/ws/client';
import { desktop } from '@/desktop';
import { dlg } from '@/ui/dialog';
import { Icon } from '@/ui/icons';
import { imeComposing } from '@/ui/ime';
import { tr } from '@/i18n';

const useProjectDialog = create<{ id: string | null }>(() => ({ id: null }));
export const openProjectDialog = (w: Pick<Workspace, 'id'>) => useProjectDialog.setState({ id: w.id });
const close = () => useProjectDialog.setState({ id: null });

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export function ProjectDialogHost() {
  const id = useProjectDialog((s) => s.id);
  const w = useStore((s) => (id ? s.workspaces.find((x) => x.id === id) : undefined));
  if (!id || !w) return null;
  return <ProjectDialog key={w.id} w={w} />;
}

function ProjectDialog({ w }: { w: Workspace }) {
  const [name, setName] = useState(w.name);
  const [folders, setFolders] = useState<string[]>(w.folders ?? []);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => nameRef.current?.focus(), 0); }, []);
  const toast = (t: string) => useStore.getState().toast(t);

  const add = async () => {
    const p = desktop ? await desktop.pickDir() : await ws.request<string | null>({ kind: 'fs.pickDir' }).catch((e) => { toast(e.message); return null; });
    if (!p) return;
    if ([w.path, ...folders].some((f) => norm(f) === norm(p))) { toast(tr('这个文件夹已经在项目里了')); return; }
    setFolders((f) => [...f, p]);
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await useStore.getState().updateWorkspace(w.id, { name: name.trim() || w.name, folders });
      close();
    } catch {
      /* toasted by the store; the dialog stays */
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await dlg.confirm(tr('从侧栏移除「{name}」？', { name: w.name }), { message: tr('只移除侧栏里的这条记录，不动磁盘上的文件。'), danger: true }))) return;
    await ws.request({ kind: 'workspaces.remove', id: w.id }).then(close, (e) => toast(e.message));
  };

  return (
    <div className="modal-bg dialog-bg" data-id="project-dialog" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => { if (e.key === 'Escape' && !imeComposing(e.nativeEvent)) { e.stopPropagation(); close(); } }}>
      <div className="modal dialog project-dialog" role="dialog" aria-modal="true" aria-label={tr('编辑项目')}>
        <h3>{tr('编辑项目')}</h3>
        <label className="pj-label" htmlFor="pj-name">{tr('名字')}</label>
        <input id="pj-name" ref={nameRef} className="field" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !imeComposing(e.nativeEvent)) void save(); }} />
        <div className="pj-label">{tr('源文件夹')}</div>
        <ul className="pj-folders">
          <li className="pj-folder main" title={w.path}><Icon name="folder" size={14} /><span className="pj-path">{w.path}</span><span className="pj-tag">{tr('主文件夹')}</span></li>
          {folders.map((f) => (
            <li key={f} className="pj-folder" title={f}>
              <Icon name="folder" size={14} /><span className="pj-path">{f}</span>
              <button className="icon-btn" data-act="remove-folder" aria-label={tr('移除 {path}', { path: f })} title={tr('移除 {path}', { path: f })} onClick={() => setFolders((l) => l.filter((x) => x !== f))}><Icon name="close" size={12} /></button>
            </li>
          ))}
        </ul>
        <button className="btn sm" data-act="add-folder" onClick={() => void add()}><Icon name="plus" size={12} /> {tr('添加文件夹')}</button>
        <div className="dialog-msg pj-note">
          <div>{tr('新开的对话会同时看到这些文件夹；正在运行的对话下次打开时生效。')}</div>
          <div>{tr('Claude 和 Codex 能用额外的文件夹，其它 agent 只用主文件夹。')}</div>
        </div>
        <div className="actions">
          <button className="btn danger ghost pj-remove" data-act="remove-project" onClick={() => void remove()}>{tr('从侧栏移除项目')}</button>
          <span className="grow" />
          <button className="btn" onClick={close}>{tr('取消')}</button>
          <button className="btn primary" data-act="save" disabled={busy} onClick={() => void save()}>{tr('保存')}</button>
        </div>
      </div>
    </div>
  );
}
