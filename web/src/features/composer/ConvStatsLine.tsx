import { useMemo } from 'react';
import { useStore } from '@/store';
import { convStats } from '@/model/conv-stats';
import { pct } from '@/model/tokens';
import { fmtTok } from '@/util';
import { tr } from '@/i18n';

/**
 * 「3 轮 · 277 步 · 231 tok/s · 52.2M tok · 缓存 99%」 under the composer: the conversation so far in one line, beside
 * the permission chip. Quiet text, gone when the row is narrow (composer.css) and before the first turn ends.
 */
export function ConvStatsLine({ sessionId }: { sessionId: string }) {
  const items = useStore((s) => s.open[sessionId]?.conv.items);
  const st = useMemo(() => (items ? convStats(items) : null), [items]);
  if (!st) return null;
  const parts: { text: string; title: string }[] = [
    { text: tr('{turns} 轮', { turns: st.turns }), title: tr('这个对话发出过 {turns} 轮', { turns: st.turns }) },
    { text: tr('{steps} 步', { steps: st.steps }), title: tr('模型一共走了 {steps} 步（每次调用模型算一步）', { steps: st.steps }) },
    ...(st.tokPerSec !== null ? [{ text: `${Math.round(st.tokPerSec)} tok/s`, title: tr('输出速度：输出的 token ÷ 模型生成用的时间') }] : []),
    { text: `${fmtTok(st.tokens)} tok`, title: tr('这个对话读写的 token 总数（输入含缓存 + 输出）') },
    ...(st.cacheHit !== null ? [{ text: tr('缓存命中 {pct}', { pct: pct(st.cacheHit) }), title: tr('全部输入里从提示缓存读的比例') }] : []),
  ];
  return (
    <span className="conv-stats" data-id="conv-stats">
      {parts.map((p, i) => <span key={i} title={p.title}>{p.text}</span>)}
    </span>
  );
}
