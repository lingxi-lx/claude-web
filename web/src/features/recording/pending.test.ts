import { describe, expect, it } from 'vitest';
import { framesState, withFrames, withoutFrame, type ComposerRecording } from './pending';

const rec = (id: string): ComposerRecording => ({ id, target: 's', blob: new Blob(['x']), ext: 'webm', ms: 3000, start: 1 });
const f = (d: string) => ({ mediaType: 'image/jpeg' as const, data: d });

describe('composer recordings (E-minor: keyframes previewed before sending)', () => {
  it('frames land on their own recording; failure is remembered', () => {
    let l = [rec('a'), rec('b')];
    expect(framesState(l[0])).toBe('pending');
    l = withFrames(l, 'a', [f('1'), f('2'), f('3')]);
    l = withFrames(l, 'b', null);
    expect(l[0].frames!.map((x) => x.data)).toEqual(['1', '2', '3']);
    expect(framesState(l[0])).toBe('ready');
    expect(framesState(l[1])).toBe('failed');
  });
  it('removing a frame removes exactly that one; all removed still counts as ready (send none)', () => {
    let l = withFrames([rec('a'), rec('b')], 'a', [f('1'), f('2'), f('3')]);
    l = withoutFrame(l, 'a', 1);
    expect(l[0].frames!.map((x) => x.data)).toEqual(['1', '3']);
    l = withoutFrame(withoutFrame(l, 'a', 0), 'a', 0);
    expect(l[0].frames).toEqual([]);
    expect(framesState(l[0])).toBe('ready');
    expect(withoutFrame(l, 'b', 0)[1]).toBe(l[1]);
  });
});
