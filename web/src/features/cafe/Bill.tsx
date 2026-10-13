// 今日账单: the receipts a cafe printed, newest first (spec §3).
import type { Receipt } from './sim';
import { usd, yuan } from './money';
import { tokensText } from '@/features/background/model';
import { useCafe } from './state';
import { clsx } from '@/util';

const KIND: Record<Receipt['kind'], string> = { ok: '结账', failed: '异常下机', stopped: '被叫下机' };
const NONE: Receipt[] = [];

export const receiptTime = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

export function Bill({ sessionId }: { sessionId: string }) {
  const list = useCafe((s) => s.receipts[sessionId] ?? NONE);
  if (!list.length) return null;
  const total = list.reduce((n, r) => n + r.fee, 0);
  return (
    <div className="bg-feed-wrap">
      <div className="bg-h">今日账单 · {yuan(total)}</div>
      <div className="cafe-bill">
        {list.slice(0, 20).map((r) => (
          <div key={`${r.key}-${r.at}`} className={clsx('cafe-receipt', r.kind)}>
            <span className="n">{r.name}</span>
            <span className="k">{KIND[r.kind]}</span>
            <span className="m">{yuan(r.fee)}</span>
            <span className="s">{String(r.seat).padStart(2, '0')} 号机 · 上机 {receiptTime(r.ms)}{r.tokens ? ` · ${tokensText(r.tokens)} token` : ''} · {usd(r.usd)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
