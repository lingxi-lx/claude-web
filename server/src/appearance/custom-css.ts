// The user's own stylesheet (GitHub issue #2, 2026-10-13): ~/.claude-web/custom.css, laid over the built-in styles in
// every window (desktop, browser, phone) and reloaded as soon as it is saved. The desktop app updates itself and
// replaces app.asar, so this is where a tweak survives an update. The window puts it last (web/src/app/custom-css.tsx).
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { dataDir } from '../files/service.js';
import { tr } from '../i18n/index.js';

/** A stylesheet bigger than this is not loaded (a pasted bundle, a wrong file renamed). */
export const CUSTOM_CSS_MAX_BYTES = 512 * 1024;

export interface CustomCss {
  path: string;
  exists: boolean;
  /** the text, when it exists and is not too big */
  css: string;
  size: number;
  mtime: number;
  error?: string;
}

/** What a new custom.css starts with: what it is for, the hooks the app keeps stable, an example. */
export function customCssTemplate(): string {
  const lines = [
    tr('Claude Web 自定义样式'),
    '',
    tr('这个文件在内置样式之后加载，保存后所有窗口立即生效（桌面版、浏览器、手机）。应用更新不会动它。'),
    tr('改坏了：删掉这里的规则，或者给文件改个名；也可以在 设置 → 外观 → 自定义样式 里先关掉。'),
    '',
    tr('可以放心用的钩子（以后的版本保持不变）：'),
    `  html[data-theme="light" | "dark"]      ${tr('主题')}`,
    `  html[lang="zh-CN" | "en"]              ${tr('界面语言')}`,
    `  .chat[data-state]                      ${tr('对话的状态')}: starting / running / waiting / idle / history / closed / error`,
    `  .todos[data-done][data-total]          ${tr('每一份计划（右侧面板「任务」里的，和对话里的），还带 --progress（比如 43%）')}`,
    `  .todos > li[data-status]               ${tr('计划的每一项')}: pending / in_progress / completed`,
    `  .tasks-plan .plan-head                 ${tr('右侧面板「任务」里计划的标题行（data-done / data-total / --progress）')}`,
    `  .tasks-plan .plan-prog > i             ${tr('标题行下面的进度条')}`,
    `  .goal-h .prog > div                    ${tr('目标卡片上的进度条')}`,
    `  --accent, --ink-1…4, --surface-0…3, --edge, --r-sm / --r-md / --r-lg   ${tr('颜色、圆角这些都是 CSS 变量')}`,
    '',
    tr('例子：计划的进度条粗一点、换个颜色（去掉下面的注释就生效）'),
  ];
  const head = lines.map((l) => (l ? ` * ${l}` : ' *')).join('\n');
  const example = ['/*', '.tasks-plan .plan-prog { height: 6px; }', '.tasks-plan .plan-prog > i { background: var(--accent); }', '*/'].join('\n');
  return `/*\n${head}\n */\n\n${example}\n`;
}

export class CustomCssService extends EventEmitter {
  readonly file = path.join(dataDir(), 'custom.css');
  private watcher: fs.FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;

  read(): CustomCss {
    try {
      const st = fs.statSync(this.file);
      if (st.size > CUSTOM_CSS_MAX_BYTES) return { path: this.file, exists: true, css: '', size: st.size, mtime: st.mtimeMs, error: tr('custom.css 太大（超过 512 KB），没有加载') };
      return { path: this.file, exists: true, css: fs.readFileSync(this.file, 'utf8'), size: st.size, mtime: st.mtimeMs };
    } catch {
      return { path: this.file, exists: false, css: '', size: 0, mtime: 0 };
    }
  }

  /** Make the file with the template when it is not there; its path either way. */
  create(): string {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, customCssTemplate(), 'utf8');
    return this.file;
  }

  /** Watch the data folder (the file may come and go); 'changed' once per burst of writes. */
  watch(): void {
    if (this.watcher) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      this.watcher = fs.watch(path.dirname(this.file), (_e, name) => {
        if (name && String(name).toLowerCase() !== 'custom.css') return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.timer = null; this.emit('changed'); }, 120);
      });
      this.watcher.on('error', () => { /* the folder went away: no live reload until restart */ });
      this.watcher.unref?.();
    } catch { /* no watching on this system: a reload of the window still picks it up */ }
  }

  close(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) clearTimeout(this.timer);
  }
}
