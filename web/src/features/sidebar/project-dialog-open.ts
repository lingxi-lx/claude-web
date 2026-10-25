// Which project's 编辑项目 dialog is open, on which tab. Apart from ProjectDialog.tsx so the sidebar menu that opens it
// does not pull the dialog into the boot chunk (review X1); ProjectDialogLazy loads it on first open.
import { create } from 'zustand';
import type { Workspace } from '@shared';

export type ProjectTab = 'settings' | 'instructions' | 'files' | 'conversations';
export const useProjectDialog = create<{ id: string | null; tab: ProjectTab }>(() => ({ id: null, tab: 'settings' }));
export const openProjectDialog = (w: Pick<Workspace, 'id'>, tab: ProjectTab = 'settings') => useProjectDialog.setState({ id: w.id, tab });
