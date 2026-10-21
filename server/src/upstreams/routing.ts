// Request admission helpers: where a request may come from, which model it may ask for, and which gateway
// group it lands in. Pure functions so the rules can be read and tested without HTTP.
import net from 'node:net';
import type { GatewayGroup } from '../gateway/types.js';

/** IPv4 / IPv6 CIDR membership. An empty list matches nothing (the caller decides what empty means). */
export function ipInList(ip: string, list: string[]): boolean {
  if (!list.length) return false;
  const bl = new net.BlockList();
  for (const raw of list) {
    const [addr, bits] = raw.trim().split('/');
    const fam = net.isIP(addr);
    if (!fam) continue;
    try {
      if (bits === undefined) bl.addAddress(addr, fam === 6 ? 'ipv6' : 'ipv4');
      else bl.addSubnet(addr, Number(bits), fam === 6 ? 'ipv6' : 'ipv4');
    } catch { /* a malformed entry is ignored, not fatal */ }
  }
  const fam = net.isIP(ip);
  if (!fam) return false;
  try { return bl.check(ip, fam === 6 ? 'ipv6' : 'ipv4'); } catch { return false; }
}

/** `claude-*` style glob, case-insensitive, `*` only. */
export function globMatch(pattern: string, value: string): boolean {
  const re = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');
  return re.test(value);
}

/** deny wins over allow; an empty / missing allow list allows everything. */
export function modelAllowed(model: string, allow?: string[], deny?: string[]): boolean {
  if (deny?.some((p) => globMatch(p, model))) return false;
  if (!allow?.length) return true;
  return allow.some((p) => globMatch(p, model));
}

/**
 * Which group serves a request. An explicit `/<groupId>/…` path names one; a `group/model` id names one;
 * with a single allowed group it is that one; anything else is ambiguous and gets a 400 (the UI can say why).
 */
export function pickRouteGroup(o: {
  pathGroupId?: string;
  model: string;
  groups: GatewayGroup[];
  /** key group routeGroupIds; empty = all */
  allowed: string[];
}): { group: GatewayGroup; model: string } | { error: 'no-group' | 'ambiguous'; groups: string[] } {
  const allowed = o.allowed.length ? o.groups.filter((g) => o.allowed.includes(g.id)) : o.groups;
  if (o.pathGroupId) {
    const g = allowed.find((x) => x.id === o.pathGroupId);
    return g ? { group: g, model: o.model } : { error: 'no-group', groups: [] };
  }
  const pref = /^([A-Za-z0-9_-]{1,40})\/(.+)$/.exec(o.model);
  if (pref) {
    const g = allowed.find((x) => x.id === pref[1]);
    if (g) return { group: g, model: pref[2] };
  }
  if (allowed.length === 1) return { group: allowed[0], model: o.model };
  return { error: 'ambiguous', groups: allowed.map((g) => g.id) };
}
