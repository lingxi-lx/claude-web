export interface Area { dir: string; catalog: string; export: string }
export const AREAS: Area[];
export function sourceFiles(dir: string): string[];
export function areaOf(root: string, file: string): Area | undefined;
export function keysIn(file: string, src: string): { keys: { key: string; file: string; pos: number; params: string[] }[]; dynamic: { file: string; pos: number }[] };
export function collectKeys(root: string): { byArea: Map<string, Map<string, { file: string; pos: number; params: string[] }[]>>; dynamic: { file: string; pos: number }[] };
export function rawChinese(file: string, src: string): { file: string; pos: number; text: string }[];
