// Client credentials as the compatible APIs present them: OpenAI's `Authorization: Bearer …`,
// Anthropic's `x-api-key`, Gemini's `x-goog-api-key` or `?key=`. Pure: no settings lookup — the
// caller decides whether a query key is allowed (`?key=` lands in logs and shell history).

export type HeaderBag = Record<string, string | string[] | undefined>;
export type KeySource = 'bearer' | 'x-api-key' | 'x-goog-api-key' | 'query';

export interface ReadKeyOptions {
  /** accept `?key=` (default true; wire the gateway's `gateway.allowQueryKey` setting in here) */
  allowQuery?: boolean;
}

export interface PresentedKey {
  key: string;
  source: KeySource;
}

/** Either a bare header bag or a request-like object carrying one. */
export type KeySourceInput = HeaderBag | { headers?: HeaderBag };

function headerBagOf(source: KeySourceInput | undefined): HeaderBag | undefined {
  if (!source) return undefined;
  const maybe = (source as { headers?: HeaderBag }).headers;
  if (maybe && typeof maybe === 'object' && !Array.isArray(maybe)) return maybe;
  return source as HeaderBag;
}

/** Case-insensitive header read; an array takes its first non-empty entry. */
function headerOf(headers: HeaderBag | undefined, name: string): string {
  if (!headers) return '';
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== lower) continue;
    const raw = Array.isArray(v) ? v.find((x) => x.trim()) : v;
    return String(raw ?? '').trim();
  }
  return '';
}

function bearerOf(headers: HeaderBag | undefined): string {
  const m = /^Bearer\s+(.+)$/i.exec(headerOf(headers, 'authorization'));
  return m?.[1]?.trim() ?? '';
}

/**
 * Every credential the client presented, in preference order: Bearer, `x-api-key`,
 * `x-goog-api-key`, `?key=`. A client may send an empty / stale header next to a good one, so
 * verification can try them all.
 */
export function readKeys(
  source: KeySourceInput | undefined,
  url?: Pick<URL, 'searchParams'>,
  opts: ReadKeyOptions = {},
): PresentedKey[] {
  const headers = headerBagOf(source);
  const out: PresentedKey[] = [];
  const push = (key: string, from: KeySource) => {
    const k = key.trim();
    if (k) out.push({ key: k, source: from });
  };
  push(bearerOf(headers), 'bearer');
  push(headerOf(headers, 'x-api-key'), 'x-api-key');
  push(headerOf(headers, 'x-goog-api-key'), 'x-goog-api-key');
  if (opts.allowQuery !== false) push(url?.searchParams.get('key') ?? '', 'query');
  return out;
}

/** The first credential presented (what the simple handlers need). */
export function readKey(
  source: KeySourceInput | undefined,
  url?: Pick<URL, 'searchParams'>,
  opts: ReadKeyOptions = {},
): string | undefined {
  return readKeys(source, url, opts)[0]?.key;
}
