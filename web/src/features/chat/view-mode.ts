// 查看模式 (spec 2026-10-16 chat-input §3): how much of every turn the conversation shows — one setting for all of
// them (`ui.viewMode`), Ctrl+O steps through it. 普通 is what the conversation always did.
import { tr } from '@/i18n';

export type ViewMode = 'normal' | 'verbose' | 'summary';

export const VIEW_MODES: ViewMode[] = ['normal', 'verbose', 'summary'];

export function normViewMode(v: unknown): ViewMode {
  return v === 'verbose' || v === 'summary' ? v : 'normal';
}

export function nextViewMode(m: ViewMode): ViewMode {
  return VIEW_MODES[(VIEW_MODES.indexOf(m) + 1) % VIEW_MODES.length];
}

export function viewModeLabel(m: ViewMode): string {
  return m === 'verbose' ? tr('详细') : m === 'summary' ? tr('精简') : tr('普通');
}

