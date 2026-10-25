import { describe, it, expect } from 'vitest';
import { normDispatch, dispatchDefaults, parseImDispatch } from './core.js';

describe('dispatch', () => {
  it('normalises the request and refuses an empty task', () => {
    expect(normDispatch({ prompt: '  fix the build ', workspaceId: 'w1', from: 'phone' })).toEqual({ prompt: 'fix the build', workspaceId: 'w1', from: 'phone' });
    expect(normDispatch({ prompt: 'x', peer: '', from: 'nope' })).toEqual({ prompt: 'x', from: 'app' });
    expect(() => normDispatch({ prompt: '  ' })).toThrow();
    expect(normDispatch({ prompt: 'y'.repeat(30_000) }).prompt.length).toBe(20_000);
  });
  it('defaults to last time, when that project / machine still exists', () => {
    const ws = [{ id: 'w1' }], peers = [{ id: 'p1', enabled: true }, { id: 'p2', enabled: false }];
    expect(dispatchDefaults({ workspaceId: 'w1', peer: 'p1' }, ws, peers)).toEqual({ workspaceId: 'w1', peer: 'p1' });
    expect(dispatchDefaults({ workspaceId: 'gone', peer: 'p2' }, ws, peers)).toEqual({});
    expect(dispatchDefaults('junk', ws, peers)).toEqual({});
  });
  it('IM: /dispatch and /派活, with an optional "项目名:" in front', () => {
    const ws = [{ id: 'w1', name: 'App' }, { id: 'w2', name: '网站' }];
    expect(parseImDispatch('/dispatch run the tests', ws)).toEqual({ prompt: 'run the tests' });
    expect(parseImDispatch('/dispatch app: run the tests', ws)).toEqual({ prompt: 'run the tests', workspaceId: 'w1' });
    expect(parseImDispatch('/派活 网站：更新首页', ws)).toEqual({ prompt: '更新首页', workspaceId: 'w2' });
    expect(parseImDispatch('/派活 note: not a project', ws)).toEqual({ prompt: 'note: not a project' });
    expect(parseImDispatch('/dispatch', ws)).toBeNull();
    expect(parseImDispatch('hello', ws)).toBeNull();
  });
});
