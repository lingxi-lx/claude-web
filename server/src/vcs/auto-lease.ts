// PR 监控条's automatic actions (自动修 CI, 自动处理评论 and its replies, 自动归档) belong to one window per
// conversation (fix E-I3): every window that shows the bar asks for this lease each poll; only the holder acts. It runs
// out by itself (a closed or hidden window stops renewing it), so another window takes over within a few minutes.
export const LEASE_MS = 150_000;

export class AutoLeases {
  private held = new Map<string, { holder: string; until: number }>();

  /** Take or renew the lease of a conversation; false = another window holds it. */
  claim(sessionId: string, holder: string, now = Date.now()): boolean {
    if (!sessionId || !holder) return false;
    const cur = this.held.get(sessionId);
    if (cur && cur.holder !== holder && cur.until > now) return false;
    this.held.set(sessionId, { holder, until: now + LEASE_MS });
    if (this.held.size > 500) for (const [k, v] of this.held) if (v.until <= now) this.held.delete(k);
    return true;
  }

  /** The holder lets go (its bar left the screen). */
  release(sessionId: string, holder: string): void {
    if (this.held.get(sessionId)?.holder === holder) this.held.delete(sessionId);
  }
}

/** The one table of this process (hub.ts answers `vcs.autoLease` from it). */
export const autoLeases = new AutoLeases();
