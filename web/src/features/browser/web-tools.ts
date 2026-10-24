// The web tools as a conversation shows them (server/src/web/mcp.ts: the MCP server `web`): a step's verb and target,
// and what a permission card asks. Pure.
import type { IconName } from '@/ui/icons';
import { tr } from '@/i18n';
import { VIEWPORT_IDS, viewportLabel, type ViewportId } from './viewport';

export const WEB_TOOLS = ['web_search', 'browser_open', 'browser_read', 'browser_find', 'browser_click', 'browser_type', 'browser_press_key', 'browser_scroll', 'browser_back', 'browser_screenshot', 'browser_computer', 'browser_console', 'browser_network', 'browser_snapshot', 'browser_wait', 'browser_tabs', 'browser_viewport', 'character_guide', 'character_draft', 'character_save', 'character_assign', 'character_list', 'theme_guide', 'theme_draft', 'theme_get', 'theme_save', 'theme_apply', 'theme_list', 'theme_delete'] as const;
export type WebTool = (typeof WEB_TOOLS)[number];

/** `mcp__web__browser_open` (Claude), `web__browser_open` / `web.browser_open` / the bare name (other agents) → the tool. */
export function webToolOf(name: string): WebTool | null {
  const bare = name.replace(/^mcp__web__/, '').replace(/^web(__|\.|\/)/, '');
  if (bare === name && !name.startsWith('browser_')) return null; // a bare `web_search` is someone else's tool
  return (WEB_TOOLS as readonly string[]).includes(bare) ? (bare as WebTool) : null;
}

const str = (i: Record<string, unknown> | undefined, k: string) => (typeof i?.[k] === 'string' ? (i[k] as string) : '');
/** `github.com/a/b` for an address: what a row has room for (the tooltip has all of it). */
export function shortAddress(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    return `${u.host.replace(/^www\./i, '')}${path}${u.search ? '?…' : ''}`;
  } catch { return url; }
}
const host = (url: string) => { try { return new URL(url).host.replace(/^www\./i, ''); } catch { return ''; } };

export interface WebToolLabel { icon: IconName; verb: string; arg: string }

