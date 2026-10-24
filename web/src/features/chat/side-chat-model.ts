// 旁聊 (spec 2026-10-16 chat-input §1): what the side chat card holds, as plain data.
import type { SideTurn } from '@shared';

/** A question in the side chat; `response` undefined while it waits, null when the engine had no answer. */
export interface SideQA { id: string; question: string; response?: string | null; error?: string }

/** The turns the engine hears again with the next question: the answered ones, in order. */
export function sideHistory(qas: SideQA[]): SideTurn[] {
  return qas.filter((x) => typeof x.response === 'string' && !x.error).map((x) => ({ question: x.question, response: x.response as string }));
}

/** `/btw question` typed in the input box: the question ('' for a bare /btw), or null when it is something else. */
export function parseBtw(text: string): string | null {
  const m = /^\/btw(?:\s+([\s\S]*))?$/.exec(text.trim());
  return m ? (m[1] ?? '').trim() : null;
}

/** A quote from the selection menu's 旁聊 into the side chat's input line: in front of a question already typed there. */
export function withQuote(cur: string, quote: string): string {
  return cur.trim() ? quote + cur : quote;
}

/** 「放进对话」: the last answered question and its answer, as a draft for the conversation itself. */
export function sideDraft(qa: SideQA): string {
  return `${qa.question}\n\n> ${(qa.response ?? '').split('\n').join('\n> ')}`;
}
