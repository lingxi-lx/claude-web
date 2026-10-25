import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('@/ui/Select', () => ({ Select: () => null }));   // Select → Popover → ActionSheet pulls the store; not needed for markup
import { NodeGraph } from './NodeGraph';
import { normalizeNodeGraph } from './schema';
import { initialPicks } from './marks';
import { ACCESS_SAMPLE } from './sample';

const g = (() => { const r = normalizeNodeGraph(ACCESS_SAMPLE); if (!r.ok) throw new Error(r.error); return r.graph; })();
const html = (extra: Partial<Parameters<typeof NodeGraph>[0]> = {}) => renderToStaticMarkup(<NodeGraph graph={g} ariaLabel="t" {...extra} />);

describe('NodeGraph markup', () => {
  it('cards, edges with their styles, title and badge', () => {
    const h = html({ picks: initialPicks(g) });
    expect(h.match(/class="ng-card[ "]/g)).toHaveLength(5);
    expect(h).toContain('data-edge="e-open" data-style="error"');
    expect(h).toContain('data-edge="e-backup" data-style="dashed"');
    expect(h).toContain('Access settings');
    expect(h).toMatch(/class="ng-badge" data-tone="error"[^>]*>[^<]*1 open path/);
    expect(h).toContain('class="ng-zoom-pct"');
  });
  it('a pick re-marks the edge and recomputes the badge', () => {
    const h = html({ picks: { ...initialPicks(g), 'link/read': 'Admin' } });
    expect(h).toContain('data-edge="e-open" data-style="dashed"');
    expect(h).toContain('data-tone="ok"');
  });
  it('the travelling dot on error / strong edges, none above 150 cards', () => {
    expect(html()).toContain('<animateMotion');
    const big = { ...g, nodes: Array.from({ length: 151 }, (_, i) => ({ id: `n${i}`, title: `n${i}`, rows: [] })), edges: [{ id: 'x', from: 'n0', to: 'n1', style: 'strong' as const }] };
    const h = renderToStaticMarkup(<NodeGraph graph={big} ariaLabel="t" />);
    expect(h).not.toContain('<animateMotion');
    expect(h).toContain('data-motion="off"');
  });
  it('rows without onPick are plain text', () => {
    expect(html()).toMatch(/data-row="read"[^]*?class="v">Anyone</);
  });
});
