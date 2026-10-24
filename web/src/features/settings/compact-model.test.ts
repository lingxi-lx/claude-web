import { describe, expect, it } from 'vitest';
import { accountCompactWindow, accountSummary, compactErrText, compactText, compactValue, compactWindowOfProvider, nowLine, prefillText, savedWindows } from './compact-model';

// final review M2: 「在这个大小时压缩」 opened with settings.json's 700000 on a 200K / 272K provider showed 「不能超过上下文窗口」
// before the user typed anything
describe('prefillText: what the box starts with when 在这个大小时压缩 is picked', () => {
  it('the point in effect (settings.json / the environment) when it holds for the window', () => {
    expect(prefillText(700_000, 1_000_000)).toBe('700k');
    expect(prefillText(700_000, undefined)).toBe('700k');
  });
  it('empty (the placeholder shows) when it would be refused: over the window, under 50K, nothing in effect', () => {
    expect(prefillText(700_000, 200_000)).toBe('');
    expect(prefillText(700_000, 272_000)).toBe('');
    expect(prefillText(30_000, 1_000_000)).toBe('');
    expect(prefillText(undefined, 1_000_000)).toBe('');
  });
});

// A7 自动压缩 / Claude 账号的上下文窗口: what the editors save and what they refuse
describe('compactValue: the draft (mode + text) → the value to save', () => {
  it('跟着上下文窗口 saves nothing (unset), whatever is in the box', () => {
    expect(compactValue('follow', '30', 1_000_000)).toEqual({ value: undefined });
  });
  it('a number in every form the brief allows: 700 (as K), 700k, 700000, 1m', () => {
    expect(compactValue('at', '700', 1_000_000)).toEqual({ value: 700_000 });
    expect(compactValue('at', '700k', 1_000_000)).toEqual({ value: 700_000 });
    expect(compactValue('at', '700000', 1_000_000)).toEqual({ value: 700_000 });
    expect(compactValue('at', '1m', 1_000_000)).toEqual({ value: 1_000_000 });
    expect(compactValue('at', ' 700 K ', undefined)).toEqual({ value: 700_000 });
  });
  it('below 50K, empty or not a number: not saved, 最少 50K', () => {
    expect(compactValue('at', '49k', 1_000_000)).toEqual({ error: { kind: 'min' } });
    expect(compactValue('at', '', 1_000_000)).toEqual({ error: { kind: 'min' } });
    expect(compactValue('at', 'abc', 1_000_000)).toEqual({ error: { kind: 'min' } });
    expect(compactValue('at', '50k', 1_000_000)).toEqual({ value: 50_000 });
  });
  it('over the window: not saved, names the window; an unknown window only has the floor', () => {
    expect(compactValue('at', '700k', 200_000)).toEqual({ error: { kind: 'over', window: 200_000 } });
    expect(compactValue('at', '200k', 200_000)).toEqual({ value: 200_000 });
    expect(compactValue('at', '5m', undefined)).toEqual({ value: 5_000_000 });
  });
});

describe('compactText: a saved value back into the box', () => {
  it('in the short form', () => {
    expect(compactText(700_000)).toBe('700k');
    expect(compactText(1_000_000)).toBe('1m');
    expect(compactText(1_500_000)).toBe('1.5m');
    expect(compactText(123_456)).toBe('123456');
    expect(compactText(undefined)).toBe('');
  });
});

describe('the window a compaction point is checked against', () => {
  it('the account: the largest of the picks, 1M when a family is left at its default', () => {
    expect(accountCompactWindow({})).toBe(1_000_000);
    expect(accountCompactWindow({ opus: 200_000 })).toBe(1_000_000);
    expect(accountCompactWindow({ opus: 200_000, sonnet: 200_000, fable: 200_000 })).toBe(200_000);
  });
  it("a provider: its default model's window if known, else none (only the 50K floor)", () => {
    expect(compactWindowOfProvider({ defaultModel: 'claude-opus-5-5' })).toBe(1_000_000);
    expect(compactWindowOfProvider({ defaultModel: 'claude-opus-5-5', contextWindows: { 'claude-opus-5-5': 400_000 } })).toBe(400_000);
    expect(compactWindowOfProvider({ defaultModel: 'my-model', modelContext: { 'my-model': 128_000 } })).toBe(128_000);
    expect(compactWindowOfProvider({ defaultModel: 'mystery' })).toBeUndefined();
    expect(compactWindowOfProvider({ defaultModel: '' })).toBeUndefined();
    expect(compactWindowOfProvider({})).toBeUndefined();
  });
});

describe('savedWindows: the picks as stored', () => {
  it('only the three families and the two sizes; nothing picked = unset', () => {
    expect(savedWindows({ opus: 200_000, sonnet: 1_000_000 })).toEqual({ opus: 200_000, sonnet: 1_000_000 });
    expect(savedWindows({ haiku: 1_000_000, opus: 123 } as never)).toBeUndefined();
    expect(savedWindows({})).toBeUndefined();
  });
});

describe('accountSummary: the account row', () => {
  it('each family, then the point when set', () => {
    expect(accountSummary({}, undefined)).toBe('Opus 1M · Sonnet 1M · Fable 1M');
    expect(accountSummary({ sonnet: 200_000 }, 700_000)).toBe('Opus 1M · Sonnet 200K · Fable 1M · 自动压缩 700K');
  });
});

describe('compactErrText: the refusal in words', () => {
  it('the floor and the window', () => {
    expect(compactErrText({ kind: 'min' })).toBe('最少 50K');
    expect(compactErrText({ kind: 'over', window: 200_000 })).toBe('不能超过上下文窗口 200K');
  });
});

describe('nowLine: what is in effect while this editor is unset', () => {
  it('from settings.json, the environment, or the window', () => {
    expect(nowLine({ value: 700_000, source: 'settings' })).toBe('现在：700K（来自你的 settings.json）');
    expect(nowLine({ value: 1_500_000, source: 'env' })).toBe('现在：1.5M（来自环境变量）');
    expect(nowLine({ source: 'none' })).toBe('现在：跟着上下文窗口');
    expect(nowLine(null)).toBe('');
  });
});
