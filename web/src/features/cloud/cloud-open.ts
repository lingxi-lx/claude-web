// Which cloud dialog is open (派活 / claude.ai 导入 / 发布 / 已发布). Kept apart from CloudDialogs.tsx so the menus
// that open one do not pull the dialogs into the boot chunk (review X1); CloudDialogsLazy loads them on first open.
import { create } from 'zustand';

export type CloudDialog = { kind: 'dispatch' } | { kind: 'claudeai' } | { kind: 'publish'; path: string } | { kind: 'published' };
export const useCloud = create<{ d: CloudDialog | null }>(() => ({ d: null }));
export const openDispatch = () => useCloud.setState({ d: { kind: 'dispatch' } });
export const openClaudeAiImport = () => useCloud.setState({ d: { kind: 'claudeai' } });
export const openPublish = (path: string) => useCloud.setState({ d: { kind: 'publish', path } });
export const openPublished = () => useCloud.setState({ d: { kind: 'published' } });
export const closeCloud = () => useCloud.setState({ d: null });
