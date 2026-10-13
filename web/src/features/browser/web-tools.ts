// The web tools as a conversation shows them (server/src/web/mcp.ts: the MCP server `web`): a step's verb and target,
// and what a permission card asks. Pure.
import type { IconName } from '@/ui/icons';

export const WEB_TOOLS = ['web_search', 'browser_open', 'browser_read', 'browser_find', 'browser_click', 'browser_type', 'browser_press_key', 'browser_scroll', 'browser_back', 'browser_screenshot', 'browser_computer', 'character_guide', 'character_draft', 'character_save', 'character_assign', 'character_list'] as const;
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
    case 'web_search': return { icon: 'search', verb: '搜索网页:', arg: str(input, 'query') };
    case 'browser_open': return { icon: 'web', verb: '打开网页:', arg: shortAddress(str(input, 'url')) };
    case 'browser_read': return { icon: 'web', verb: '读网页', arg: Number(input?.offset) > 0 ? `从第 ${Number(input?.offset)} 个字符` : '' };
    case 'browser_find': return { icon: 'search', verb: '在网页里找:', arg: str(input, 'query') };
    case 'browser_click': return { icon: 'cursor', verb: '点击网页:', arg: refText(input?.ref) };
    case 'browser_type': return { icon: 'keyboard', verb: '在网页里输入:', arg: `${str(input, 'text').slice(0, 80)}${input?.submit === true ? ' ↵' : ''}` };
    case 'browser_press_key': return { icon: 'keyboard', verb: '按键:', arg: str(input, 'key') };
    case 'browser_scroll': return { icon: 'web', verb: input?.direction === 'up' ? '向上滚动网页' : '向下滚动网页', arg: '' };
    case 'browser_back': return { icon: 'web', verb: '返回上一页', arg: '' };
    case 'browser_screenshot': return { icon: 'image', verb: '给网页截图', arg: '' };
    case 'browser_computer': return computerLabel(input);
    // 网吧's characters (server/src/characters/tool-defs.ts) ride on the same server
    case 'character_guide': return { icon: 'user', verb: '看捏角色的说明', arg: '' };
    case 'character_draft': { const c = input?.character as Record<string, unknown> | undefined; return { icon: 'user', verb: '画角色草稿:', arg: str(c, 'name') || str(c, 'id') }; }
    case 'character_save': return { icon: 'user', verb: '保存角色:', arg: str(input, 'id') };
    case 'character_assign': return { icon: 'user', verb: input?.id === null ? '收回角色:' : '把角色给:', arg: input?.id === null ? targetText(str(input, 'target')) : `${str(input, 'id')} → ${targetText(str(input, 'target'))}` };
    case 'character_list': return { icon: 'user', verb: '看角色库', arg: '' };
  }
}

/** `type:Explore` → 「Explore 类子代理」 */
function targetText(t: string): string {
  if (t === 'admin') return '网管';
  if (t === 'default') return '所有客人';
  if (t.startsWith('type:')) return `${t.slice(5)} 类子代理`;
  if (t.startsWith('name:')) return `叫 ${t.slice(5)} 的客人`;
  return t;
}

const at = (v: unknown) => (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number') ? `(${Math.round(v[0] as number)}, ${Math.round(v[1] as number)})` : '');
const CLICKS: Record<string, string> = { left_click: '点击网页', right_click: '右键点击网页', middle_click: '中键点击网页', double_click: '双击网页', triple_click: '三连击网页' };

/** browser_computer: the mouse and keyboard by position — said as what is done, where. */
function computerLabel(input: Record<string, unknown> | undefined): WebToolLabel {
  const action = str(input, 'action');
  if (CLICKS[action]) return { icon: 'cursor', verb: `${CLICKS[action]}:`, arg: at(input?.coordinate) };
  switch (action) {
    case 'screenshot': return { icon: 'image', verb: '给网页截图', arg: '' };
    case 'mouse_move': return { icon: 'cursor', verb: '把鼠标移到:', arg: at(input?.coordinate) };
    case 'left_click_drag': return { icon: 'cursor', verb: '在网页上拖动:', arg: `${at(input?.start_coordinate)} → ${at(input?.coordinate)}` };
    case 'scroll': return { icon: 'web', verb: `${{ up: '向上', down: '向下', left: '向左', right: '向右' }[str(input, 'scroll_direction')] ?? ''}滚动网页`, arg: '' };
    case 'type': return { icon: 'keyboard', verb: '在网页里输入:', arg: str(input, 'text').slice(0, 80) };
    case 'key': return { icon: 'keyboard', verb: '按键:', arg: str(input, 'text') };
    case 'wait': return { icon: 'web', verb: '等网页一会儿', arg: '' };
    default: return { icon: 'cursor', verb: '操作网页', arg: '' };
  }
}
const refText = (ref: unknown) => (typeof ref === 'string' || typeof ref === 'number' ? `[${String(ref).replace(/^\[|\]$/g, '')}]` : '');

/** 「Claude 想在浏览器里打开 github.com」: what a permission card asks for a web tool. */
export function webToolAsk(tool: WebTool, input: Record<string, unknown> | undefined, agent: string): string {
  switch (tool) {
    case 'web_search': return `${agent} 想搜索网页`;
    case 'browser_open': { const h = host(str(input, 'url')); return h ? `${agent} 想在浏览器里打开 ${h}` : `${agent} 想在浏览器里打开一个网页`; }
    case 'browser_read': return `${agent} 想读浏览器里的网页`;
    case 'browser_find': return `${agent} 想在网页里查找`;
    case 'browser_click': return `${agent} 想在网页上点一下`;
    case 'browser_type': return input?.submit === true ? `${agent} 想在网页上输入并提交` : `${agent} 想在网页上输入文字`;
    case 'browser_press_key': return `${agent} 想在网页上按键`;
    case 'browser_scroll': return `${agent} 想滚动网页`;
    case 'browser_back': return `${agent} 想让网页返回上一页`;
    case 'browser_screenshot': return `${agent} 想给网页截图`;
    case 'browser_computer': {
      const action = str(input, 'action');
      if (action === 'screenshot') return `${agent} 想给网页截图`;
      if (action === 'type') return `${agent} 想在网页上输入文字`;
      if (action === 'key') return `${agent} 想在网页上按键`;
      if (action === 'scroll') return `${agent} 想滚动网页`;
      if (action === 'wait') return `${agent} 想等网页一会儿`;
      if (action === 'left_click_drag') return `${agent} 想在网页上拖动鼠标`;
      if (action === 'mouse_move') return `${agent} 想在网页上移动鼠标`;
      return `${agent} 想用鼠标点网页上的一个位置`;
    }
    case 'character_assign': return input?.id === null ? `${agent} 想把${targetText(str(input, 'target'))}换回默认形象` : `${agent} 想把角色 ${str(input, 'id')} 给${targetText(str(input, 'target'))}`;
    case 'character_guide': case 'character_draft': case 'character_save': case 'character_list': return `${agent} 想改网吧的角色库`;
  }
}
