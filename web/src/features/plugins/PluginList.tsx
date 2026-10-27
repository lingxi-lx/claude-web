import { useCallback, useEffect, useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { dlg } from '@/ui/dialog';
import type { PluginListResult, PluginView } from '@shared';
import { tr } from '@/i18n';

function permissionLines(p: PluginView): string[] {
  const out: string[] = [];
  if (p.permissions.network?.length) out.push(tr('联网：{hosts}', { hosts: p.permissions.network.join('、') }));
  if (p.permissions.fileRead?.length) out.push(tr('读取文件：{paths}', { paths: p.permissions.fileRead.join('、') }));
  if (p.permissions.secrets?.length) out.push(tr('使用密钥：{names}', { names: p.permissions.secrets.join('、') }));
  if (!out.length) out.push(tr('不联网、不读其它文件、不用密钥'));
  return out;
}

/**
 * Plugins under <data folder>/plugins: JSON source definitions (data only) and executable plugins (their own
 * process, declared permissions). Self-contained: the gateway page mounts it.
 */
export function PluginList() {
  const toast = useStore((s) => s.toast);
  const [data, setData] = useState<PluginListResult | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (req: Parameters<typeof ws.request>[0]) => {
    setBusy(true);
    try { setData(await ws.request<PluginListResult>(req)); } catch (e: any) { toast(e.message); } finally { setBusy(false); }
  }, [toast]);
  useEffect(() => { void run({ kind: 'plugins.list' }); }, [run]);

  const enable = async (p: PluginView) => {
    if (p.kind === 'executable' && !p.approved) {
      const ok = await dlg.confirm(tr('启用插件「{name}」？', { name: p.name }), {
        message: tr('它会在单独的进程里运行，可以：'),
        items: permissionLines(p),
        okLabel: tr('允许并启用'),
      });
      if (!ok) return;
      return run({ kind: 'plugins.enable', id: p.id, approve: true });
    }
    return run({ kind: 'plugins.enable', id: p.id });
  };
  const remove = async (p: PluginView) => {
    if (await dlg.confirm(tr('删除插件「{name}」？文件会一起删掉。', { name: p.name }), { danger: true })) await run({ kind: 'plugins.remove', id: p.id });
  };

  return (
    <div className="gateway-tab cw-plugins">
      <div className="gateway-row">
        <span className="grow">{tr('插件')}</span>
        <button className="btn sm ghost" disabled={busy} onClick={() => void run({ kind: 'plugins.reload' })}>{tr('重新读取')}</button>
      </div>
      <div className="sub">{tr('把来源定义（.json）或插件文件夹放进这个文件夹：{dir}', { dir: data?.dir ?? '' })}</div>
      {data?.warnings.map((w) => <div className="sub" key={w} style={{ color: 'var(--warn)' }}>{w}</div>)}
      {data && data.plugins.length === 0 && <div className="empty">{tr('还没有插件')}</div>}
      {data?.plugins.map((p) => (
        <div className="gateway-card" key={`${p.kind}:${p.id}`} style={{ marginTop: 10 }}>
          <div className="gateway-row">
            <b>{p.name}</b>
            {p.version && <span className="sub">{p.version}</span>}
            <span className="sub">{p.kind === 'declarative' ? tr('来源定义') : tr('可执行插件')}</span>
            <span className="grow" />
            {p.enabled
              ? <button className="btn sm ghost" disabled={busy} onClick={() => void run({ kind: 'plugins.disable', id: p.id })}>{tr('停用')}</button>
              : <button className="btn sm" disabled={busy || !!p.error && p.sources === 0 && p.kind === 'declarative'} onClick={() => void enable(p)}>{tr('启用')}</button>}
            <button className="btn sm ghost danger" disabled={busy} onClick={() => void remove(p)}>{tr('删除')}</button>
          </div>
          {p.description && <div className="sub">{p.description}</div>}
          {(p.sources > 0 || p.kind === 'declarative') && <div className="sub">{tr('{s} 个来源，{m} 个模型', { s: p.sources, m: p.models })}</div>}
          {p.kind === 'executable' && (
            <>
              <div className="sub">{permissionLines(p).join(' · ')}</div>
              <div className="sub">
                {p.isolation === 'permission' ? tr('单独进程，文件访问受限') : tr('单独进程')}
                {p.enabled && !p.approved && ` · ${tr('插件的权限变了，要重新确认')}`}
                {p.running && ` · ${tr('运行中')}`}
              </div>
            </>
          )}
          {p.error && <div className="sub" style={{ color: 'var(--danger)' }}>{p.error}</div>}
          {p.lastOutput && <pre className="sub" style={{ maxHeight: 120, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{p.lastOutput}</pre>}
        </div>
      ))}
    </div>
  );
}
