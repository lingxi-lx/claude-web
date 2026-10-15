import type { Area } from './scan.mjs';
export function readCatalog(area: Area): Record<string, string>;
export function missingByArea(): { area: Area; used: Map<string, unknown[]>; have: Record<string, string>; missing: [string, unknown[]][]; unused: string[] }[];
