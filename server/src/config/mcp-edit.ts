export const MCP_MASK = '••••••';

export type McpScope = 'user' | 'project' | 'local';

/** Env / header names whose values are credentials: shown masked, kept as they were when the mask comes back. */
const SECRET_KEY = /key|token|secret|passw|auth|cookie|credential|bearer/i;
export const isSecretKey = (k: string) => SECRET_KEY.test(k);

const samePath = (a: string, b: string) => {
  const n = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
};

/**
 * Where `name` is configured, the way `claude mcp list` resolves it: this project only (`~/.claude.json`
 * projects[cwd]), then the repo's `.mcp.json`, then every project. null = not in any file we write (a plugin's).
 */
export function findMcp(name: string, userCfg: any, projectCfg: any, cwd?: string): { scope: McpScope; config: Record<string, any> } | null {
  if (cwd && userCfg?.projects && typeof userCfg.projects === 'object') {
    for (const [p, v] of Object.entries<any>(userCfg.projects)) {
      if (samePath(p, cwd) && own(v?.mcpServers, name)) return { scope: 'local', config: v.mcpServers[name] };
    }
  }
  if (own(projectCfg?.mcpServers, name)) return { scope: 'project', config: projectCfg.mcpServers[name] };
  if (own(userCfg?.mcpServers, name)) return { scope: 'user', config: userCfg.mcpServers[name] };
  return null;
}

const mapValues = (o: unknown, f: (k: string, v: string) => string) =>
  o && typeof o === 'object' ? Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, v]) => [k, f(k, String(v ?? ''))])) : o;

/** The config as the page sees it: credential-looking env / header values replaced by the mask. */
export function maskMcp(cfg: Record<string, any>): Record<string, any> {
  const m = (k: string, v: string) => (v && isSecretKey(k) ? MCP_MASK : v);
  return { ...cfg, ...(cfg.env ? { env: mapValues(cfg.env, m) } : {}), ...(cfg.headers ? { headers: mapValues(cfg.headers, m) } : {}) };
}

const own = (o: any, k: string) => (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

/**
 * What the page sent back, with every value still equal to the mask taken from the stored config. `from` maps a
 * row's key to the key it had when the form opened (a renamed row, or one moved between env and headers): its
 * value is looked up under that name. A mask with nothing stored behind it is refused, never saved as "".
 */
export function unmaskMcp(next: Record<string, any>, old: Record<string, any>, from: Record<string, string> = {}): Record<string, any> {
  const back = (field: 'env' | 'headers') => (k: string, v: string) => {
    if (v !== MCP_MASK) return v;
    const src = own(from, k) ?? k;
    const stored = own(old?.[field], src) ?? own(old?.env, src) ?? own(old?.headers, src);
    if (stored === undefined) throw new Error(`${k}: ${MCP_MASK}`);
    return String(stored);
  };
  const out = { ...next };
  if (next.env) out.env = mapValues(next.env, back('env'));
  if (next.headers) out.headers = mapValues(next.headers, back('headers'));
  for (const f of ['env', 'headers'] as const) if (out[f] && !Object.keys(out[f]).length) delete out[f];
  return out;
}
