// 智能路由: a conversation keeps the model it got (§7.2 step 4) — its context, tool format and prompt cache stay
// valid — until that model becomes unusable. In memory only: a restart picks again (spec §8: no temporary state synced).

const TTL_MS = 6 * 60 * 60_000;
const MAX = 2000;

export class Affinity {
  private map = new Map<string, { key: string; at: number }>();

  get(groupId: string, session: string | undefined, now = Date.now()): string | undefined {
    if (!session) return undefined;
    const k = `${groupId}\u0000${session}`;
    const v = this.map.get(k);
    if (!v) return undefined;
    if (now - v.at > TTL_MS) { this.map.delete(k); return undefined; }
    return v.key;
  }

  set(groupId: string, session: string | undefined, key: string, now = Date.now()) {
    if (!session) return;
    const k = `${groupId}\u0000${session}`;
    this.map.delete(k);
    this.map.set(k, { key, at: now });
    if (this.map.size > MAX) this.map.delete(this.map.keys().next().value!);
  }

  clear(groupId?: string) {
    if (!groupId) { this.map.clear(); return; }
    for (const k of [...this.map.keys()]) if (k.startsWith(`${groupId}\u0000`)) this.map.delete(k);
  }
}
