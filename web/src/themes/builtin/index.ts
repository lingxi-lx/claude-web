// The character themes that ship with the app (spec 2026-10-22 §4). Each one is a folder: theme.json, backdrop.js
// (run in the backdrop worker, read here as text) and theme.css.
import type { ThemePack } from '../pack';

export const BUILTIN_SOURCES: { json: unknown; backdrop?: string; css?: string }[] = [];

export type { ThemePack };
