import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '@shared';
import { backdropData } from './backdrop-data';

const s = (cwd: string, lastModified: number, live?: string): SessionSummary => ({ sessionId: cwd + lastModified, title: 't', cwd, lastModified, live } as SessionSummary);

describe('backdropData', () => {
  it('one plant per project folder, sized against the busiest, recent and live flagged', () => {
    const now = 10 * 86_400_000;
    const d = backdropData([s('C:\\a\\web', now - 1000), s('c:\\a\\web\\', now - 5 * 86_400_000), s('/x/api', now - 3 * 86_400_000, 'running'), s('', now)], now);
    expect(d.projects.map((p) => p.name)).toEqual(['web', 'api']);
    expect(d.projects[0]).toMatchObject({ count: 2, size: 1, recent: true, live: false });
    expect(d.projects[1]).toMatchObject({ count: 1, recent: false, live: true });
    expect(d.projects[1].size).toBeGreaterThan(0);
    expect(d.projects[1].size).toBeLessThan(1);
  });
  it('keeps the most recent few', () => expect(backdropData(Array.from({ length: 40 }, (_, i) => s(`/p${i}`, i)), 100, 24).projects).toHaveLength(24));
});