export function webToolLabel(tool: WebTool, input: Record<string, unknown> | undefined): WebToolLabel {
  switch (tool) {
    case 'web_search': return { icon: 'search', verb: tr('搜索网页:'), arg: str(input, 'query') };
    case 'browser_open': return { icon: 'web', verb: tr('打开网页:'), arg: shortAddress(str(input, 'url')) };
    case 'browser_read': return { icon: 'web', verb: tr('读网页'), arg: Number(input?.offset) > 0 ? tr('从第 {offset} 个字符', { offset: Number(input?.offset) }) : '' };
    case 'browser_find': return { icon: 'search', verb: tr('在网页里找:'), arg: str(input, 'query') };
    case 'browser_click': return { icon: 'cursor', verb: tr('点击网页:'), arg: refText(input?.ref) };
    case 'browser_type': return { icon: 'keyboard', verb: tr('在网页里输入:'), arg: `${str(input, 'text').slice(0, 80)}${input?.submit === true ? ' ↵' : ''}` };
    case 'browser_press_key': return { icon: 'keyboard', verb: tr('按键:'), arg: str(input, 'key') };
    case 'browser_scroll': return { icon: 'web', verb: input?.direction === 'up' ? tr('向上滚动网页') : tr('向下滚动网页'), arg: '' };
    case 'browser_back': return { icon: 'web', verb: tr('返回上一页'), arg: '' };
    case 'browser_screenshot': return { icon: 'image', verb: tr('给网页截图'), arg: '' };
    case 'browser_computer': return computerLabel(input);
    case 'browser_console': return { icon: 'web', verb: tr('看网页的控制台'), arg: input?.errors_only === true ? tr('只看错误和警告') : '' };
    case 'browser_network': return { icon: 'web', verb: tr('看网页的网络请求'), arg: input?.failed_only === true ? tr('只看失败的') : '' };
    case 'browser_snapshot': return { icon: 'web', verb: tr('看网页的结构'), arg: '' };
    case 'browser_wait': return { icon: 'web', verb: tr('等网页:'), arg: str(input, 'text').slice(0, 80) || refText(input?.ref) };
    case 'browser_tabs': {
      const action = str(input, 'action');
      if (action === 'switch') return { icon: 'web', verb: tr('换到标签:'), arg: refText(input?.id) };
      if (action === 'new') return { icon: 'web', verb: tr('新开标签:'), arg: shortAddress(str(input, 'url')) };
      if (action === 'close') return { icon: 'web', verb: tr('关掉标签:'), arg: refText(input?.id) };
      return { icon: 'web', verb: tr('看打开的标签'), arg: '' };
    }
    case 'browser_viewport': {
      const preset = str(input, 'preset') as ViewportId;
      return { icon: 'web', verb: tr('把网页显示成:'), arg: VIEWPORT_IDS.includes(preset) ? viewportLabel(preset) : preset };
    }
    // 网吧's characters (server/src/characters/tool-defs.ts) ride on the same server
    case 'character_guide': return { icon: 'user', verb: tr('看捏角色的说明'), arg: '' };
    case 'character_draft': { const c = input?.character as Record<string, unknown> | undefined; return { icon: 'user', verb: tr('画角色草稿:'), arg: str(c, 'name') || str(c, 'id') }; }
    case 'character_save': return { icon: 'user', verb: tr('保存角色:'), arg: str(input, 'id') };
    case 'character_assign': return { icon: 'user', verb: input?.id === null ? tr('收回角色:') : tr('把角色给:'), arg: input?.id === null ? targetText(str(input, 'target')) : `${str(input, 'id')} → ${targetText(str(input, 'target'))}` };
    case 'character_list': return { icon: 'user', verb: tr('看角色库'), arg: '' };
    // 字符画主题 (server/src/themes/tool-defs.ts)
    case 'theme_guide': return { icon: 'sparkle', verb: tr('看做主题的说明'), arg: '' };
    case 'theme_draft': { const j = input?.json as Record<string, any> | undefined; return { icon: 'sparkle', verb: tr('主题草稿:'), arg: str(j?.name, 'zh') || str(j, 'id') }; }
    case 'theme_get': return { icon: 'sparkle', verb: tr('读主题:'), arg: str(input, 'id') };
    case 'theme_save': return { icon: 'sparkle', verb: tr('保存主题:'), arg: str(input, 'id') };
    case 'theme_apply': return { icon: 'sparkle', verb: tr('换上主题:'), arg: str(input, 'id') };
    case 'theme_list': return { icon: 'sparkle', verb: tr('看有哪些主题'), arg: '' };
    case 'theme_delete': return { icon: 'trash', verb: tr('删除主题:'), arg: str(input, 'id') };
  }
}

/** `type:Explore` → 「Explore 类子代理」 */
function targetText(t: string): string {
  if (t === 'admin') return tr('网管');
  if (t === 'default') return tr('所有客人');
  if (t.startsWith('type:')) return tr('{t} 类子代理', { t: t.slice(5) });
  if (t.startsWith('name:')) return tr('叫 {t} 的客人', { t: t.slice(5) });
  return t;
}

