import { useEffect, useMemo, useRef, useState } from 'react';
import type { GatewayAuditLine, LedgerEntry } from '@shared';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { useGateway } from '@/features/gateway/state';
import { openAddSource } from '@/features/gateway/add-source';
import { Icon } from '@/ui/icons';
import { Select } from '@/ui/Select';
import { clsx, fmtMs, fmtTok, fmtUsd, shortModel } from '@/util';
import { dateLocale, tr } from '@/i18n';
import { showHubPage } from '../state';

const DAY = 86_400_000;
const AUDIT_LIMIT = 5000;

/** An area sparkline: requests per bucket, failures per bucket, tokens per bucket. */
function Spark({ data, small }: { data: number[]; small?: boolean }) {
  const points = data.length ? data : [0];
  const w = 300;
  const h = 100;
  const max = Math.max(1, ...points);
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const xy = points.map((v, i) => [i * step, h - 3 - (v / max) * (h - 8)] as const);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg className={small ? 'hub-spark-sm' : 'hub-spark'} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      {!small && <path className="area" d={`${line} L${w},${h} L0,${h} Z`} />}
      <path className="line" d={line} />
    </svg>
  );
}

function Trend({ label, value, delta, up, spark }: { label: string; value: string; delta?: string; up?: boolean; spark?: number[] }) {
  return (
    <div className="hub-trend">
      <div className="t">{label}</div>
      <div className="v">
        {value}
        {delta && <span className={clsx('d', up ? 'up' : 'down')}>{delta}</span>}
      </div>
      {spark && <Spark data={spark} small />}
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'up' | 'down' }) {
  return (
    <div className="hub-card hub-kpi">
      <div className="l">{label}</div>
      <div className="n">{value}</div>
      <div className={clsx('s', tone)}>{sub}</div>
    </div>
  );
}

const rate = (ok: number, all: number) => (all ? `${((ok / all) * 100).toFixed(1)}%` : '—');
const deltaText = (cur: number, prev: number): string | undefined => {
  if (!prev) return undefined;
  const d = ((cur - prev) / prev) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
};
const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Requests / error series over the last `days` days, oldest first. */
function auditSeries(rows: GatewayAuditLine[], days: number, pick: (rows: GatewayAuditLine[]) => number): number[] {
  const byDay = new Map<string, GatewayAuditLine[]>();
  for (const r of rows) {
    const k = dayKey(r.ts);
    const list = byDay.get(k);
    if (list) list.push(r);
    else byDay.set(k, [r]);
  }
  const out: number[] = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) out.push(pick(byDay.get(dayKey(start.getTime() - i * DAY)) ?? []));
  return out;
}

function ledgerSeries(rows: LedgerEntry[], days: number, pick: (rows: LedgerEntry[]) => number): number[] {
  const byDay = new Map<string, LedgerEntry[]>();
  for (const r of rows) {
    const k = dayKey(r.ts);
    const list = byDay.get(k);
    if (list) list.push(r);
    else byDay.set(k, [r]);
  }
  const out: number[] = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) out.push(pick(byDay.get(dayKey(start.getTime() - i * DAY)) ?? []));
  return out;
}

const ledgerTokens = (rows: LedgerEntry[]) => rows.reduce((n, r) => n + r.input + r.output + r.cacheRead + r.cacheWrite, 0);
const ledgerCost = (rows: LedgerEntry[]) => rows.reduce((n, r) => n + r.costUsd, 0);
const cachePct = (rows: LedgerEntry[]) => {
  const base = rows.reduce((n, r) => n + r.input + r.cacheRead + r.cacheWrite, 0);
  const hit = rows.reduce((n, r) => n + r.cacheRead, 0);
  return base ? (hit / base) * 100 : 0;
};

/**
 * 概览 (spec §6.1): four KPIs, the request curve, six today's trends, gateway intel, the last 300 seconds of the
 * gateway and the model ranking. Everything here is read-only; refresh is the hub header's ↻ (and a 5 s poll while
 * the page is in front).
 */
