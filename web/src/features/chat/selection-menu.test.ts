import { describe, expect, it } from 'vitest';
import { isQuoteKey, placeSelectionMenu, selectionItems } from './selection-menu';

describe('selectionItems', () => {
  it('a reply: copy, the message (plain / Markdown), quote, pin and fork', () => {
    expect(selectionItems({ inCode: false, msg: 'assistant', hasText: true, canFork: true })).toEqual([['copy'], ['copyMsg', 'copyMd'], ['quote'], ['pin', 'fork']]);
  });
  it('inside a code block: 复制代码块 next to 复制', () => {
    expect(selectionItems({ inCode: true, msg: 'assistant', hasText: true, canFork: false })[0]).toEqual(['copy', 'copyCode']);
  });
  it('a user message: one copy row (it is its own Markdown), no pin', () => {
    expect(selectionItems({ inCode: false, msg: 'user', hasText: true, canFork: true })).toEqual([['copy'], ['copyMsg'], ['quote'], ['fork']]);
  });
  it('across messages (no message): only copy and quote; nothing forks or pins', () => {
    expect(selectionItems({ inCode: false, msg: null, hasText: true, canFork: true })).toEqual([['copy'], ['quote']]);
  });
  it('a reply without uuid or text (only thinking): no copy-whole rows (they copied ""), no pin, no fork', () => {
    expect(selectionItems({ inCode: false, msg: 'assistant', hasText: false, canFork: false })).toEqual([['copy'], ['quote']]);
  });
});

describe('isQuoteKey', () => {
  const k = (o: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }>) => ({ key: 'L', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });
  it('Ctrl+Shift+L and ⌘⇧L', () => {
    expect(isQuoteKey(k({ ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isQuoteKey(k({ metaKey: true, shiftKey: true, key: 'l' }))).toBe(true);
  });
  it('not without Shift, not with Alt, not another key', () => {
    expect(isQuoteKey(k({ ctrlKey: true }))).toBe(false);
    expect(isQuoteKey(k({ ctrlKey: true, shiftKey: true, altKey: true }))).toBe(false);
    expect(isQuoteKey(k({ ctrlKey: true, shiftKey: true, key: 'K' }))).toBe(false);
  });
});

describe('placeSelectionMenu', () => {
  const view = { vw: 1000, vh: 800 };
  const size = { w: 240, h: 200 };
  const r = (top: number, left: number, right: number, h = 20) => ({ top, bottom: top + h, left, right });
  it('forward: below the line the selection ends on, starting at its end', () => {
    expect(placeSelectionMenu(r(300, 100, 400), r(260, 100, 600, 60), true, size, view)).toEqual({ left: 400, top: 326 });
  });
  it('forward near the bottom: above the whole selection, not over it', () => {
    const p = placeSelectionMenu(r(700, 100, 400), r(600, 100, 600, 120), true, size, view);
    expect(p.top + size.h).toBeLessThanOrEqual(600);
  });
  it('backward: above the line it starts on, ending at the focus', () => {
    expect(placeSelectionMenu(r(400, 300, 500), r(400, 100, 600, 80), false, size, view)).toEqual({ left: 60, top: 194 });
  });
  it('backward near the top: below the whole selection', () => {
    expect(placeSelectionMenu(r(50, 300, 500), r(50, 100, 600, 80), false, size, view).top).toBe(136);
  });
  it('kept inside the window horizontally', () => {
    expect(placeSelectionMenu(r(300, 900, 990), r(300, 900, 990), true, size, view).left).toBe(1000 - 8 - 240);
    expect(placeSelectionMenu(r(300, 2, 40), r(300, 2, 40), false, size, view).left).toBe(8);
  });
  it('fits neither side: the roomier one, clamped inside the window', () => {
    const p = placeSelectionMenu(r(500, 100, 400), r(150, 100, 600, 520), true, size, { vw: 1000, vh: 760 });
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.top + size.h).toBeLessThanOrEqual(760 - 8);
  });
});
