import type { ToolUseBlock } from '@/model/conversation';
import { useStore } from '@/store';
import { CodeBlock } from '../CodeBlock';
import { Expandable } from '../Expandable';
import { ImageGrid } from './McpTool';
import { tr } from '@/i18n';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\r(?!\n)/g;
export const stripAnsi = (s: string) => s.replace(ANSI, '');

export function ShellBody({ t }: { t: ToolUseBlock }) {
  const inp = t.input as any;
  const r = t.result;
  const st = r?.structured as any;
  const cmd = String(inp.command ?? '');
  const stdout = st?.stdout !== undefined ? String(st.stdout) : r ? r.content : '';
  const stderr = st?.stderr ? String(st.stderr) : '';
  const bg = st?.backgroundTaskId;
  const openTasks = () => { const s = useStore.getState(); if (!s.panels.includes('tasks')) s.togglePanel('tasks'); };
  return (
    <>
      <CodeBlock code={cmd} lang={t.name === 'PowerShell' ? 'powershell' : 'bash'} title={inp.description ? String(inp.description) : tr('命令')} wrap maxLines={30} />
      {inp.timeout && <div className="tool-meta">timeout {Math.round(Number(inp.timeout) / 1000)}s{inp.run_in_background ? tr(' · 后台运行') : ''}</div>}
      {r?.images?.length ? <ImageGrid images={r.images} /> : null}
      {(st?.interrupted || st?.timedOutAfterMs || bg) && (
        <div className="tool-badges">
          {st?.interrupted && <span className="badge warn">{tr('已中断')}</span>}
          {st?.timedOutAfterMs && <span className="badge warn">{tr('超时 {timedOutAfterMs}s，已转后台', { timedOutAfterMs: Math.round(st.timedOutAfterMs / 1000) })}</span>}
          {bg && <button className="badge link" onClick={openTasks} title={tr('在任务面板查看')}>{tr('后台任务 {bg}', { bg: String(bg).slice(0, 8) })}</button>}
        </div>
      )}
      {r && !bg && stdout.trim() === '' && !stderr.trim() && !r.isError && <div className="tool-meta">{tr('（无输出）')}</div>}
      {stdout.trim() && (
        <Expandable text={stripAnsi(stdout)} lines={40} chars={12000}>
          {(v) => <CodeBlock code={v} lang="plaintext" title={r?.isError ? tr('输出（失败）') : tr('输出')} wrap className={r?.isError ? 'err' : undefined} />}
        </Expandable>
      )}
      {stderr.trim() && (
        <Expandable text={stripAnsi(stderr)} lines={20} chars={6000}>
          {(v) => <CodeBlock code={v} lang="plaintext" title="stderr" wrap className="muted" />}
        </Expandable>
      )}
      {r?.isError && !stdout.trim() && !stderr.trim() && <CodeBlock code={r.content} lang="plaintext" title={tr('错误')} wrap className="err" />}
    </>
  );
}
