// The 扩展 page (structure round 2, spec 2026-10-10-ui-structure §4): its name and its parts. Pure — ExtensionsPage.tsx
// draws it, state.ts opens / closes it (and ui/heading-text.ts reads the titles in node).
import type { IconName } from '@/ui/icons';
import { tr } from '@/i18n';

/** The page's title. It is set in the heading face, so ui/heading-text.ts lists it. */
export const EXTENSIONS_TITLE = tr('扩展');

export const EXTENSION_TABS = ['connectors', 'skills', 'plugins'] as const;
export type ExtensionTab = (typeof EXTENSION_TABS)[number];

/** Each part: its name (a heading too, where the section's sidebar shows the parts) and one line on what it is for. */
export const EXTENSION_TAB_INFO: Record<ExtensionTab, { label: string; icon: IconName; desc: string }> = {
  connectors: { label: tr('连接器'), icon: 'mcp', desc: tr('把 GitHub、数据库、浏览器这些外部工具和数据接给 Agent') },
  skills: { label: 'Skills', icon: 'skill', desc: tr('写好的做事方法：Agent 遇到对应的任务时自己取用') },
  plugins: { label: tr('插件'), icon: 'artifact', desc: tr('成套的扩展：一次装上命令、Skills、子代理和连接器') },
};
