import { describe, expect, it } from 'vitest';
import { keyAction } from './keys';

const key = (k: string, more: Partial<Parameters<typeof keyAction>[0]> = {}) =>
  keyAction({ key: k, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, editable: false, repeat: false, ...more });

describe('keyAction', () => {
  it('D R C G, either case', () => {
    expect(key('d')).toBe('download');
    expect(key('D')).toBe('download');
    expect(key('r')).toBe('source');
    expect(key('c')).toBe('changelog');
    expect(key('g')).toBe('github');
  });
  it('nothing else', () => {
    expect(key('x')).toBeNull();
    expect(key('Enter')).toBeNull();
  });
  it('never with a modifier, while typing, or while an input method is composing', () => {
    expect(key('c', { ctrlKey: true })).toBeNull();
    expect(key('c', { metaKey: true })).toBeNull();
    expect(key('d', { altKey: true })).toBeNull();
    expect(key('d', { editable: true })).toBeNull();
    expect(key('d', { isComposing: true })).toBeNull();
  });
  it('not again while the key is held down', () => {
    expect(key('d', { repeat: true })).toBeNull();
  });
});
