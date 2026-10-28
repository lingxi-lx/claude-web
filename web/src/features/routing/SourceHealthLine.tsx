import { useEffect, useState } from 'react';
import { clsx } from '@/util';
import { tr } from '@/i18n';
import { useStore } from '@/store';
import type { SourceHealthView } from '@shared';
import { useSourceHealth } from './health-store';

/** "45s" / "12 min" / "3 h" until `ts`. */
export function timeLeft(ts: number, now = Date.now()): string {
  const s = Math.max(1, Math.ceil((ts - now) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return tr('{d} 分钟', { d: Math.ceil(s / 60) });
  return tr('{d} 小时', { d: Math.round(s / 360) / 10 });
}

/**
 * 来源健康 on a provider card: a 429 cooldown and when it ends, the quota share left (from the upstream's own
 * headers), the last probe, and a 检查 button (models list; free sources also one real call for 1 token).
 */
export function SourceHealthLine({ providerId, free }: { providerId: string; free?: boolean }) {
  const v = useSourceHealth((s) => s.byId[providerId]);
  const busy = useSourceHealth((s) => !!s.busy[providerId]);
  const toast = useStore((s) => s.toast);
  const [, tick] = useState(0);
  useEffect(() => {
    const st = useSourceHealth.getState();
    if (Date.now() - st.loadedAt > 30_000) void st.load();
  }, []);
  // a running cooldown counts down
  const cooling = v?.quota?.cooldownUntil && v.quota.cooldownUntil > Date.now() ? v.quota.cooldownUntil : 0;
  useEffect(() => {
    if (!cooling) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [cooling]);

  const run = async () => {
    try {
      const r = await useSourceHealth.getState().probe(providerId, !!free);
      if (r.state === 'ok') toast(tr('检查正常'), true);
      else if (r.state === 'cooling') toast(tr('上游限流中，冷却结束前不再检查'));
      else if (r.state === 'error') toast(r.chat?.error ?? r.probe?.error ?? tr('检查失败'));
    } catch (e: any) { toast(e.message); }
  };

  return <SourceHealthBits v={v} busy={busy} free={free} cooling={cooling} onCheck={() => void run()} />;
}

/** The line itself (pure: the card's state comes in). */
export function SourceHealthBits({ v, busy, free, cooling, onCheck }: { v?: SourceHealthView; busy: boolean; free?: boolean; cooling: number; onCheck(): void }) {
  const remaining = v?.quota?.remaining;
  const last = [v?.probe, v?.chat].filter(Boolean).sort((a, b) => b!.at - a!.at)[0];
  return (
    <span className="hub-meta routing-health" data-health={v?.state ?? 'unknown'} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {cooling ? (
        <span className="hub-chip warn" title={v?.quota?.last429At ? tr('上游回了 429（{n} 次连续）', { n: v.quota.streak || 1 }) : undefined}>
          {tr('限流冷却中 · {t} 后恢复', { t: timeLeft(cooling) })}
        </span>
      ) : v?.state === 'limited' ? <span className="hub-chip warn">{tr('额度快用完')}</span> : null}
      {remaining !== undefined && (
        <span className={clsx('hub-chip', remaining < 0.1 ? 'warn' : '')} title={v?.quota?.resetAt ? tr('{t} 后重置', { t: timeLeft(v.quota.resetAt) }) : undefined}>
          {tr('剩余额度 {n}%', { n: Math.round(remaining * 100) })}
        </span>
      )}
      {last && !cooling && (
        last.ok
          ? <span className="hub-chip green">{v?.chat?.ok && v.chat === last ? tr('真实调用正常 · {ms}ms', { ms: last.ms }) : tr('检查正常 · {ms}ms', { ms: last.ms })}</span>
          : <span className="hub-chip danger" title={last.error}>{tr('检查失败')}</span>
      )}
      <button className="btn sm ghost" disabled={busy || !!cooling} onClick={onCheck}
        title={free ? tr('读模型列表，再真的调用一次（只要 1 个 token）') : tr('读模型列表')}>
        {busy ? tr('检查中…') : tr('检查')}
      </button>
    </span>
  );
}
