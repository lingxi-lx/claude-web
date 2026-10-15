import { PANEL_TITLES, type Tile } from '@/model/layout';
import { tr } from '@/i18n';

const tail = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;

/**
 * How an error boundary names a tile: `会话 · 0f1e2d3c`, `文档 · index.ts`, `面板 · 终端`… The name ends up in
 * server.log (`client.log`), so it never carries a tab title — a chat title is the user's first prompt — or
 * a browser URL; a session is named by its id.
 */
export function tileArea(tile: Tile): string {
  switch (tile.kind) {
    case 'chat': return tr('对话 · {sessionId}', { sessionId: tile.sessionId ? tile.sessionId.slice(0, 8) : tr('新对话') });
    case 'doc': return tr('文档 · {tail}', { tail: tail(tile.path) });
    case 'diff': return tr('差异 · {tail}', { tail: tail(tile.path) });
    case 'term': return tr('终端');
    case 'browser': return tr('浏览器');
    case 'panel': return tr('面板 · {panel}', { panel: PANEL_TITLES[tile.panel] ?? tile.panel });
  }
}
