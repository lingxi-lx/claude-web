// 查看模式 (spec 2026-10-16 chat-input §3; the official app's Normal / Thinking / Verbose): how much of every turn the
// conversation shows — one setting for all of them (`ui.viewMode`), Ctrl+O steps through it. 普通 is what the
// conversation always did. An older 'summary' (the official app dropped it too) opens as 普通.
import { tr } from '@/i18n';

export type ViewMode = 'normal' | 'thinking' | 'verbose';

export const VIEW_MODES: ViewMode[] = ['normal', 'thinking', 'verbose'];

export function normViewMode(v: unknown): ViewMode {
  return v === 'verbose' || v === 'thinking' ? v : 'normal';
}

export function nextViewMode(m: ViewMode): ViewMode {
  return VIEW_MODES[(VIEW_MODES.indexOf(m) + 1) % VIEW_MODES.length];
}

export function viewModeLabel(m: ViewMode): string {
  return m === 'verbose' ? tr('详细') : m === 'thinking' ? tr('显示思考') : tr('普通');
}
