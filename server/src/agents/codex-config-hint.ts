import { tr } from '../i18n/index.js';

/** Terminal colour / cursor codes (Codex's log lines carry them): shown in the page they are noise. */
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(\u0007|\u001b\\)/g;
export const stripAnsi = (s: string) => s.replace(ANSI, '');

/**
 * Codex could not read its configuration (2026-10-17: a model catalog written by another tool — codexmate's router
 * puts `model_catalog_json` in ~/.codex/config.toml — lacked a field the newer Codex requires). Codex stops there, and so
 * does every Codex conversation, in this app and in its own CLI: say which setting, in which file, and how to get going
 * again. The file is the user's (or that tool's): nothing here changes it. null when the error is something else.
 */
export function codexConfigHint(text: string): string | null {
  const t = stripAnsi(text);
  if (!/failed to (load|parse) configuration|Invalid configuration|failed to parse \w+ path|config\.toml/i.test(t)) return null;
  const catalog = /model_catalog_json path\s+`?([^`\n]+?)`?\s+as JSON:\s*([^\n]+?)(?:\s+at line \d+ column \d+)?\s*(?:\n|$)/i.exec(t);
  if (catalog) {
    const [, file, why] = catalog;
    const by = /codexmate/i.test(file) ? tr('（这个文件是 codexmate 的路由写的）') : '';
    return tr('Codex 读不了自己的配置：~/.codex/config.toml 里的 model_catalog_json 指向的 {file}{by} 和现在装的 Codex 版本对不上（{why}）。Codex 自己的命令行也会一样启动不了。处理：在 codexmate 里关掉路由或把它更新到新版；或者删掉 config.toml 里 model_catalog_json 那一行。改完回到这里点重试。', { file: file.trim(), by, why: why.trim() });
  }
  const at = /(?:in|at|parse)\s+`?([^`\n]*config\.toml)`?/i.exec(t)?.[1];
  return tr('Codex 读不了自己的配置文件{at}：改正它（或先把出错的那几行注释掉）后点重试。Codex 自己的命令行也会一样启动不了。', { at: at ? `（${at.trim()}）` : '' });
}
