// Privacy pipeline (spec 2026-10-26 §4): what the user sets, what the center shows. Shared with web through protocol.ts.

export type PrivacyCategory = 'api_key' | 'private_key' | 'jwt' | 'password' | 'email' | 'phone' | 'id_card' | 'bank_card' | 'custom';
export const PRIVACY_CATEGORIES: PrivacyCategory[] = ['api_key', 'private_key', 'jwt', 'password', 'email', 'phone', 'id_card', 'bank_card', 'custom'];
/** off: not looked for; redact: placeholder out, original back; warn: sent as is, counted; block: the request is not sent */
export type PrivacyAction = 'off' | 'redact' | 'warn' | 'block';

export interface PrivacySettings {
  enabled: boolean;
  actions: Record<PrivacyCategory, PrivacyAction>;
  /** custom words (names, project code names, host names…): matched literally, case-insensitive */
  words: string[];
  /** custom regular expressions (JavaScript syntax, matched globally) */
  patterns: string[];
  /** values that always go out as they are */
  allow: string[];
  /** upstreams on this machine / the local network are not processed (a sidecar that forwards to the cloud never counts) */
  skipLocal: boolean;
}

export interface PrivacyHit { category: PrivacyCategory; action: Exclude<PrivacyAction, 'off'>; placeholder?: string; length: number }

/** One request's record: types, counts and placeholders only — never a value. */
export interface PrivacyRecord { ts: number; source: string; count: number; categories: Partial<Record<PrivacyCategory, number>>; placeholders: string[]; blocked?: boolean; warned?: number }

export interface PrivacyStats { since: number; requests: number; redacted: number; warned: number; blocked: number; hits: Partial<Record<PrivacyCategory, number>>; recent: PrivacyRecord[] }

export interface PrivacyStatus { settings: PrivacySettings; stats: PrivacyStats; /** custom patterns that do not compile */ badPatterns: string[] }

export interface PrivacyPreview { text: string; hits: PrivacyHit[]; blocked: boolean; badPatterns: string[] }

export type PrivacyRequest =
  | { kind: 'privacy.get' }
  | { kind: 'privacy.set'; patch: Partial<Omit<PrivacySettings, 'actions'>> & { actions?: Partial<Record<PrivacyCategory, PrivacyAction>> } }
  /** what an upstream would get for this text with the current (or given) settings; nothing is stored */
  | { kind: 'privacy.preview'; text: string; settings?: PrivacySettings };

export const DEFAULT_PRIVACY: PrivacySettings = {
  enabled: false,
  actions: { api_key: 'redact', private_key: 'redact', jwt: 'redact', password: 'redact', email: 'off', phone: 'off', id_card: 'redact', bank_card: 'redact', custom: 'redact' },
  words: [],
  patterns: [],
  allow: [],
  skipLocal: true,
};
