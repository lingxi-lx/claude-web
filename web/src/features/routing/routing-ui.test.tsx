import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RoutingDecision, SourceHealthView } from '@shared';
const m = vi.hoisted(() => {
  const sent: unknown[] = [];
  let reply: unknown = {};
  const useStore = Object.assign((sel: (s: { toast(): void }) => unknown) => sel({ toast: () => {} }), { getState: () => ({ toast: () => {} }) });
  return { sent, useStore, setReply: (r: unknown) => { reply = r; }, request: async (r: unknown) => { sent.push(r); return reply; } };
});
vi.mock('@/store', () => ({ useStore: m.useStore }));
vi.mock('@/ws/client', () => ({ ws: { request: m.request } }));
import { DecisionTraceView, quotaText } from './DecisionTraceView';
import { SourceHealthBits, timeLeft } from './SourceHealthLine';
import { useSourceHealth } from './health-store';

const NOW = Date.now();

const decision: RoutingDecision = {
  id: 'd1', ts: NOW, groupId: 'smart', policy: 'auto',
  needs: { tools: true, images: false, thinking: false, tokens: 12_000, afterTool: false },
  candidates: [
    { key: 'p:b#m', label: 'B / m', cost: 'free', caps: {}, score: 0.71, quota: { remaining: 0.4 } },
    { key: 'p:a#m', label: 'A / m', cost: 'free', caps: {}, excluded: '限流冷却中（约 30s 后恢复）', quota: { cooldownUntil: NOW + 30_000 } },
  ],
  reason: '按策略排序的第一个',
  chosen: { key: 'p:b#m', label: 'B / m', model: 'm' },
  attempts: [{ key: 'p:b#m', label: 'B / m', status: 200, outcome: 'done' }],
  trace: [
    { at: 0, stage: 'group', text: '2 个候选' },
    { at: 0, stage: 'filter', text: 'A / m：限流冷却中', data: { key: 'p:a#m', excluded: true } },
    { at: 1, stage: 'rank', text: '按策略打分：B / m 0.71' },
    { at: 1, stage: 'order', text: '依次尝试：B / m' },
    { at: 340, stage: 'attempt', text: 'B / m · 200 · 成功' },
    { at: 341, stage: 'finish', text: '由 B / m 回答' },
  ],
  ok: true, switched: false,
};

describe('DecisionTraceView', () => {
  it('lists every candidate (score or why it was left out, quota) and marks the pick', () => {
    const h = renderToStaticMarkup(<DecisionTraceView d={decision} />);
    const b = /<tr[^>]*data-key="p:b#m"[^>]*>(.*?)<\/tr>/.exec(h)?.[0] ?? '';
    const a = /<tr[^>]*data-key="p:a#m"[^>]*>(.*?)<\/tr>/.exec(h)?.[0] ?? '';
    expect(b).toContain('chosen');
    expect(b).toContain('0.71');
    expect(b).toContain('40%');
    expect(a).toContain('excluded');
    expect(a).toContain('限流冷却中');
  });

  it('replays the trace steps in order with their offsets', () => {
    const h = renderToStaticMarkup(<DecisionTraceView d={decision} />);
    const stages = [...h.matchAll(/data-stage="(\w+)"/g)].map((x) => x[1]);
    expect(stages).toEqual(['group', 'filter', 'rank', 'order', 'attempt', 'finish']);
    expect(h).toContain('+340ms');
  });

  it('an old decision without a trace still shows its attempts', () => {
    const h = renderToStaticMarkup(<DecisionTraceView d={{ ...decision, trace: undefined }} />);
    expect(h).not.toContain('data-stage');
    expect(h).toContain('B / m · 200 · done');
  });
});

describe('quota words', () => {
  it('timeLeft / quotaText', () => {
    expect(timeLeft(NOW + 45_000, NOW)).toBe('45s');
    expect(timeLeft(NOW + 5 * 60_000, NOW)).toMatch(/5/);
    expect(quotaText(undefined)).toBe('');
    expect(quotaText({ remaining: 0.25 }, NOW)).toContain('25%');
    expect(quotaText({ cooldownUntil: NOW - 1 }, NOW)).toBe('');
  });
});

describe('SourceHealthLine', () => {
  const view = (v: Partial<SourceHealthView>): SourceHealthView => ({ providerId: 'kilo', state: 'unknown', ...v });

  it('a 429 cooldown shows with its countdown and the check button is held', () => {
    const until = Date.now() + 90_000;
    const h = renderToStaticMarkup(<SourceHealthBits v={view({ state: 'cooling', quota: { key: 'p:kilo', streak: 2, cooldownUntil: until, last429At: Date.now(), updatedAt: Date.now() } })} busy={false} free cooling={until} onCheck={() => {}} />);
    expect(h).toContain('data-health="cooling"');
    expect(h).toContain('限流冷却中');
    expect(h).toMatch(/<button[^>]*disabled/);
  });

  it('quota left and the last probe', () => {
    const h = renderToStaticMarkup(<SourceHealthBits v={view({ state: 'ok', quota: { key: 'p:kilo', streak: 0, remaining: 0.9, updatedAt: Date.now() }, probe: { ok: true, ms: 120, at: Date.now(), models: 3 } })} busy={false} cooling={0} onCheck={() => {}} />);
    expect(h).toContain('90%');
    expect(h).toContain('120ms');
    expect(h).not.toMatch(/<button[^>]*disabled/);
  });

  it('probe asks the server and keeps the answer for that source', async () => {
    m.setReply(view({ state: 'ok', probe: { ok: true, ms: 5, at: 1 } }));
    await useSourceHealth.getState().probe('kilo', true);
    expect(m.sent.at(-1)).toEqual({ kind: 'channels.health.probe', providerId: 'kilo', chat: true });
    expect(useSourceHealth.getState().byId.kilo.probe?.ms).toBe(5);
    expect(useSourceHealth.getState().busy.kilo).toBeUndefined();
  });
});
