import { useEffect, useState } from 'react';
import { ws } from '@/ws/client';
import { clsx } from '@/util';
import type { ToolInfo } from '@shared';
import { tr } from '@/i18n';

/** Detects the CLI tools agents lean on (git / gh / node / python / uv / docker / VS Code …) with install hints. */
export function ToolsSection() {
  const [tools, setTools] = useState<ToolInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // without the catch a failed detect left 「检测中…」 up forever (tools stayed null)
  const load = () => { setBusy(true); setErr(''); ws.request<ToolInfo[]>({ kind: 'tools.detect' }).then(setTools).catch((e) => { setErr(e.message); setTools((t) => t ?? []); }).finally(() => setBusy(false)); };
  useEffect(load, []);
  return (
    <div className="section">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <h5 style={{ margin: 0 }}>{tr('命令行工具')}</h5>
        <span className="grow" />
        <button className="btn sm ghost" disabled={busy} onClick={load}>{busy ? tr('检测中…') : tr('重新检测')}</button>
      </div>
      <div className="list">
        {(tools ?? []).map((t) => (
          <div key={t.id} className="row" title={t.path}>
            <span className={clsx('dot', t.ok ? 'idle' : 'error')} />
            <div className="grow">
              <div>{t.label} {t.ok && <span className="mono muted" style={{ fontSize: 12 }}>{t.version}</span>}</div>
              <div className="sub">{t.ok ? t.path || tr('在 PATH 中') : tr('未安装 · {hint}', { hint: t.hint })}</div>
            </div>
            {!t.ok && <a className="btn sm ghost" href={t.url} target="_blank" rel="noreferrer">{tr('下载')}</a>}
            {!t.ok && /^winget /.test(t.hint) && <button className="btn sm ghost" onClick={() => navigator.clipboard.writeText(t.hint.split('，')[0])}>{tr('复制命令')}</button>}
          </div>
        ))}
        {!tools && <div className="empty">{tr('检测中…')}</div>}
        {err && <div className="empty" style={{ color: 'var(--red)' }}>{tr('检测失败：{err}', { err })}</div>}
      </div>
    </div>
  );
}
