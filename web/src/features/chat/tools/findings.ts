// 代码审查卡 (spec 2026-10-16 review-pr §2): the `ReportFindings` tool's input, as the card reads it.
import { tr } from '@/i18n';

export interface Finding {
  file: string;
  line?: number;
  summary: string;
  short_summary?: string;
  failure_scenario?: string;
  category?: string;
  verdict?: 'CONFIRMED' | 'PLAUSIBLE';
  outcome?: 'fixed' | 'skipped' | 'no_change_needed';
}

/** The findings of a ReportFindings call, with the index each had in it (the key for dismissing one). */
export function readFindings(input: unknown): { f: Finding; i: number }[] {
  const list = (input as { findings?: unknown })?.findings;
  if (!Array.isArray(list)) return [];
  return list
    .map((f, i) => ({ f: f as Finding, i }))
    .filter(({ f }) => f && typeof f.file === 'string' && typeof f.summary === 'string');
}

/** Grouped by file, in the order the files first appear (the list is most severe first). */
export function groupFindings<T extends { f: Finding }>(items: T[]): { file: string; items: T[] }[] {
  const out: { file: string; items: T[] }[] = [];
  for (const it of items) {
    const g = out.find((x) => x.file === it.f.file);
    if (g) g.items.push(it);
    else out.push({ file: it.f.file, items: [it] });
  }
  return out;
}

export const dismissKey = (toolUseId: string, i: number) => `${toolUseId}#${i}`;

/** Still to do: not dismissed here and not reported back as dealt with. */
export function openFindings<T extends { f: Finding; i: number }>(items: T[], toolUseId: string, dismissed: readonly string[]): T[] {
  return items.filter(({ f, i }) => !f.outcome && !dismissed.includes(dismissKey(toolUseId, i)));
}

const where = (f: Finding) => (f.line ? `${f.file}:${f.line}` : f.file);

/** 「修这一条」 / 「修复还开着的」: the message that asks Claude to fix them. */
export function fixMessage(items: Finding[]): string {
  if (items.length === 1) return tr('修复代码审查发现的这个问题：{where} — {summary}', { where: where(items[0]), summary: items[0].summary });
  return `${tr('修复代码审查发现的这些问题：')}\n\n${items.map((f, n) => `${n + 1}. ${where(f)} — ${f.summary}`).join('\n')}`;
}
