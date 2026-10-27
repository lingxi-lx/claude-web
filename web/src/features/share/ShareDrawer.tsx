import { useCallback, useEffect, useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { dlg } from '@/ui/dialog';
import type { ShareKeyView, ShareQuota, ShareRules, ShareStatus } from '@shared';
import { tr } from '@/i18n';

const PERIODS = [
  { k: 'daily', label: () => tr('每天') },
  { k: 'weekly', label: () => tr('每周') },
  { k: 'monthly', label: () => tr('每月') },
] as const;

const numOr = (v: string): number | undefined => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const quotaText = (q?: ShareQuota) => [q?.requests ? tr('{n} 次', { n: q.requests }) : '', q?.tokens ? tr('{n} token', { n: q.tokens }) : ''].filter(Boolean).join(' / ');

/** One share key's rules: sources, models, concurrency, quotas. */
function RulesEditor({ rules, groups, onSave, onCancel }: { rules: ShareRules; groups: ShareStatus['routeGroups']; onSave(r: ShareRules): void; onCancel(): void }) {
  const [r, setR] = useState<ShareRules>(rules);
  const [models, setModels] = useState((rules.models ?? []).join(', '));
  const setQuota = (k: 'daily' | 'weekly' | 'monthly', f: keyof ShareQuota, v: string) =>
    setR((x) => ({ ...x, [k]: { ...x[k], [f]: numOr(v) } }));
  const picked = new Set(r.routeGroupIds ?? []);
  return (
    <div className="gateway-card" style={{ marginTop: 6 }}>
      <div className="sub">{tr('能用的来源（都不选 = 全部）')}</div>
      <div className="gateway-row" style={{ flexWrap: 'wrap' }}>
        {groups.map((g) => (
          <label key={g.id} className="sub">
            <input type="checkbox" checked={picked.has(g.id)} onChange={(e) => {
              const n = new Set(picked);
              if (e.target.checked) n.add(g.id); else n.delete(g.id);
              setR((x) => ({ ...x, routeGroupIds: [...n] }));
            }} /> {g.name}
          </label>
        ))}
        {groups.length === 0 && <span className="sub">{tr('还没有网关组')}</span>}
      </div>
      <div className="sub">{tr('能用的模型（逗号分隔，可用 *；留空 = 全部）')}</div>
      <input className="input" value={models} onChange={(e) => setModels(e.target.value)} placeholder="claude-*, gpt-5" />
      <div className="gateway-row">
        <span className="sub">{tr('同时进行的请求')}</span>
        <input className="input" type="number" min={0} style={{ width: 90 }} value={r.concurrent ?? ''} onChange={(e) => setR((x) => ({ ...x, concurrent: numOr(e.target.value) }))} />
      </div>
      {PERIODS.map(({ k, label }) => (
        <div className="gateway-row" key={k}>
          <span className="sub" style={{ width: 48 }}>{label()}</span>
          <input className="input" type="number" min={0} style={{ width: 110 }} placeholder={tr('次数')} value={r[k]?.requests ?? ''} onChange={(e) => setQuota(k, 'requests', e.target.value)} />
          <input className="input" type="number" min={0} style={{ width: 140 }} placeholder={tr('token 数')} value={r[k]?.tokens ?? ''} onChange={(e) => setQuota(k, 'tokens', e.target.value)} />
        </div>
      ))}
      <div className="gateway-row">
        <span className="grow" />
        <button className="btn sm ghost" onClick={onCancel}>{tr('取消')}</button>
        <button className="btn sm" onClick={() => onSave({ ...r, models: models.split(/[,，\s]+/).map((m) => m.trim()).filter(Boolean) })}>{tr('保存')}</button>
      </div>
    </div>
  );
}

/**
 * 远程共享: let other machines use this computer's models through share keys — each with its own sources,
 * models, concurrency and quotas. Reaching it from the network is off until turned on here; only model calls
 * are served there, never management. Self-contained: the gateway page mounts it.
 */
export function ShareDrawer() {
  const toast = useStore((s) => s.toast);
  const [st, setSt] = useState<ShareStatus | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [newRules, setNewRules] = useState<ShareRules | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setSt(await ws.request<ShareStatus>({ kind: 'share.status' })); } catch (e: any) { toast(e.message); }
  }, [toast]);
  useEffect(() => {
    void load();
    const off = ws.on((e) => { if (e.kind === 'gateway.changed') void load(); });
    return () => { off(); };
  }, [load]);

  const act = async (req: Parameters<typeof ws.request>[0]) => {
    setBusy(true);
    try { await ws.request(req); await load(); } catch (e: any) { toast(e.message); } finally { setBusy(false); }
  };

  const setLan = async (enabled: boolean) => {
    if (enabled && !(await dlg.confirm(tr('允许局域网里的其它设备用这台电脑的模型？'), { message: tr('只有拿着共享密钥的设备能用；管理功能不会开放。') }))) return;
    await act({ kind: 'share.lan.set', enabled, ...(enabled && st?.lan.bind === '127.0.0.1' ? { bind: st.lan.addresses[0] ?? '127.0.0.1' } : {}) });
  };

  const editAllow = async () => {
    const v = await dlg.prompt(tr('允许连接的地址（IP 或网段，逗号分隔）'), (st?.ipAllowlist ?? []).join(', '));
    if (v === null) return;
    await act({ kind: 'share.lan.set', ipAllowlist: v.split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean) });
  };

  const create = async (rules: ShareRules) => {
    const name = await dlg.prompt(tr('共享密钥的名字'), tr('共享密钥'));
    if (!name) return;
    setBusy(true);
    try {
      const r = await ws.request<{ plaintext: string }>({ kind: 'share.keys.create', name, rules });
      setCreated(r.plaintext);
      setNewRules(null);
      await load();
    } catch (e: any) { toast(e.message); } finally { setBusy(false); }
  };

  const keyRow = (k: ShareKeyView) => {
    const s = k.share ?? {};
    const limits = PERIODS.map(({ k: p, label }) => (s[p] ? `${label()} ${quotaText(s[p])}` : '')).filter(Boolean).join(' · ');
    return (
      <div key={k.id} style={{ marginTop: 8 }}>
        <div className="gateway-row">
          <code>{k.prefix}</code>
          <span className="grow">{k.name}</span>
          {!k.enabled && <span className="sub">{tr('已停用')}</span>}
          <span className="sub">{k.lastUsedAt ? tr('上次使用 {t}', { t: new Date(k.lastUsedAt).toLocaleString() }) : tr('还没用过')}</span>
          <button className="btn sm ghost" onClick={() => setEditing(editing === k.id ? null : k.id)}>{tr('权限和额度')}</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => void act({ kind: 'share.keys.update', id: k.id, patch: { enabled: !k.enabled } })}>{k.enabled ? tr('停用') : tr('启用')}</button>
          <button className="btn sm ghost danger" disabled={busy} onClick={async () => {
            if (await dlg.confirm(tr('删除共享密钥「{name}」？用它的设备会立刻连不上。', { name: k.name }), { danger: true })) await act({ kind: 'share.keys.delete', id: k.id });
          }}>{tr('删除')}</button>
        </div>
        <div className="sub">
          {s.routeGroupIds?.length ? tr('来源：{v}', { v: s.routeGroupIds.map((id) => st?.routeGroups.find((g) => g.id === id)?.name ?? id).join('、') }) : tr('来源：全部')}
          {' · '}{s.models?.length ? tr('模型：{v}', { v: s.models.join(', ') }) : tr('模型：全部')}
          {s.concurrent ? ` · ${tr('同时 {n} 个', { n: s.concurrent })}` : ''}
          {limits ? ` · ${limits}` : ''}
        </div>
        <div className="sub">{tr('今天 {r} 次 / {t} token · 本周 {wr} 次 · 本月 {mr} 次', { r: k.usage.todayRequests, t: k.usage.todayTokens, wr: k.usage.weekRequests, mr: k.usage.monthRequests })}</div>
        {editing === k.id && st && (
          <RulesEditor rules={s} groups={st.routeGroups} onCancel={() => setEditing(null)} onSave={(rules) => { setEditing(null); void act({ kind: 'share.keys.update', id: k.id, patch: { rules } }); }} />
        )}
      </div>
    );
  };

  if (!st) return <div className="gateway-tab cw-share" />;
  return (
    <div className="gateway-tab cw-share">
      <div className="gateway-card">
        <div className="gateway-row">
          <b>{tr('局域网共享')}</b>
          <span className="sub">{st.lan.running ? tr('已开启') : tr('未开启')}</span>
          <span className="grow" />
          <button className="btn sm" disabled={busy} onClick={() => void setLan(!st.lan.enabled)}>{st.lan.enabled ? tr('关闭') : tr('开启')}</button>
        </div>
        {!st.gatewayEnabled && <div className="sub" style={{ color: 'var(--warn)' }}>{tr('模型网关没启用，共享的请求会被拒绝')}</div>}
        {st.endpoints.map((u) => (
          <div className="gateway-row" key={u}>
            <code className="grow">{u}</code>
            <button className="btn sm ghost" onClick={() => { void navigator.clipboard.writeText(u); toast(tr('已复制'), true); }}>{tr('复制')}</button>
          </div>
        ))}
        {st.lan.enabled && !st.endpoints.length && <div className="sub">{tr('还没有可用的地址')}</div>}
        <div className="gateway-row">
          <span className="sub grow">{tr('允许连接：{v}', { v: st.ipAllowlist.join('、') || tr('无') })}</span>
          <button className="btn sm ghost" disabled={busy} onClick={() => void editAllow()}>{tr('修改')}</button>
        </div>
        <div className="sub">{tr('其它设备用「地址 + 共享密钥」连接；OpenAI 格式的客户端在地址后加 /v1。')}</div>
      </div>

      {created && (
        <div className="gateway-card" style={{ marginTop: 10, border: '1px solid var(--warn)' }}>
          <div className="sub">{tr('新密钥只显示这一次，复制保存好：')}</div>
          <code className="gw-secret">{created}</code>
          <div className="gateway-row">
            <button className="btn sm" onClick={() => { void navigator.clipboard.writeText(created); toast(tr('已复制'), true); }}>{tr('复制')}</button>
            <button className="btn sm ghost" onClick={() => setCreated(null)}>{tr('知道了')}</button>
          </div>
        </div>
      )}

      <div className="gateway-card" style={{ marginTop: 10 }}>
        <div className="gateway-row">
          <b>{tr('共享密钥')}</b>
          <span className="grow" />
          <button className="btn sm" disabled={busy} onClick={() => setNewRules(newRules ? null : {})}>{tr('新建共享密钥')}</button>
        </div>
        {newRules && <RulesEditor rules={newRules} groups={st.routeGroups} onCancel={() => setNewRules(null)} onSave={(r) => void create(r)} />}
        {st.keys.length === 0 && !newRules && <div className="sub">{tr('还没有共享密钥')}</div>}
        {st.keys.map(keyRow)}
      </div>
    </div>
  );
}
