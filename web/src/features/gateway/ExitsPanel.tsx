import { useEffect, useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import type { SidecarGuard, SidecarId, SidecarProxy } from '@shared';
import { tr } from '@/i18n';

/**
 * 出口（住宅 IP）: the proxy pool a sidecar family routes through. Each row is one exit with its own breaker
 * (fail count, cooldown); the component pins accounts to the exit they last used, so an account keeps one IP.
 * Adding an exit here is enough — the component starts using it on the next request.
 */
export function ExitsPanel({ id }: { id: SidecarId }) {
  const toast = useStore((s) => s.toast);
  const [list, setList] = useState<SidecarProxy[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [guard, setGuard] = useState<SidecarGuard | null>(null);

  const load = () => ws.request<SidecarProxy[]>({ kind: 'upstreams.proxies', id }).then(setList).catch(() => setList([]));
  useEffect(() => {
    void load();
    ws.request<SidecarGuard>({ kind: 'upstreams.guard.get', id }).then(setGuard).catch(() => setGuard(null));
  }, [id]);

  const saveGuard = async (patch: Partial<SidecarGuard>) => {
    if (!guard) return;
    setGuard({ ...guard, ...patch });
    try { setGuard(await ws.request<SidecarGuard>({ kind: 'upstreams.guard.set', id, patch })); }
    catch (e: any) { toast(e.message); void ws.request<SidecarGuard>({ kind: 'upstreams.guard.get', id }).then(setGuard).catch(() => {}); }
  };

  const act = async (key: string, fn: () => Promise<SidecarProxy[]>) => {
    setBusy(key);
    try { setList(await fn()); } catch (e: any) { toast(e.message); } finally { setBusy(null); }
  };

  const add = async () => {
    if (!url.trim()) { toast(tr('先填代理地址')); return; }
    await act('add', () => ws.request<SidecarProxy[]>({ kind: 'upstreams.proxies.add', id, input: { name: name.trim() || undefined, url: url.trim() } }));
    setName('');
    setUrl('');
  };

  const enabled = list.filter((p) => p.enabled).length;
  return (
    <div style={{ marginTop: 8 }}>
      <div className="gateway-row">
        <button className="btn sm ghost" onClick={() => setOpen((v) => !v)}>{open ? tr('收起出口') : tr('出口（住宅 IP）')}</button>
        <span className="sub">{list.length ? tr('{n} 个出口，{m} 个启用', { n: list.length, m: enabled }) : tr('没配出口：请求从本机直连出去')}</span>
      </div>
      {open && (
        <div className="list" style={{ marginTop: 6 }}>
          {list.map((p) => (
            <div key={p.id} className="gateway-row" data-exit={p.id}>
              <b>{p.name}</b>
              <span className="sub mono">{p.url}</span>
              {p.failCount > 0 && <span className="gateway-badge bad" title={p.lastError || undefined}>{tr('失败 {n} 次', { n: p.failCount })}</span>}
              {!p.enabled && <span className="gateway-badge">{tr('已停用')}</span>}
              <span className="grow" />
              {p.failCount > 0 && (
                <button className="btn sm ghost" disabled={busy !== null}
                  onClick={() => void act(`reset${p.id}`, () => ws.request<SidecarProxy[]>({ kind: 'upstreams.proxies.reset', id, proxyId: p.id }))}>
                  {tr('重置熔断')}
                </button>
              )}
              <button className="btn sm ghost" disabled={busy !== null}
                onClick={() => void act(`toggle${p.id}`, () => ws.request<SidecarProxy[]>({ kind: 'upstreams.proxies.update', id, proxyId: p.id, patch: { enabled: !p.enabled } }))}>
                {p.enabled ? tr('停用') : tr('启用')}
              </button>
              <button className="btn sm ghost" disabled={busy !== null}
                onClick={() => void act(`remove${p.id}`, () => ws.request<SidecarProxy[]>({ kind: 'upstreams.proxies.remove', id, proxyId: p.id }))}>
                {tr('删除')}
              </button>
            </div>
          ))}
          <div className="gateway-row" style={{ gap: 6, marginTop: 6 }}>
            <input className="field" style={{ maxWidth: 130 }} value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('名称（可留空）')} />
            <input className="field grow" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://user:pass@host:port / socks5://…" />
            <button className="btn sm" disabled={busy !== null} onClick={() => void add()}>{busy === 'add' ? tr('添加中…') : tr('添加出口')}</button>
          </div>
          <div className="sub" style={{ padding: '6px 2px 0' }}>
            {tr('账号会记住用过的出口，之后一直从同一个 IP 出去。连续失败 {n} 次的出口会被组件自动熔断，冷却后放回。', { n: 5 })}
          </div>
          {guard?.supported && (
            <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
              <div className="gateway-row"><b>{tr('防封设置')}</b><span className="sub">{tr('由组件执行，改完立即生效')}</span></div>
              <div className="gateway-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <label className="field" style={{ maxWidth: 130 }}><span>{tr('每个出口并发')}</span>
                  <input type="number" min={0} value={guard.perIpConcurrent} onChange={(e) => void saveGuard({ perIpConcurrent: Number(e.target.value) || 0 })} /></label>
                <label className="field" style={{ maxWidth: 130 }}><span>{tr('每分钟请求')}</span>
                  <input type="number" min={0} value={guard.perIpRpm} onChange={(e) => void saveGuard({ perIpRpm: Number(e.target.value) || 0 })} /></label>
                <label className="field" style={{ maxWidth: 130 }}><span>{tr('每小时请求')}</span>
                  <input type="number" min={0} value={guard.perIpRph} onChange={(e) => void saveGuard({ perIpRph: Number(e.target.value) || 0 })} /></label>
                <label className="field" style={{ maxWidth: 150 }}><span>{tr('出口熔断冷却（分钟）')}</span>
                  <input type="number" min={0} value={guard.proxyCooldownMin} onChange={(e) => void saveGuard({ proxyCooldownMin: Number(e.target.value) || 0 })} /></label>
              </div>
              <label className="chip"><input type="checkbox" checked={guard.fallbackDirect} onChange={(e) => void saveGuard({ fallbackDirect: e.target.checked })} /> {tr('出口全熔断时允许直连（会暴露本机 IP）')}</label>
              <label className="chip"><input type="checkbox" checked={guard.fallbackAnon} onChange={(e) => void saveGuard({ fallbackAnon: e.target.checked })} /> {tr('cookie 失效时降级成匿名')}</label>
              <div style={{ marginTop: 8 }}>
                <label className="chip"><input type="checkbox" checked={guard.multiTurn} onChange={(e) => void saveGuard({ multiTurn: e.target.checked })} /> {tr('多轮续接（后续轮次只发新增内容；历史会留在 Google 账号里。首轮必须低于 128KB，否则这条不生效）')}</label>
              </div>
              <label className="field" style={{ maxWidth: 220, marginTop: 6 }}>
                <span>{tr('超过这个字节数就转成附件上传（0 = 从不转）')}</span>
                <input type="number" min={0} value={guard.maxPromptBytes} onChange={(e) => void saveGuard({ maxPromptBytes: Number(e.target.value) || 0 })} />
              </label>
              <div className="sub" style={{ padding: '4px 2px 0' }}>{tr('组件默认 128000。超过就先上传附件再回答；实测上传本身约 2 秒，真正慢的是模型读这份超长内容并思考，而且 16 万字节以上会超过上游可读上限、末尾被截断（工具格式说明正好在末尾）。调大不是提速办法，优先用精简工具集把首轮压到 128KB 以下。')}</div>
              <div className="sub" style={{ padding: '4px 2px 0' }}>{tr('0 = 不限。默认每个出口并发 5、每分钟 30、每小时 80；出口连续失败熔断后 120 分钟放回。')}</div>
              <div className="sub" style={{ padding: '4px 2px 0' }}>{tr('写代码时选 flash 系列（gemini-3.6-flash、gemini-3.5-flash-lite）；带 thinking 的模型会多花 20–40 秒先思考。')}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
