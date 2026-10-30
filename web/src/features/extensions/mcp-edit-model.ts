/** `from`: the key the row had when the form opened (absent on rows added in the form). */
export type Pair = { k: string; v: string; from?: string };
export type McpKind = 'stdio' | 'http' | 'sse';

export const toPairs = (o: unknown): Pair[] => (o && typeof o === 'object' ? Object.entries(o as Record<string, unknown>).map(([k, v]) => ({ k, v: String(v ?? ''), from: k })) : []);

/** Renamed rows: new key → original key, so the server can put a masked value back under its new name. */
export function renamesOf(...lists: Pair[][]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ps of lists) for (const p of ps) if (p.from && p.k.trim() && p.k.trim() !== p.from) out[p.k.trim()] = p.from;
  return out;
}
const fromPairs = (ps: Pair[]) => Object.fromEntries(ps.filter((p) => p.k.trim()).map((p) => [p.k.trim(), p.v]));

/** The form's fields → the config to save; fields the form does not show (timeouts, oauth…) are kept as they were. */
export function buildMcpConfig(orig: Record<string, any>, f: { kind: McpKind; command: string; args: string; env: Pair[]; url: string; headers: Pair[] }): Record<string, any> {
  const { command: _c, args: _a, env: _e, url: _u, headers: _h, type: _t, ...rest } = orig;
  if (f.kind === 'stdio') {
    const args = f.args.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const env = fromPairs(f.env);
    return { ...rest, type: 'stdio', command: f.command.trim(), ...(args.length ? { args } : {}), ...(Object.keys(env).length ? { env } : {}) };
  }
  const headers = fromPairs(f.headers);
  return { ...rest, type: f.kind, url: f.url.trim(), ...(Object.keys(headers).length ? { headers } : {}) };
}
