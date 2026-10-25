// The question card in the conversation (stage C1): one question a page, answers kept while paging, the answer
// format the CLI expects unchanged (`updatedInput.answers`: question → the chosen labels joined with ", ").
// Pure; the card is AskCard.tsx.
import { tr } from '@/i18n';

export interface AskOption { label: string; description?: string; preview?: string }
export interface AskQ { question: string; header?: string; options: AskOption[]; multiSelect: boolean }
export interface AskDraft { picked: string[]; otherOn: boolean; other: string; skipped: boolean }
export const EMPTY_DRAFT: AskDraft = { picked: [], otherOn: false, other: '', skipped: false };
/** the 其它 row's key (never a real label) */
export const OTHER = '\u0000other';
export const skippedAnswer = () => tr('（用户跳过）');

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

export function askQuestions(input: unknown): AskQ[] {
  const qs = (input as { questions?: unknown } | null | undefined)?.questions;
  if (!Array.isArray(qs)) return [];
  return qs
    .filter((q): q is Record<string, any> => !!q && typeof q === 'object' && typeof q.question === 'string')
    .map((q) => ({
      question: q.question,
      header: str(q.header),
      options: (Array.isArray(q.options) ? q.options : [])
        .filter((o: any) => !!o && typeof o.label === 'string')
        .map((o: any) => ({ label: o.label, description: str(o.description), preview: str(o.preview) })),
      multiSelect: q.multiSelect === true,
    }));
}

export function pick(q: AskQ, d: AskDraft, label: string): AskDraft {
  if (label === OTHER) return q.multiSelect ? { ...d, otherOn: !d.otherOn, skipped: false } : { ...d, picked: [], otherOn: true, skipped: false };
  if (q.multiSelect) return { ...d, picked: d.picked.includes(label) ? d.picked.filter((x) => x !== label) : [...d.picked, label], skipped: false };
  return { ...d, picked: [label], otherOn: false, skipped: false };
}

export const skip = (d: AskDraft): AskDraft => ({ ...d, skipped: true });

export function answerOf(q: AskQ, d: AskDraft | undefined): string | null {
  if (!d) return null;
  if (d.skipped) return skippedAnswer();
  const chosen = q.options.map((o) => o.label).filter((l) => d.picked.includes(l));
  const other = d.otherOn ? d.other.trim() : '';
  if (d.otherOn && !other) return null;
  const all = other ? [...chosen, other] : chosen;
  return all.length ? all.join(', ') : null;
}

export type Assembled = { kind: 'allow'; answers: Record<string, string> } | { kind: 'deny' } | { kind: 'incomplete'; first: number };

export function assemble(qs: AskQ[], drafts: readonly (AskDraft | undefined)[]): Assembled {
  if (qs.length > 0 && qs.every((_, i) => drafts[i]?.skipped)) return { kind: 'deny' };
  const answers: Record<string, string> = {};
  for (let i = 0; i < qs.length; i++) {
    const a = answerOf(qs[i], drafts[i]);
    if (a === null) return { kind: 'incomplete', first: i };
    answers[qs[i].question] = a;
  }
  return { kind: 'allow', answers };
}

export type Step = { t: 'goto'; index: number } | { t: 'send'; result: Exclude<Assembled, { kind: 'incomplete' }> } | { t: 'stay' };

export function step(qs: AskQ[], drafts: readonly (AskDraft | undefined)[], cur: number): Step {
  if (!qs[cur] || answerOf(qs[cur], drafts[cur]) === null) return { t: 'stay' };
  if (cur < qs.length - 1) return { t: 'goto', index: cur + 1 };
  const r = assemble(qs, drafts);
  return r.kind === 'incomplete' ? { t: 'goto', index: r.first } : { t: 'send', result: r };
}

export type AskKeyAct = { t: 'move'; by: 1 | -1 } | { t: 'pick'; index: number } | { t: 'next' } | null;

export function askKey(k: { key: string; ctrl?: boolean; meta?: boolean; shift?: boolean; composing?: boolean; inText?: boolean }, optionCount: number): AskKeyAct {
  if (k.composing) return null;
  if (k.key === 'Enter') return k.shift && !k.ctrl && !k.meta ? null : { t: 'next' };
  if (k.inText) return null;
  if (k.key === 'ArrowDown') return { t: 'move', by: 1 };
  if (k.key === 'ArrowUp') return { t: 'move', by: -1 };
  if (/^[1-9]$/.test(k.key)) {
    const i = Number(k.key) - 1;
    return i <= optionCount ? { t: 'pick', index: i } : null;
  }
  return null;
}
