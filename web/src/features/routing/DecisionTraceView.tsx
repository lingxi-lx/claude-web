import type { RoutingDecision, RoutingQuotaView, RoutingTraceStage } from '@shared';
import { clsx } from '@/util';
import { tr } from '@/i18n';
import { timeLeft } from './SourceHealthLine';

const STAGE: Record<RoutingTraceStage, string> = {
  group: tr('开始'),
  filter: tr('筛选'),
  rank: tr('排序'),
  rule: tr('规则'),
  classifier: tr('意图判断'),
  affinity: tr('保持'),
  order: tr('尝试顺序'),
  attempt: tr('尝试'),
  finish: tr('结果'),
};

const costLabel = (c: 'free' | 'subscription' | 'paid') => (c === 'free' ? tr('免费') : c === 'subscription' ? tr('订阅') : tr('付费'));

/** "剩余 40% · 冷却 2 分钟" for a candidate's quota (empty when the upstream never said). */
export function quotaText(q: RoutingQuotaView | undefined, now = Date.now()): string {
  if (!q) return '';
  const parts: string[] = [];
  if (q.cooldownUntil && q.cooldownUntil > now) parts.push(tr('限流冷却中 · {t} 后恢复', { t: timeLeft(q.cooldownUntil, now) }));
  if (q.remaining !== undefined) parts.push(tr('剩余额度 {n}%', { n: Math.round(q.remaining * 100) }));
  return parts.join(' · ');
}

/**
 * One routing decision, replayed: every candidate (left out and why, or its score), which one was picked, and the
 * ordered trace steps (filter → rank → rule / 意图判断 → affinity → order → attempts → result).
 */
export function DecisionTraceView({ d }: { d: RoutingDecision }) {
  const chosen = d.chosen?.key;
  return (
    <div className="routing-trace">
      <div className="sub">{d.reason}</div>
      <div className="sub">{tr('需要')}：{[d.needs.tools && tr('工具'), d.needs.images && tr('图片'), d.needs.thinking && tr('思考'), d.needs.afterTool && tr('工具之后'), `~${Math.round(d.needs.tokens / 1000)}K`].filter(Boolean).join(' · ')}</div>
      <table className="routing-trace-cands" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
        <thead>
          <tr className="sub"><th style={{ textAlign: 'left' }}>{tr('候选')}</th><th style={{ textAlign: 'left' }}>{tr('计费')}</th><th style={{ textAlign: 'left' }}>{tr('得分 / 排除原因')}</th><th style={{ textAlign: 'left' }}>{tr('额度')}</th></tr>
        </thead>
        <tbody>
          {d.candidates.map((c) => (
            <tr key={c.key} data-key={c.key} className={clsx(c.excluded && 'excluded', c.key === chosen && 'chosen')} style={c.excluded ? { opacity: 0.6 } : undefined}>
              <td>{c.key === chosen ? <b>{c.label} ✓</b> : c.label}</td>
              <td className="sub">{costLabel(c.cost)}</td>
              <td className="sub">{c.excluded ?? (c.score !== undefined ? String(c.score) : '—')}</td>
              <td className="sub">{quotaText(c.quota, d.ts) || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.trace && d.trace.length > 0 ? (
        <ol className="routing-trace-steps" style={{ marginTop: 6 }}>
          {d.trace.map((s, i) => (
            <li key={i} data-stage={s.stage}>
              <span className="sub">+{s.at}ms · {STAGE[s.stage] ?? s.stage}</span> {s.text}
            </li>
          ))}
        </ol>
      ) : d.attempts.length > 0 && (
        <ol style={{ marginTop: 6 }}>{d.attempts.map((a, k) => <li key={k}>{a.label} · {a.status || '—'} · {a.outcome}</li>)}</ol>
      )}
    </div>
  );
}
