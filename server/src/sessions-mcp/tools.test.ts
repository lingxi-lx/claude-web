import { describe, expect, it } from 'vitest';
import { sendAllowed } from './tools.js';

describe('跨对话: how many messages one conversation takes', () => {
  it('ten in ten minutes from all the others together, then refused until the oldest is ten minutes old', () => {
    const t0 = Date.UTC(2026, 9, 16, 9);
    for (let i = 0; i < 10; i++) expect(sendAllowed('loop-target', t0 + i * 1000)).toBe(true);
    expect(sendAllowed('loop-target', t0 + 11_000)).toBe(false);
    expect(sendAllowed('another', t0 + 11_000)).toBe(true);
    expect(sendAllowed('loop-target', t0 + 10 * 60_000 + 1)).toBe(true);
  });
});
