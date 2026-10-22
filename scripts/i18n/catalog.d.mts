import type { Area } from './scan.mjs';

export const root: string;
export function readCatalog(area: Pick<Area, 'catalog' | 'export'>): Record<string, string>;
export function writeCatalog(area: Pick<Area, 'catalog' | 'export'>, entries: Record<string, string>): void;
