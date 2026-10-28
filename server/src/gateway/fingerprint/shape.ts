// Header and body shaping for a client fingerprint: identity headers, header order / casing, top-level JSON key order.
// Pure functions (the wire-level reorder in agent.ts uses `orderPairs` too).
import type { Profile } from './profiles.js';

const lower = (s: string) => s.toLowerCase();

/**
 * `pairs` in `order` (names compared case-insensitively, written with the casing in `order`); headers the order does not
 * name follow in their original relative order (CPA httpwire.NewOrderedRequestConn). Duplicates of one name stay together.
 */
export function orderPairs(pairs: [string, string][], order: readonly string[]): [string, string][] {
  const out: [string, string][] = [];
  const used = new Set<number>();
  for (const name of order) {
    const l = lower(name);
    pairs.forEach(([n, v], i) => {
      if (!used.has(i) && lower(n) === l) { out.push([name, v]); used.add(i); }
    });
  }
  pairs.forEach((p, i) => { if (!used.has(i)) out.push(p); });
  return out;
}

function findKey(h: Record<string, string>, name: string): string | undefined {
  const l = lower(name);
  return Object.keys(h).find((k) => lower(k) === l);
}

/**
 * The request headers as the profile's client would send them: its User-Agent (a request that already carries the
 * client's own UA keeps its version; Claude Code's entrypoint becomes `cli` and an `agent-sdk/…` tag goes — relays
 * reject both), its identity headers, in its order. The credential, beta flags and everything else keep their values.
 */
export function shapeHeaders(profile: Profile, headers: Record<string, string>, ctx: { path: string; stream: boolean }): Record<string, string> {
  const h: Record<string, string> = { ...headers };
  const uaKey = findKey(h, 'user-agent');
  const current = uaKey ? h[uaKey] : '';
  let ua = profile.userAgent;
  if (current && profile.uaPrefix.test(current)) {
    ua = profile.id === 'claude-code' ? current.replace(/\(external,[^)]*\)/, '(external, cli)') : current;
  }
  if (uaKey) h[uaKey] = ua; else h['User-Agent'] = ua;
  for (const id of profile.identity(ctx)) {
    const k = findKey(h, id.name);
    if (k === undefined) h[id.name] = id.value;
    else if (id.mode === 'set' || !h[k]) h[k] = id.value;
  }
  const ordered = orderPairs(Object.entries(h), profile.headerOrder(ctx.path));
  const out: Record<string, string> = {};
  for (const [n, v] of ordered) out[n] = v;
  return out;
}

/** The top-level members of a JSON object text as raw slices (key + value bytes untouched), or null when it is not one. */
export function topLevelMembers(json: string): { key: string; raw: string }[] | null {
  const n = json.length;
  let i = 0;
  while (i < n && /\s/.test(json[i])) i++;
  if (json[i] !== '{') return null;
  const members: { key: string; raw: string }[] = [];
  let depth = 0;
  let start = -1;
  let key: string | null = null;
  let expectKey = true;
  for (; i < n; i++) {
    const c = json[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && json[j] !== '"') j += json[j] === '\\' ? 2 : 1;
      if (j >= n) return null;
      if (depth === 1 && expectKey) {
        try { key = JSON.parse(json.slice(i, j + 1)); } catch { return null; }
        start = i;
        expectKey = false;
      }
      i = j;
      continue;
    }
    if (c === '{' || c === '[') { depth++; continue; }
    if ((c === '}' || c === ']') && depth > 1) { depth--; continue; }
    if ((c === ',' && depth === 1) || (c === '}' && depth === 1)) {
      if (key !== null && start >= 0) members.push({ key, raw: json.slice(start, i).trimEnd() });
      key = null; start = -1; expectKey = true;
      if (c === '}') {
        // only whitespace may follow the object
        if (json.slice(i + 1).trim()) return null;
        return members;
      }
    }
  }
  return null;
}

/**
 * The JSON object text with its top-level keys in `order` (unlisted keys after, in their own order). Each member's
 * bytes stay what they were — only their sequence changes; text that is already in order is returned as is.
 */
export function reorderTopLevel(json: string, order: readonly string[]): string {
  const members = topLevelMembers(json);
  if (!members || members.length < 2) return json;
  const rank = new Map(order.map((k, i) => [k, i]));
  const sorted = members
    .map((m, i) => ({ m, i, r: rank.get(m.key) ?? order.length }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.m);
  if (sorted.every((m, i) => m === members[i])) return json;
  return `{${sorted.map((m) => m.raw).join(',')}}`;
}

/** A body Buffer in the profile's key order; null / non-JSON bodies come back unchanged. */
export function shapeBody<T extends Buffer | null>(profile: Profile, body: T): T {
  if (!body || !body.length) return body;
  const text = body.toString('utf8');
  const out = reorderTopLevel(text, profile.bodyOrder);
  return (out === text ? body : Buffer.from(out, 'utf8')) as T;
}
