import { beforeAll, describe, expect, it, vi } from 'vitest';

// 「正在别处更新」 only for turns written elsewhere — not for what ran in this window, nor for the CLI's bookkeeping at exit
type Handler = (req: any) => unknown;
const fake = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), listeners: new Set<(e: any) => void>() }));
vi.mock('@/ws/client', () => ({
  authToken: () => null,
  ws: {
    onStatus: null as null | ((c: boolean) => void),
    connect() {},
    on(l: (e: any) => void) { fake.listeners.add(l); return () => fake.listeners.delete(l); },
    async request(req: any) { const h = fake.handlers.get(req.kind); return h ? h(req) : null; },
  },
}));
const mem = new Map<string, string>();
let useStore: typeof import('@/store/index').useStore;
beforeAll(async () => {
  vi.stubGlobal('window', { matchMedia: undefined });
  vi.stubGlobal('document', { addEventListener() {}, hasFocus: () => true, documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {}, add() {}, remove() {} } } });
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
  vi.stubGlobal('location', { search: '', protocol: 'http:', host: 'x' });
  ({ useStore } = await import('@/store/index'));
  useStore.getState().init();
});
const emit = (e: any) => { for (const l of fake.listeners) l(e); };
const settle = () => new Promise((r) => setTimeout(r, 0));
const user = (i: number) => ({ type: 'user', uuid: `u${i}`, message: { role: 'user', content: `hi ${i}` }, timestamp: new Date(1e12 + i * 1000).toISOString() });
const asst = (i: number) => ({ type: 'assistant', uuid: `a${i}`, message: { id: `m${i}`, role: 'assistant', content: [{ type: 'text', text: `ok ${i}` }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }, timestamp: new Date(1e12 + i * 1000 + 500).toISOString() });
const row = (id: string) => ({ sessionId: id, cwd: '/w', title: 't', lastModified: 0 }) as any;

describe('「正在别处更新」 after a process of ours exits', () => {
  it('loaded from history, nothing new on disk: no banner', async () => {
    const disk = [user(1), asst(1)];
    fake.handlers.set('transcript.load', () => ({ messages: disk }));
    useStore.setState({ sessions: [row('C')], open: {} });
    await useStore.getState().loadHistory('C', { focus: false });
    await useStore.getState().refreshExternal('C');
    expect(useStore.getState().open.C.externalAt).toBeUndefined();
  });

  it('started in this window (never read from disk), its process exits: no banner', async () => {
    const { createConversation } = await import('@/model/conversation');
    const disk = [user(1), asst(1)];
    fake.handlers.set('transcript.load', () => ({ messages: disk }));
    useStore.setState({ sessions: [row('A')], open: { A: { sessionId: 'A', cwd: '/w', conv: createConversation(), version: 0, state: 'idle', pending: [], loading: false, queue: [], draft: '', feedback: {} } as any } });
    emit({ kind: 'session.state', sessionId: 'A', state: 'closed' });
    await useStore.getState().refreshExternal('A');
    expect(useStore.getState().open.A.externalAt).toBeUndefined();
  });

  it('loaded, a turn ran here, the process exits: no banner — a turn written elsewhere afterwards: banner', async () => {
    let disk: any[] = [user(1), asst(1)];
    fake.handlers.set('transcript.load', () => ({ messages: disk }));
    useStore.setState({ sessions: [row('B')], open: {} });
    await useStore.getState().loadHistory('B', { focus: false });
    emit({ kind: 'session.state', sessionId: 'B', state: 'running' });
    disk = [...disk, user(2), asst(2)];
    emit({ kind: 'session.state', sessionId: 'B', state: 'idle' });
    emit({ kind: 'session.state', sessionId: 'B', state: 'closed' });
    await settle();
    await useStore.getState().refreshExternal('B');
    expect(useStore.getState().open.B.externalAt).toBeUndefined();
    disk = [...disk, user(3), asst(3)];
    await useStore.getState().refreshExternal('B');
    expect(useStore.getState().open.B.externalAt).toBeTypeOf('number');
  });

  it('the exit races the bookkeeping write: the read that comes first is the starting point', async () => {
    let disk: any[] = [user(1), asst(1)];
    fake.handlers.set('transcript.load', () => ({ messages: disk }));
    useStore.setState({ sessions: [row('D')], open: {} });
    await useStore.getState().loadHistory('D', { focus: false });
    emit({ kind: 'session.state', sessionId: 'D', state: 'running' });
    disk = [...disk, user(2), asst(2)];
    emit({ kind: 'session.state', sessionId: 'D', state: 'closed' });
    // no settle: refreshExternal reads before the starting-point read lands
    await useStore.getState().refreshExternal('D');
    expect(useStore.getState().open.D.externalAt).toBeUndefined();
  });

  it('a reconnect finds our process gone (no event — the resync marks it history): a later rename lights nothing', async () => {
    let disk: any[] = [user(1), asst(1)];
    fake.handlers.set('transcript.load', () => ({ messages: disk }));
    useStore.setState({ sessions: [row('E')], open: {} });
    await useStore.getState().loadHistory('E', { focus: false });
    emit({ kind: 'session.state', sessionId: 'E', state: 'running' });
    disk = [...disk, user(2), asst(2)];
    emit({ kind: 'session.state', sessionId: 'E', state: 'idle' });
    // the server came back without a process for it
    fake.handlers.set('session.info', () => { throw new Error('session E is not open'); });
    fake.handlers.set('settings.get', () => ({})); // the rest of what a reconnect loads
    const { ws } = await import('@/ws/client');
    ws.onStatus!(true);
    await vi.waitFor(() => expect(useStore.getState().open.E.state).toBe('history'));
    await settle();
    // a rename writes a title line, no message: the read finds what ran here
    await useStore.getState().refreshExternal('E');
    expect(useStore.getState().open.E.externalAt).toBeUndefined();
    disk = [...disk, user(3), asst(3)];
    await useStore.getState().refreshExternal('E');
    expect(useStore.getState().open.E.externalAt).toBeTypeOf('number');
    fake.handlers.delete('session.info');
  });

  it('the starting-point read fails: the next read is the starting point, the one after an outside write lights it', async () => {
    let disk: any[] = [user(1), asst(1)];
    let fail = false;
    fake.handlers.set('transcript.load', () => { if (fail) throw new Error('offline'); return { messages: disk }; });
    useStore.setState({ sessions: [row('F')], open: {} });
    await useStore.getState().loadHistory('F', { focus: false });
    emit({ kind: 'session.state', sessionId: 'F', state: 'running' });
    disk = [...disk, user(2), asst(2)];
    fail = true;
    emit({ kind: 'session.state', sessionId: 'F', state: 'closed' });
    await settle();
    fail = false;
    await useStore.getState().refreshExternal('F');
    expect(useStore.getState().open.F.externalAt).toBeUndefined();
    disk = [...disk, user(3), asst(3)];
    await useStore.getState().refreshExternal('F');
    expect(useStore.getState().open.F.externalAt).toBeTypeOf('number');
  });

  it('a send that was not taken (its process died unheard) is an exit of ours too', async () => {
    let disk: any[] = [user(1), asst(1)];
    fake.handlers.set('transcript.load', () => ({ messages: disk }));
    useStore.setState({ sessions: [row('G')], open: {} });
    await useStore.getState().loadHistory('G', { focus: false });
    emit({ kind: 'session.state', sessionId: 'G', state: 'running' });
    disk = [...disk, user(2), asst(2)];
    emit({ kind: 'session.state', sessionId: 'G', state: 'idle' });
    fake.handlers.set('session.send', () => { throw new Error('session G is not open'); });
    await useStore.getState().send('G', 'again').catch(() => {});
    expect(useStore.getState().open.G.state).toBe('error');
    await settle();
    await useStore.getState().refreshExternal('G');
    expect(useStore.getState().open.G.externalAt).toBeUndefined();
    fake.handlers.delete('session.send');
  });
});