const at = (v: unknown) => (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number') ? `(${Math.round(v[0] as number)}, ${Math.round(v[1] as number)})` : '');
const CLICKS: Record<string, string> = { left_click: tr('点击网页'), right_click: tr('右键点击网页'), middle_click: tr('中键点击网页'), double_click: tr('双击网页'), triple_click: tr('三连击网页') };

/** browser_computer: the mouse and keyboard by position — said as what is done, where. */
function computerLabel(input: Record<string, unknown> | undefined): WebToolLabel {
  const action = str(input, 'action');
  if (CLICKS[action]) return { icon: 'cursor', verb: `${CLICKS[action]}:`, arg: at(input?.coordinate) };
  switch (action) {
    case 'screenshot': return { icon: 'image', verb: tr('给网页截图'), arg: '' };
    case 'mouse_move': return { icon: 'cursor', verb: tr('把鼠标移到:'), arg: at(input?.coordinate) };
    case 'left_click_drag': return { icon: 'cursor', verb: tr('在网页上拖动:'), arg: `${at(input?.start_coordinate)} → ${at(input?.coordinate)}` };
    case 'scroll': return { icon: 'web', verb: tr('{v}滚动网页', { v: { up: tr('向上'), down: tr('向下'), left: tr('向左'), right: tr('向右') }[str(input, 'scroll_direction')] ?? '' }), arg: '' };
    case 'type': return { icon: 'keyboard', verb: tr('在网页里输入:'), arg: str(input, 'text').slice(0, 80) };
    case 'key': return { icon: 'keyboard', verb: tr('按键:'), arg: str(input, 'text') };
    case 'wait': return { icon: 'web', verb: tr('等网页一会儿'), arg: '' };
    default: return { icon: 'cursor', verb: tr('操作网页'), arg: '' };
  }
}
const refText = (ref: unknown) => (typeof ref === 'string' || typeof ref === 'number' ? `[${String(ref).replace(/^\[|\]$/g, '')}]` : '');

/** 「Claude 想在浏览器里打开 github.com」: what a permission card asks for a web tool. */
export function webToolAsk(tool: WebTool, input: Record<string, unknown> | undefined, agent: string): string {
  switch (tool) {
    case 'web_search': return tr('{agent} 想搜索网页', { agent });
    case 'browser_open': { const h = host(str(input, 'url')); return h ? tr('{agent} 想在浏览器里打开 {h}', { agent, h }) : tr('{agent} 想在浏览器里打开一个网页', { agent }); }
    case 'browser_read': return tr('{agent} 想读浏览器里的网页', { agent });
    case 'browser_find': return tr('{agent} 想在网页里查找', { agent });
    case 'browser_click': return tr('{agent} 想在网页上点一下', { agent });
    case 'browser_type': return input?.submit === true ? tr('{agent} 想在网页上输入并提交', { agent }) : tr('{agent} 想在网页上输入文字', { agent });
    case 'browser_press_key': return tr('{agent} 想在网页上按键', { agent });
    case 'browser_scroll': return tr('{agent} 想滚动网页', { agent });
    case 'browser_back': return tr('{agent} 想让网页返回上一页', { agent });
    case 'browser_screenshot': return tr('{agent} 想给网页截图', { agent });
    case 'browser_computer': {
      const action = str(input, 'action');
      if (action === 'screenshot') return tr('{agent} 想给网页截图', { agent });
      if (action === 'type') return tr('{agent} 想在网页上输入文字', { agent });
      if (action === 'key') return tr('{agent} 想在网页上按键', { agent });
      if (action === 'scroll') return tr('{agent} 想滚动网页', { agent });
      if (action === 'wait') return tr('{agent} 想等网页一会儿', { agent });
      if (action === 'left_click_drag') return tr('{agent} 想在网页上拖动鼠标', { agent });
      if (action === 'mouse_move') return tr('{agent} 想在网页上移动鼠标', { agent });
      return tr('{agent} 想用鼠标点网页上的一个位置', { agent });
    }
    case 'browser_console': return tr('{agent} 想看网页的控制台', { agent });
    case 'browser_network': return tr('{agent} 想看网页的网络请求', { agent });
    case 'browser_snapshot': return tr('{agent} 想看网页的结构', { agent });
    case 'browser_wait': return tr('{agent} 想等网页加载出来', { agent });
    case 'browser_tabs': {
      const h = str(input, 'action') === 'new' ? host(str(input, 'url')) : '';
      return h ? tr('{agent} 想新开一个标签打开 {h}', { agent, h }) : tr('{agent} 想管理它打开的浏览器标签', { agent });
    }
    case 'browser_viewport': return tr('{agent} 想换网页的显示尺寸', { agent });
    case 'character_assign': return input?.id === null ? tr('{agent} 想把{targetText}换回默认形象', { agent, targetText: targetText(str(input, 'target')) }) : tr('{agent} 想把角色 {str} 给{targetText}', { agent, str: str(input, 'id'), targetText: targetText(str(input, 'target')) });
    case 'character_guide': case 'character_draft': case 'character_save': case 'character_list': return tr('{agent} 想改网吧的角色库', { agent });
    case 'theme_apply': return tr('{agent} 想把界面换成主题「{id}」', { agent, id: str(input, 'id') });
    case 'theme_delete': return tr('{agent} 想删除主题「{id}」', { agent, id: str(input, 'id') });
    case 'theme_guide': case 'theme_draft': case 'theme_get': case 'theme_save': case 'theme_list': return tr('{agent} 想改你的字符画主题', { agent });
  }
}
