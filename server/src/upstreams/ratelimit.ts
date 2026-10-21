// Per-key admission: a one-minute request window and a cap on in-flight requests. In memory — a restart
// forgets both, which is what a rate limit is for.
export interface Limits { rpm?: number; concurrent?: number }

export class RateLimiter {
  private hits = new Map<string, number[]>();
  private live = new Map<string, number>();

  take(id: string, limits: Limits | undefined, now = Date.now()): { ok: true; release(): void } | { ok: false; reason: 'rpm' | 'concurrent'; retryAfterMs: number } {
    if (!limits || (!limits.rpm && !limits.concurrent)) return { ok: true, release: () => {} };
    if (limits.concurrent) {
      const n = this.live.get(id) ?? 0;
      if (n >= limits.concurrent) return { ok: false, reason: 'concurrent', retryAfterMs: 1000 };
    }
    if (limits.rpm) {
      const list = (this.hits.get(id) ?? []).filter((t) => now - t < 60_000);
      this.hits.set(id, list);
      if (list.length >= limits.rpm) return { ok: false, reason: 'rpm', retryAfterMs: 60_000 - (now - list[0]) };
    }
    if (limits.rpm) this.hits.get(id)!.push(now);
    if (limits.concurrent) this.live.set(id, (this.live.get(id) ?? 0) + 1);
    let done = false;
    return {
      ok: true,
      release: () => {
        if (done) return;
        done = true;
        if (limits.concurrent) this.live.set(id, Math.max(0, (this.live.get(id) ?? 1) - 1));
      },
    };
  }
}
