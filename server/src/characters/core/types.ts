// 网吧's characters (spec docs/superpowers/specs/2026-10-13-cafe-design.md §4): a character is two 24 × 24 pixel
// pictures — front and back — in a palette of up to 16 colours, plus a small rig that says where the legs start, which
// pixels are the eyes and where the hands go. Every pose the cafe needs is made from those two pictures (frames.ts).
// Pure TS, no node:* — the web uses it through the `@characters` alias. Shared with the web through protocol.ts.

export const GRID = 24;
/** A pose frame has a pixel of room on every side (a bob, a hand below the picture). */
export const FRAME = GRID + 2;
export const MAX_COLORS = 16;
export const MAX_EYE_PIXELS = 32;

export interface Rig {
  /** The first row of the legs (12–23): walking moves the rows from here down; sitting hides them. */
  legs: number;
  /** The eye pixels (x, y) on the front picture: a blink paints them in the skin colour. */
  eyes: [number, number][];
  /** Where the hands go (x, y), 1–2: typing, playing and the noodle bowl are drawn there. */
  hands: [number, number][];
}

export interface CharacterDef {
  v: 1;
  /** `[a-z0-9-]{1,40}`; also the file name. */
  id: string;
  /** Shown over its head, 1–16 characters. */
  name: string;
  /** Letter → `#rrggbb`; `.` is transparent. */
  palette: Record<string, string>;
  /** 24 rows of 24 letters: facing the viewer (south-east; south-west is it mirrored). */
  front: string[];
  /** 24 rows of 24 letters: from behind (north-east; north-west is it mirrored). */
  back: string[];
  rig: Rig;
  /** Not saved yet: shown in the library as 草稿, not given to anyone. */
  draft?: boolean;
  /** Built into the app (the octopus, the admin): cannot be overwritten or deleted. */
  builtin?: boolean;
}

/** Towards the viewer's right / left (se / sw), away to the right / left (ne / nw). */
export type Facing = 'se' | 'sw' | 'ne' | 'nw';
export type Pose = 'stand' | 'walk' | 'sit' | 'type' | 'game' | 'eat' | 'blink';

/** A frame: `w × h` colours (`#rrggbb`) or null for transparent, row by row. */
export interface Frame { w: number; h: number; px: (string | null)[] }

/** Who gets which character (meta.json `cafe.assign`). Matched name > type > default; the admin by itself. */
export interface CafeAssign {
  admin?: string;
  default?: string;
  byType?: Record<string, string>;
  byName?: Record<string, string>;
}

/** `admin`, `default`, `type:<subagent type>` or `name:<agent name>`. */
export type AssignTarget = 'admin' | 'default' | `type:${string}` | `name:${string}`;

export type CharactersRequest =
  | { kind: 'characters.list' }
  | { kind: 'characters.save'; character: unknown; draft?: boolean }
  | { kind: 'characters.delete'; id: string }
  | { kind: 'characters.assign'; id: string | null; target: AssignTarget };

export interface CharactersList { characters: CharacterDef[]; assign: CafeAssign }
export type CharacterSaveResult = { ok: true; def: CharacterDef } | { ok: false; errors: string[] };

export type CharactersEvent = { kind: 'characters.changed' };
