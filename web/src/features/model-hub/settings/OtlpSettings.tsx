import { useEffect, useState } from 'react';
import type { OtlpView } from '@shared';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { tr } from '@/i18n';

/** the value the server reads as "keep the stored one" (telemetry/types.ts OTLP_MASK) */
const MASK = '••••••';
const when = (t: number) => new Date(t).toLocaleString();

interface HeaderRow { name: string; value: string }

/** 设置 → 导出到 OpenTelemetry: endpoint, headers (kept encrypted, shown as dots), traces / metrics, a test send. */
export function OtlpSettings() {
  const toast = useStore((s) => s.toast);
  const [view, setView] = useState<OtlpView | null>(null);
  const [endpoint, setEndpoint] = useState('');
  const [rows, setRows] = useState<HeaderRow[]>([]);
  const [busy, setBusy] = useState(false);

  const adopt = (v: OtlpView) => {
    setView(v);
    setEndpoint(v.endpoint);
    setRows(v.headerNames.map((name) => ({ name, value: MASK })));
  };
  useEffect(() => {
    let live = true;
    ws.request<OtlpView>({ kind: 'telemetry.otlp.get' }).then((v) => { if (live) adopt(v); }, () => {});
    return () => { live = false; };
  }, []);

  const save = async (patch: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const headers: Record<string, string> = {};
      for (const r of rows) if (r.name.trim()) headers[r.name.trim()] = r.value;
      adopt(await ws.request<OtlpView>({ kind: 'telemetry.otlp.set', patch: { endpoint, headers, ...patch } }));
      toast(tr('已保存'), true);
    } catch (e: any) { toast(e.message); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true);
    try {
      setView(await ws.request<OtlpView>({ kind: 'telemetry.otlp.test' }));
      toast(tr('测试数据已发送'), true);
    } catch (e: any) { toast(e.message); } finally { setBusy(false); }
  };
  const row = (i: number, k: keyof HeaderRow, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  if (!view) return null;
  const dirty = endpoint !== view.endpoint || rows.some((r) => r.value !== MASK) || rows.length !== view.headerNames.length;
  return (
    <div className="gateway-tab cw-otlp">
      <div className="gateway-card">
        <div className="gateway-row">
          <b>{tr('导出到 OpenTelemetry')}</b>
          <span className="sub">{tr('把每次请求的模型、来源、耗时、token 数和状态发到你的 OTLP 收集器；不含对话内容和密钥。')}</span>
          <span className="grow" />
          <button
            type="button"
            role="switch"
            aria-checked={view.enabled}
            aria-label={tr('导出到 OpenTelemetry')}
            className={`hub-switch ${view.enabled ? 'on' : ''}`}
            disabled={busy}
            onClick={() => void save({ enabled: !view.enabled })}
          />
        </div>
        <div className="gateway-row">
          <span className="sub" style={{ minWidth: 90 }}>{tr('地址')}</span>
          <input className="input grow" placeholder="http://localhost:4318" value={endpoint} disabled={busy} onChange={(e) => setEndpoint(e.target.value)} />
        </div>
        {rows.map((r, i) => (
          <div className="gateway-row" key={i}>
            <span className="sub" style={{ minWidth: 90 }}>{tr('请求头')}</span>
            <input className="input" placeholder="authorization" value={r.name} disabled={busy} onChange={(e) => row(i, 'name', e.target.value)} autoComplete="off" />
            <input className="input grow" type="password" value={r.value} disabled={busy} onFocus={() => { if (r.value === MASK) row(i, 'value', ''); }} onChange={(e) => row(i, 'value', e.target.value)} autoComplete="new-password" />
            <button className="btn sm ghost" disabled={busy} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>{tr('删除')}</button>
          </div>
        ))}
        <div className="gateway-row">
          <button className="btn sm ghost" disabled={busy || rows.length >= 20} onClick={() => setRows((rs) => [...rs, { name: '', value: '' }])}>{tr('添加请求头')}</button>
          <label className="sub"><input type="checkbox" checked={view.traces} disabled={busy} onChange={(e) => void save({ traces: e.target.checked })} /> {tr('请求链路（traces）')}</label>
          <label className="sub"><input type="checkbox" checked={view.metrics} disabled={busy} onChange={(e) => void save({ metrics: e.target.checked })} /> {tr('指标（metrics）')}</label>
          <span className="grow" />
          <button className="btn sm" disabled={busy} onClick={() => void save()}>{tr('保存')}</button>
          <button className="btn sm" disabled={busy || dirty || !view.endpoint} onClick={() => void test()}>{tr('发送测试数据')}</button>
        </div>
        {view.auditOff && <div className="sub" style={{ color: 'var(--warn)' }}>{tr('请求记录已关闭，没有可导出的数据。')}</div>}
        {view.lastError && <div className="sub" style={{ color: 'var(--warn)' }}>{view.lastError}</div>}
        {view.enabled && (
          <div className="sub">
            {view.lastExportAt ? tr('上次导出：{time}', { time: when(view.lastExportAt) }) : tr('还没有导出过')}
            {` · ${tr('已导出 {n} 条', { n: view.exported })}`}
            {view.dropped ? ` · ${tr('丢弃 {n} 条', { n: view.dropped })}` : ''}
          </div>
        )}
        <div className="sub">{tr('请求头保存后加密存放，只显示圆点。收集器可以在本机或局域网。')}</div>
      </div>
    </div>
  );
}
