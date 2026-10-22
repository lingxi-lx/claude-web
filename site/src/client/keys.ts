export type KeyAction = 'download' | 'source' | 'changelog' | 'github' | 'sound';
export interface KeyLike { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; isComposing: boolean; editable: boolean; repeat: boolean }

const KEYS: Record<string, KeyAction> = { d: 'download', r: 'source', c: 'changelog', g: 'github', s: 'sound' };

/** The site's single-letter shortcuts (shown on the buttons). Off while typing or composing (an IME's Enter / letters), and once per press (a held key repeats). */
export function keyAction(e: KeyLike): KeyAction | null {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.editable) return null;
  return KEYS[e.key.toLowerCase()] ?? null;
}
