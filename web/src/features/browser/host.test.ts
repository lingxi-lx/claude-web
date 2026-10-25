import { beforeEach, describe, expect, it, vi } from 'vitest';

// host.ts hangs a test hook on window at import; the node test environment has none
const shown = vi.hoisted(() => {
  (globalThis as unknown as { window: object }).window ??= {};
  return [] as string[];
});
vi.mock('@/ws/client', () => ({ ws: { request: vi.fn(async () => ({})), on: vi.fn(() => () => {}) } }));
vi.mock('@/store', () => ({ useStore: { getState: () => ({ settings: {}, connected: false }), subscribe: () => () => {} } }));
vi.mock('@/features/workbench/right-panel', () => ({ showPanel: (p: string) => { shown.push(p); } }));
vi.mock('./guest', () => ({ pageOf: () => ({ url: () => '' }) }));
vi.mock('./auto-verify', () => ({ checkPage: vi.fn() }));
vi.mock('./search-page', () => ({ searchPage: vi.fn() }));
vi.mock('@/desktop', () => ({ desktop: undefined }));

import { carryOut } from './host';
import { TAKEN_OVER } from './ops';
import { setTakenOver, useBrowser } from './state';

describe('a conversation the user has taken the browser over from (接管, round 2)', () => {
  beforeEach(() => {
    shown.length = 0;
    useBrowser.setState({ tabs: [], active: null, takenOver: [] });
  });

  it('a refused open makes no blank tab and does not bring the browser forward', async () => {
    setTakenOver('s1', true);
    await expect(carryOut({ id: 'c1', sessionId: 's1', op: 'open', args: { url: 'https://a.test/' } } as never)).rejects.toThrow(TAKEN_OVER);
    expect(useBrowser.getState().tabs).toEqual([]);
    expect(shown).toEqual([]);
  });

  it('an op other than open with no tab still says to open a page first, and makes none', async () => {
    await expect(carryOut({ id: 'c2', sessionId: 's2', op: 'read', args: {} } as never)).rejects.toThrow(/browser_open/);
    expect(useBrowser.getState().tabs).toEqual([]);
    expect(shown).toEqual([]);
  });
});