export function OverviewPage() {
  const logs = useGateway((s) => s.logs);
  const accounts = useGateway((s) => s.accounts);
  const sources = useGateway((s) => s.sources);
  const catalog = useGateway((s) => s.catalog);
  const status = useGateway((s) => s.status);
  const providers = useStore((s) => s.providers);
  const engine = useStore((s) => s.engine);
  const openSettings = useStore((s) => s.openSettings);
  const [audit, setAudit] = useState<GatewayAuditLine[] | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [span, setSpan] = useState(30);
  const [metric, setMetric] = useState<'requests' | 'failed'>('requests');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    let lastLedger = 0;
    const tick = async () => {
      // the page stays mounted while another hub page is in front: do not poll from behind `hidden`
      if (!root.current || root.current.offsetParent === null) return;
      try {
        const rows = await ws.request<GatewayAuditLine[]>({ kind: 'gateway.audit.list', limit: AUDIT_LIMIT });
        if (alive) setAudit(rows);
      } catch { /* audit off / an older peer: the page still uses what useGateway has */ }
      if (Date.now() - lastLedger > 12_000) {
        lastLedger = Date.now();
        try {
          const rows = await ws.request<LedgerEntry[]>({ kind: 'ledger.list', days: 2 });
          if (alive) setLedger(rows);
        } catch { /* no ledger yet */ }
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  const rows = useMemo(() => (audit && audit.length ? audit : logs).slice().sort((a, b) => a.ts - b.ts), [audit, logs]);
  const todayStart = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }, []);
  const today = useMemo(() => rows.filter((r) => r.ts >= todayStart), [rows, todayStart]);
  const yesterday = useMemo(() => rows.filter((r) => r.ts >= todayStart - DAY && r.ts < todayStart), [rows, todayStart]);
  const ledgerToday = useMemo(() => (ledger ?? []).filter((r) => r.ts >= todayStart), [ledger, todayStart]);

  const okToday = today.filter((r) => r.status < 400).length;
  const okYesterday = yesterday.filter((r) => r.status < 400).length;
  const errorsToday = today.filter((r) => r.status >= 400).length;
  const avgToday = today.length ? today.reduce((n, r) => n + r.ms, 0) / today.length : 0;
  const todayTokens = ledger?.length ? ledgerTokens(ledgerToday) : today.reduce((n, r) => n + r.tokensIn + r.tokensOut, 0);
  const todayCost = ledgerCost(ledgerToday);
  const costUnknown = ledgerToday.some((r) => r.costUnknown && (r.input || r.output || r.cacheRead));

  const reqSeries = useMemo(() => auditSeries(rows, span, (list) => list.length), [rows, span]);
  const failSeries = useMemo(() => auditSeries(rows, span, (list) => list.filter((r) => r.status >= 400).length), [rows, span]);
  const chart = metric === 'requests' ? reqSeries : failSeries;

  const trendReq = useMemo(() => auditSeries(rows, 14, (list) => list.length), [rows]);
  const trendErr = useMemo(() => auditSeries(rows, 14, (list) => list.filter((r) => r.status >= 400).length), [rows]);
  const trendLat = useMemo(() => auditSeries(rows, 14, (list) => (list.length ? list.reduce((n, r) => n + r.ms, 0) / list.length : 0)), [rows]);
  const trendOk = useMemo(() => auditSeries(rows, 14, (list) => (list.length ? (list.filter((r) => r.status < 400).length / list.length) * 100 : 0)), [rows]);
  const trendTok = useMemo(() => ledgerSeries(ledger ?? [], 14, ledgerTokens), [ledger]);
  const trendCache = useMemo(() => ledgerSeries(ledger ?? [], 14, cachePct), [ledger]);

  const reqDelta = deltaText(today.length, yesterday.length);
  const okDelta = deltaText(okToday / Math.max(1, today.length), okYesterday / Math.max(1, yesterday.length));

  // the gateway's slice of the last 300 s: 2xx / 4xx / 5xx and the peak per-minute rate
  const recent = useMemo(() => {
    const now = Date.now();
    const since = now - 300_000;
    const list = rows.filter((r) => r.ts >= since);
    let ok = 0;
    let c4 = 0;
    let c5 = 0;
    const buckets = new Array(30).fill(0) as number[];
    for (const r of list) {
      if (r.status >= 500) c5++;
      else if (r.status >= 400) c4++;
      else ok++;
      const i = Math.min(29, Math.max(0, Math.floor((r.ts - since) / 10_000)));
      buckets[i]++;
    }
    const peak = Math.max(0, ...buckets) * 6;
    return { ok, c4, c5, total: list.length, peak, buckets };
  }, [rows]);

  const ranking = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of today) m.set(r.model || '-', (m.get(r.model || '-') ?? 0) + r.tokensIn + r.tokensOut);
    const all = [...m.values()].reduce((n, v) => n + v, 0);
    return { all, rows: [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6) };
  }, [today]);

  const noUpstreams = accounts.length === 0 && providers.length === 0 && !sources.some((s) => s.kind === 'engine');
  const localPort = status?.localPort ?? Number(status?.localBaseUrl?.match(/:(\d+)/)?.[1] ?? 0);
  const gwPort = Number(status?.baseUrl?.match(/:(\d+)/)?.[1] ?? 0);

  if (noUpstreams) {
    return (
      <div className="hub-body" ref={root}>
        <div className="hub-guide hub-card">
          <span className="hub-guide-icon"><Icon name="gateway" size={22} /></span>
          <h3>{tr('先添加一个上游')}</h3>
          <p>{tr('概览会显示来源的健康、请求曲线和用量。接一个模型或登录一个账号就能开始。')}</p>
          <button className="btn" onClick={() => openAddSource(undefined, () => { void useGateway.getState().load().catch(() => {}); })}><Icon name="plus" size={13} /> {tr('添加上游')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="hub-body" ref={root}>
      <div className="hub-kpis">
        <Kpi label={tr('总请求')} value={rows.length.toLocaleString()} sub={audit && audit.length >= AUDIT_LIMIT ? tr('最近 {n} 条记录', { n: AUDIT_LIMIT.toLocaleString() }) : tr('全部时间')} />
        <Kpi label={tr('今日')} value={today.length.toLocaleString()} sub={reqDelta ? tr('较昨天 {d}', { d: reqDelta }) : tr('今天')} tone={reqDelta?.startsWith('+') ? 'up' : reqDelta ? 'down' : undefined} />
        <Kpi label={tr('成功率')} value={rate(okToday, today.length)} sub={okDelta ? tr('较昨天 {d}', { d: okDelta }) : tr('今天')} tone={okDelta?.startsWith('+') ? 'up' : okDelta ? 'down' : undefined} />
        <Kpi label={tr('平均延迟')} value={today.length ? fmtMs(avgToday) : '—'} sub={tr('今天')} />
      </div>

      <div className="hub-grid-2 hub-overview">
        <div className="hub-stack">
          <section className="hub-card">
            <div className="hd">
              <h3>{tr('最近请求')}</h3>
              <span className="hub-grow" />
              <div className="hub-seg" role="tablist" aria-label={tr('图表内容')}>
                <button role="tab" aria-selected={metric === 'requests'} className={metric === 'requests' ? 'on' : ''} onClick={() => setMetric('requests')}>{tr('总请求')}</button>
                <button role="tab" aria-selected={metric === 'failed'} className={metric === 'failed' ? 'on' : ''} onClick={() => setMetric('failed')}>{tr('失败')}</button>
              </div>
              <Select className="field hub-span-select" value={String(span)} onValueChange={(v) => setSpan(Number(v))} aria-label={tr('时间范围')} options={[{ value: '7', label: tr('近 7 天') }, { value: '30', label: tr('近 30 天') }]} />
            </div>
            <div className="bd">
              <Spark data={chart} />
              <div className="hub-today-usage">
                <span>{tr('今日用量')}</span>
                <b>{tr('{tokens} tokens', { tokens: fmtTok(todayTokens) })}</b>
                <span>·</span>
                <b>{costUnknown && !todayCost ? tr('费用未知') : fmtUsd(todayCost)}</b>
              </div>
              <div className="hub-table-wrap">
                <table className="hub-table">
                  <thead>
                    <tr><th>{tr('时间')}</th><th>{tr('模型')}</th><th>{tr('来源')}</th><th>{tr('状态')}</th><th>{tr('延迟')}</th></tr>
                  </thead>
                  <tbody>
                    {today.slice(-6).reverse().map((r, i) => (
                      <tr key={`${r.ts}-${i}`}>
                        <td className="hub-mono">{new Date(r.ts).toLocaleTimeString(dateLocale(), { hour12: false })}</td>
                        <td title={r.model}>{shortModel(r.model) || '-'}</td>
                        <td title={r.member}>{r.member || '-'}</td>
                        <td><span className={clsx('hub-chip', r.status >= 400 ? 'danger' : 'green')}>{r.status}</span></td>
                        <td className="hub-mono">{fmtMs(r.ms)}</td>
                      </tr>
                    ))}
                    {!today.length && <tr><td colSpan={5} className="hub-empty-cell">{tr('今天还没有请求')}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="hub-card">
            <div className="hd">
              <h3>{tr('网关请求（最近 300 秒）')}</h3>
              <span className="hub-grow" />
              <span className="hub-muted hub-sml">{tr('峰值 {n} 次/分', { n: recent.peak })}</span>
            </div>
            <div className="bd">
              <div className="hub-legend">
                <span><i className="ok" />2xx {recent.ok}</span>
                <span><i className="warn" />4xx {recent.c4}</span>
                <span><i className="bad" />5xx {recent.c5}</span>
                <span className="grow" />{tr('总计 {n}', { n: recent.total })}
              </div>
              <Spark data={recent.buckets} />
            </div>
          </section>
        </div>

        <div className="hub-stack">
          <section className="hub-card">
            <div className="hd"><h3>{tr('今日趋势')}</h3></div>
            <div className="bd">
              <div className="hub-trends">
                <Trend label={tr('请求')} value={today.length.toLocaleString()} delta={reqDelta} up={reqDelta?.startsWith('+')} spark={trendReq} />
                <Trend label={tr('成功率')} value={rate(okToday, today.length)} delta={okDelta} up={okDelta?.startsWith('+')} spark={trendOk} />
                <Trend label={tr('缓存')} value={`${cachePct(ledgerToday).toFixed(1)}%`} spark={trendCache} />
                <Trend label={tr('延迟')} value={today.length ? fmtMs(avgToday) : '—'} spark={trendLat} />
                <Trend label={tr('Token')} value={fmtTok(todayTokens)} spark={trendTok} />
                <Trend label={tr('错误')} value={String(errorsToday)} spark={trendErr} />
              </div>
            </div>
          </section>

          <section className="hub-card">
            <div className="hd"><h3>{tr('网关情报')}</h3></div>
            <div className="bd hub-intel">
              <button type="button" className="hub-intel-row" onClick={() => openSettings({ section: 'providers' })}>
                <span className="hub-ic"><Icon name="machine" size={13} /></span>
                <span className="k">{tr('本机 API')}</span>
                <span className={clsx('hub-chip', status?.localRunning ? 'green' : '')}>{status?.localRunning ? tr('运行中 :{port}', { port: localPort }) : tr('未启动')}</span>
              </button>
              <button type="button" className="hub-intel-row" onClick={() => openSettings({ section: 'gateway' })}>
                <span className="hub-ic"><Icon name="gateway" size={13} /></span>
                <span className="k">{tr('网关 API')}</span>
                <span className={clsx('hub-chip', status?.enabled ? 'green' : '')}>{status?.enabled ? tr('运行中 :{port}', { port: gwPort }) : tr('未启用')}</span>
              </button>
              <button type="button" className="hub-intel-row" onClick={() => showHubPage('sources')}>
                <span className="hub-ic"><Icon name="cloud" size={13} /></span>
                <span className="k">{tr('来源与账号')}</span>
                <span className="v">{tr('{sources} 个来源 · {accounts} 个账号', { sources: sources.length, accounts: accounts.length })}</span>
              </button>
              <button type="button" className="hub-intel-row" onClick={() => openSettings({ section: 'diagnostics' })}>
                <span className="hub-ic"><Icon name="terminal" size={13} /></span>
                <span className="k">{tr('运行时')}</span>
                <span className="v">{engine ? `${engine.runtime}${engine.version ? ` ${engine.version}` : ''}` : '—'}</span>
              </button>
              <button type="button" className="hub-intel-row" onClick={() => showHubPage('plugins')}>
                <span className="hub-ic"><Icon name="puzzle" size={13} /></span>
                <span className="k">{tr('可添加的来源')}</span>
                <span className="v">{catalog.length}</span>
              </button>
            </div>
          </section>
        </div>
      </div>

      <section className="hub-card hub-ranking">
        <div className="hd">
          <h3>{tr('模型排行')}</h3>
          <span className="hub-grow" />
          <button className="btn sm ghost" onClick={() => showHubPage('usage')}>{tr('查看用量')}</button>
        </div>
        <div className="bd">
          <table className="hub-table">
            <thead>
              <tr><th>{tr('模型')}</th><th className="num">{tr('Token')}</th><th className="num">{tr('%')}</th><th>{tr('占比')}</th></tr>
            </thead>
            <tbody>
              {ranking.rows.map(([model, tokens]) => (
                <tr key={model}>
                  <td title={model}>{shortModel(model) || model}</td>
                  <td className="num hub-mono">{fmtTok(tokens)}</td>
                  <td className="num hub-mono">{ranking.all ? `${((tokens / ranking.all) * 100).toFixed(1)}%` : '0.0%'}</td>
                  <td><div className="hub-bar"><i style={{ width: `${ranking.all ? Math.max(1, (tokens / ranking.all) * 100) : 0}%` }} /></div></td>
                </tr>
              ))}
              {!ranking.rows.length && <tr><td colSpan={4} className="hub-empty-cell">{tr('今天还没有用到模型')}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
