import { describe, expect, it } from 'vitest';
import { navStep, navVisit, type NavState } from './nav-model';

const empty: NavState = { back: [], forward: [], cur: null };
const visit = (...ids: string[]) => ids.reduce((n, id) => navVisit(n, id, false), empty);

describe('← → history', () => {
  it('each conversation brought to the front goes on top; the same one twice is one entry; a new one drops what was ahead', () => {
    const n = visit('a', 'b', 'b', 'c');
    expect(n).toEqual({ back: ['a', 'b'], forward: [], cur: 'c' });
    const back = navStep(n, -1, () => true)!;
    expect(back.to).toBe('b');
    expect(back.state).toEqual({ back: ['a'], forward: ['c'], cur: 'b' });
    // opening it (moving) does not push; opening another drops 「c」 ahead
    expect(navVisit(back.state, 'b', true)).toBe(back.state);
    expect(navVisit(back.state, 'd', false)).toEqual({ back: ['a', 'b'], forward: [], cur: 'd' });
  });
  it('forward after back; a deleted conversation is skipped; nothing there → null', () => {
    const n = navStep(visit('a', 'b', 'c'), -1, () => true)!.state; // at b, forward c
    const f = navStep(n, 1, () => true)!;
    expect(f.to).toBe('c');
    expect(f.state).toEqual({ back: ['a', 'b'], forward: [], cur: 'c' });
    expect(navStep(f.state, 1, () => true)).toBeNull();
    const skip = navStep(visit('a', 'gone', 'c'), -1, (id) => id !== 'gone')!;
    expect(skip.to).toBe('a');
    expect(navStep(empty, -1, () => true)).toBeNull();
  });
  it('going back to one visited earlier does not leave it twice in the history', () => {
    expect(visit('a', 'b', 'a', 'c').back).toEqual(['b', 'a']);
  });
});
