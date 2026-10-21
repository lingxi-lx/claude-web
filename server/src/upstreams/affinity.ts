// Session affinity for pools: the same conversation key stays on one account for the TTL, in memory only
// (the spec says a restart clears it). A failing account drops every binding it had.
export class AffinityTable {
  private map = new Map<string, { accountId: string; until: number }>();
  private k(groupId: string, key: string) { return `${groupId}\0${key}`; }

  get(groupId: string, key: string, now = Date.now()): string | undefined {
    const hit = this.map.get(this.k(groupId, key));
    if (!hit) return undefined;
    if (hit.until <= now) { this.map.delete(this.k(groupId, key)); return undefined; }
    return hit.accountId;
  }

  bind(groupId: string, key: string, accountId: string, ttlMinutes: number, now = Date.now()): void {
    this.map.set(this.k(groupId, key), { accountId, until: now + ttlMinutes * 60_000 });
  }

  drop(groupId: string, key: string): void { this.map.delete(this.k(groupId, key)); }

  dropAccount(accountId: string): void {
    for (const [k, v] of this.map) if (v.accountId === accountId) this.map.delete(k);
  }

  clear(): void { this.map.clear(); }
}
