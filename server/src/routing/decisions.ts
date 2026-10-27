// 智能路由: the record — recent decisions (shown in the detail page, §7.4 "进入日志"), each candidate's recent
// outcomes and first-byte times (for ranking), today's paid spend (the budget) and today's switches.
import type { RoutingDecision } from './types.js';

const KEEP = 200;
const WINDOW = 20; // outcomes per candidate that count for its success rate

const today = (now = Date.now()) => { const d = new Date(now); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

export interface SpendStore { load(): { day: string; usd: number } | undefined; save(v: { day: string; usd: number }): void }

export class DecisionLog {
  private list: RoutingDecision[] = [];
  private outcomes = new Map<string, boolean[]>();
  private latency = new Map<string, number>();
  private spend: { day: string; usd: number };
  private switches = { day: today(), n: 0 };

  constructor(private store?: SpendStore) {
    this.spend = store?.load() ?? { day: today(), usd: 0 };
  }

  add(d: RoutingDecision) {
    this.list.push(d);
    if (this.list.length > KEEP) this.list.splice(0, this.list.length - KEEP);
    if (d.switched) {
      const day = today();
      if (this.switches.day !== day) this.switches = { day, n: 0 };
      this.switches.n++;
    }
  }

  recent(groupId?: string, limit = 50): RoutingDecision[] {
    const l = groupId ? this.list.filter((d) => d.groupId === groupId) : this.list;
    return l.slice(-limit).reverse();
  }

  outcome(key: string, ok: boolean, firstByteMs?: number) {
    const a = this.outcomes.get(key) ?? [];
    a.push(ok);
    if (a.length > WINDOW) a.shift();
    this.outcomes.set(key, a);
    if (ok && firstByteMs !== undefined) {
      const prev = this.latency.get(key);
      this.latency.set(key, prev === undefined ? firstByteMs : Math.round(prev * 0.7 + firstByteMs * 0.3));
    }
  }

  numbers(key: string): { success?: number; latencyMs?: number; ok: number; fail: number } {
    const a = this.outcomes.get(key) ?? [];
    const ok = a.filter(Boolean).length;
    return { success: a.length ? ok / a.length : undefined, latencyMs: this.latency.get(key), ok, fail: a.length - ok };
  }

  spentToday(): number {
    const day = today();
    if (this.spend.day !== day) this.spend = { day, usd: 0 };
    return this.spend.usd;
  }

  addSpend(usd: number) {
    if (!(usd > 0)) return;
    this.spentToday();
    this.spend.usd += usd;
    this.store?.save({ ...this.spend });
  }

  switchesToday(): number { return this.switches.day === today() ? this.switches.n : 0; }
}
