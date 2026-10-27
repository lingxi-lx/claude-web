import { useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { dlg } from '@/ui/dialog';
import { useGateway } from './state';
import { KeyEditor } from './KeyEditor';
import type { GatewayKeyGroup } from '@shared';
import { tr } from '@/i18n';

const blank = (): GatewayKeyGroup => ({ id: '', name: '', routeGroupIds: [], allowLan: false, ipAllowlist: [], createdAt: 0 });

/** 密钥: groups first (what a key may do), then the keys themselves. A new key's plaintext is shown once. */
export function KeysTab() {
  const groups = useGateway((s) => s.keyGroups);
  const keys = useGateway((s) => s.keys);
  const toast = useStore((s) => s.toast);
  const [created, setCreated] = useState<string | null>(null);
  const [edit, setEdit] = useState<GatewayKeyGroup | null>(null);
  const reload = () => useGateway.getState().load().catch(() => {});
  const createKey = async (groupId: string) => {
    const name = await dlg.prompt(tr('密钥名称'), tr('新密钥'));
    if (!name) return;
    try {
      const r = await ws.request<{ plaintext: string }>({ kind: 'gateway.keys.create', groupId, name });
      setCreated(r.plaintext);
      await reload();
    } catch (e: any) { toast(e.message); }
  };
  return (
    <div className="gateway-tab">
      {created && (
        <div className="gateway-card" style={{ border: '1px solid var(--warn)' }}>
          <div className="sub">{tr('新密钥只显示这一次，复制保存好：')}</div>
          <code className="gw-secret">{created}</code>
          <div className="row">
            <button className="btn sm" onClick={() => { void navigator.clipboard.writeText(created); toast(tr('已复制'), true); }}>{tr('复制')}</button>
            <button className="btn sm ghost" onClick={() => setCreated(null)}>{tr('知道了')}</button>
          </div>
        </div>
      )}
      <div className="gateway-row">
        <span className="grow">{tr('密钥组')}</span>
        <button className="btn sm" onClick={() => setEdit(blank())}>{tr('新建密钥组')}</button>
      </div>
      {groups.length === 0 && <div className="empty">{tr('还没有密钥组。打开共享后会自动建一个。')}</div>}
      {groups.map((g) => (
        <div className="gateway-card" key={g.id} style={{ marginTop: 10 }}>
          <div className="gateway-row">
            <b>{g.name}</b>
            <span className="sub">{g.allowLan ? tr('允许局域网') : tr('仅本机')}</span>
            <span className="grow" />
            <button className="btn sm ghost" onClick={() => setEdit(g)}>{tr('编辑')}</button>
            <button className="btn sm" onClick={() => void createKey(g.id)}>{tr('新建密钥')}</button>
          </div>
          {keys.filter((k) => k.keyGroupId === g.id).map((k) => (
            <div className="gateway-row" key={k.id}>
              <code>{k.prefix}</code>
              <span className="grow">{k.name}</span>
              <span className="sub">{tr('今天 {n} 次', { n: k.stats?.requests ?? 0 })}</span>
              <button className="btn sm ghost" onClick={async () => {
                await ws.request({ kind: 'gateway.keys.update', id: k.id, patch: { enabled: !k.enabled } }).catch((e) => toast(e.message));
                await reload();
              }}>{k.enabled ? tr('停用') : tr('启用')}</button>
              <button className="btn sm ghost danger" onClick={async () => {
                if (await dlg.confirm(tr('删除密钥「{name}」？', { name: k.name }), { danger: true })) {
                  await ws.request({ kind: 'gateway.keys.remove', id: k.id }).catch((e) => toast(e.message));
                  await reload();
                }
              }}>{tr('删除')}</button>
            </div>
          ))}
          {!keys.some((k) => k.keyGroupId === g.id) && <div className="sub">{tr('这个组还没有密钥')}</div>}
        </div>
      ))}
      {edit && <KeyEditor group={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); }} />}
    </div>
  );
}
