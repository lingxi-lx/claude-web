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
  if (p.permissions.fileWrite?.length) out.push(tr('写文件：{paths}', { paths: p.permissions.fileWrite.join('、') }));
  if (p.permissions.childProcess) out.push(tr('启动别的程序'));
  if (p.permissions.workers) out.push(tr('开后台线程'));
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
    // no file access limits here (this Node has no permission model): a separate, explicit opt-in per plugin
    const unrestricted = p.kind === 'executable' && p.isolation === 'process';
    if (unrestricted && p.permissions.secrets?.length) {
      toast(tr('这个插件要用密钥，但这里的 Node 不能限制它读写文件，所以不能运行'));
      return;
    }
    if (p.kind === 'executable' && !p.approved) {
      const ok = await dlg.confirm(tr('启用插件「{name}」？', { name: p.name }), {
        message: p.codeChanged ? tr('插件的代码变了。它会在单独的进程里运行，可以：') : tr('它会在单独的进程里运行，可以：'),
        items: permissionLines(p),
        okLabel: tr('允许并启用'),
      });
      if (!ok) return;
    }
    if (unrestricted && (!p.approved || !p.unrestricted)) {
      const ok = await dlg.confirm(tr('这个插件将能读写你能访问的所有文件'), {
        message: tr('这台电脑上的 Node 不能限制插件读写文件。只在你完全信任「{name}」时继续。', { name: p.name }),
        okLabel: tr('仍然启用'),
        danger: true,
        focusCancel: true,
      });
      if (!ok) return;
      return run({ kind: 'plugins.enable', id: p.id, approve: true, allowUnrestricted: true });
    }
    return run({ kind: 'plugins.enable', id: p.id, ...(p.kind === 'executable' && !p.approved ? { approve: true } : {}) });
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
                {p.isolation === 'permission' ? tr('单独进程，文件访问受限') : p.unrestricted ? tr('单独进程，能读写所有文件') : tr('单独进程')}
                {p.enabled && !p.approved && ` · ${p.codeChanged ? tr('插件的代码变了，要重新确认') : tr('插件的权限变了，要重新确认')}`}
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
