import { useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import type { SidecarStatus } from '@shared';
import { useGateway } from './state';
import { ExitsPanel } from './ExitsPanel';
import { FAMILY_LABEL } from './tasks-model';
import { tr } from '@/i18n';

/**
 * 连接 Gemini / WorkBuddy: the local component behind those accounts. Adding an account starts / installs it on
 * demand, so this row is mostly a status line; stop / sync / logs stay out of the way.
 */
export function SidecarCard({ s }: { s: SidecarStatus }) {
  const toast = useStore((st) => st.toast);
  const advanced = useGateway((st) => st.advanced);
  const [busy, setBusy] = useState<string | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  const reload = () => useGateway.getState().load().catch(() => {});
  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast(ok, true);
      await reload();
    } catch (e: any) { toast(e.message); } finally { setBusy(null); }
  };
  const state = s.running ? (s.health === 'ok' ? tr('运行中') : tr('启动中')) : s.installed ? tr('未运行') : tr('未安装');
  return (
    <div className="gateway-card" style={{ marginTop: 10 }} data-sidecar={s.id}>
      <div className="gateway-row">
        <b>{FAMILY_LABEL[s.id]}</b>
        <span className={`gateway-badge ${s.running && s.health === 'ok' ? 'ok' : s.health === 'error' ? 'bad' : ''}`}>{state}</span>
        <span className="sub">{s.version ? `v${s.version.replace(/^v/, '')}` : ''}{s.port ? ` · :${s.port}` : ''}</span>
        <span className="grow" />
        {!s.installed && (
          <button className="btn sm ghost" disabled={busy !== null} onClick={() => void act('install', () => ws.request({ kind: 'upstreams.sidecars.install', id: s.id }), tr('已安装'))}>
            {busy === 'install' ? tr('安装中…') : tr('提前安装')}
          </button>
        )}
        {s.installed && !s.running && (
          <button className="btn sm" disabled={busy !== null} onClick={() => void act('start', () => ws.request({ kind: 'upstreams.sidecars.start', id: s.id }), tr('已启动'))}>
            {busy === 'start' ? tr('启动中…') : tr('启动')}
          </button>
        )}
        {advanced && s.running && (
          <button className="btn sm ghost" disabled={busy !== null} onClick={() => void act('stop', () => ws.request({ kind: 'upstreams.sidecars.stop', id: s.id }), tr('已停止'))}>{tr('停止')}</button>
        )}
        {advanced && (
          <button className="btn sm ghost" disabled={busy !== null} onClick={() => void act('sync', () => ws.request({ kind: 'upstreams.sync', id: s.id }), tr('已同步账号'))}>{tr('同步账号')}</button>
        )}
        {s.running && (
          <button className="btn sm ghost" disabled={busy !== null} onClick={() => void act('models', async () => {
            const list = await ws.request<string[]>({ kind: 'upstreams.models.refresh', id: s.id });
            toast(tr('模型列表已更新（{n} 个）', { n: list.length }), true);
          })}>{busy === 'models' ? tr('刷新中…') : tr('刷新模型')}</button>
        )}
        <button className="btn sm ghost" onClick={async () => {
          if (logs !== null) { setLogs(null); return; }
          try { setLogs(await ws.request<string>({ kind: 'upstreams.sidecars.logs', id: s.id, lines: 200 })); }
          catch (e: any) { toast(e.message); }
        }}>{logs !== null ? tr('收起日志') : tr('日志')}</button>
      </div>
      {s.detail && <div className="sub" style={{ color: s.health === 'error' ? 'var(--warn)' : undefined }}>{s.detail}</div>}
      {!s.installed && <div className="sub">{tr('添加这类账号时会自动安装，不用在这里操作。')}</div>}
      {s.id === 'gemini' && s.installed && <ExitsPanel id={s.id} />}
      {logs !== null && (
        <div className="gateway-log">
          <pre className="sub" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{logs || tr('还没有日志')}</pre>
        </div>
      )}
    </div>
  );
}
