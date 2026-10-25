import { describe, it, expect } from 'vitest';
import { DispatchService, LAST_KEY } from './service.js';

function setup() {
  const settings: Record<string, unknown> = {};
  const metas: Record<string, any> = {};
  const opened: any[] = [];
  const sent: string[] = [];
  const forwarded: any[] = [];
  const svc = new DispatchService({
    meta: {
      workspaces: () => [{ id: 'w1', path: '/code/app', name: 'App', permissionMode: 'acceptEdits' }, { id: 'w2', path: '/code/site', name: 'Site' }],
      settings: () => settings,
      setSetting: async (k, v) => { settings[k] = v; },
      setSessionMeta: async (id, p) => { metas[id] = { ...metas[id], ...p }; },
      sessionMeta: (id) => metas[id] ?? {},
    },
    open: (p) => { opened.push(p); return { sessionId: `s${opened.length}`, send: (t: string) => { sent.push(t); } }; },
    homeDir: () => '/home/me',
    forward: async (peerId, req) => { forwarded.push({ peerId, req }); return { sessionId: 'remote-1' }; },
    peers: () => [{ id: 'p1', name: 'Box', enabled: true, state: 'online' }],
  });
  return { svc, settings, metas, opened, sent, forwarded };
}

describe('DispatchService', () => {
  it('opens a new conversation in the project with its permission mode, marks it, sends the task, remembers the pick', async () => {
    const t = setup();
    const r = await t.svc.start({ prompt: ' fix it ', workspaceId: 'w1', from: 'phone' });
    expect(r).toEqual({ sessionId: 's1' });
    expect(t.opened[0]).toEqual({ cwd: '/code/app', permissionMode: 'acceptEdits' });
    expect(t.sent).toEqual(['fix it']);
    expect(t.metas.s1).toEqual({ origin: 'dispatch', dispatchFrom: 'phone', workspaceId: 'w1' });
    expect(t.settings[LAST_KEY]).toEqual({ workspaceId: 'w1' });
    expect(t.svc.isDispatched('s1')).toBe(true);
  });

  it('a project without its own mode leaves the mode to the pool (the default for new conversations)', async () => {
    const t = setup();
    await t.svc.start({ prompt: 'x', workspaceId: 'w2' });
    expect(t.opened[0]).toEqual({ cwd: '/code/site' });
  });

  it('no project: the home folder; a project that is gone is refused', async () => {
    const t = setup();
    await t.svc.start({ prompt: 'x' });
    expect(t.opened[0].cwd).toBe('/home/me');
    await expect(t.svc.start({ prompt: 'x', workspaceId: 'gone' })).rejects.toThrow();
    await expect(t.svc.start({ prompt: '  ' })).rejects.toThrow();
  });

  it('another machine: forwarded there, the id comes back with its prefix', async () => {
    const t = setup();
    const r = await t.svc.start({ prompt: 'x', peer: 'p1', workspaceId: 'their-w', from: 'phone' });
    expect(t.forwarded[0]).toEqual({ peerId: 'p1', req: { kind: 'dispatch.start', prompt: 'x', workspaceId: 'their-w', from: 'phone' } });
    expect(r.sessionId).toBe('peer_p1~remote-1');
    expect(t.opened).toHaveLength(0);
    expect(t.settings[LAST_KEY]).toEqual({ peer: 'p1', workspaceId: 'their-w' });
  });

  it('defaults: projects, machines, last time', async () => {
    const t = setup();
    t.settings[LAST_KEY] = { workspaceId: 'w2', peer: 'gone' };
    const d = await t.svc.defaults();
    expect(d.workspaces.map((w) => w.id)).toEqual(['w1', 'w2']);
    expect(d.peers).toEqual([{ id: 'p1', name: 'Box', online: true }]);
    expect(d.last).toEqual({ workspaceId: 'w2' });
  });
});
