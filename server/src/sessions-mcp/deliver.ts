// 跨对话工具: a message for a conversation that is busy waits for its turn to end (the official app does the same —
// a message never cuts into a turn). Queued here, sent as a new turn once the runner is idle; given up when the
// conversation closes or errors, or after `maxMs`.
interface Target { readonly state: string; send(text: string): void }

const BUSY = new Set(['starting', 'running', 'waiting']);

export function sendWhenIdle(r: Target, text: string, o: { every?: number; maxMs?: number; onGiveUp?: (why: string) => void } = {}): void {
  const every = o.every ?? 500;
  const until = Date.now() + (o.maxMs ?? 30 * 60_000);
  const tick = () => {
    if (r.state === 'closed' || r.state === 'error') return o.onGiveUp?.(r.state);
    if (BUSY.has(r.state)) {
      if (Date.now() > until) return o.onGiveUp?.('timeout');
      setTimeout(tick, every);
      return;
    }
    try { r.send(text); } catch (e) { o.onGiveUp?.((e as Error).message); }
  };
  tick();
}
