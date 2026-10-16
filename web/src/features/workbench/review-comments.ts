// diff 行评论 (spec 2026-10-16 review-pr §1): the comments waiting to be handed to Claude, per conversation. In memory
// only — they are a message being written, not a record (the official app keeps them the same way).
import { create } from 'zustand';
import { useStore } from '@/store';
import { formatComments, type LineComment } from './review-comments-model';

export const useReviewComments = create<{ bySession: Record<string, LineComment[]> }>(() => ({ bySession: {} }));

const genId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

export function addComment(sessionId: string, c: Omit<LineComment, 'id'>): void {
  useReviewComments.setState((s) => ({ bySession: { ...s.bySession, [sessionId]: [...(s.bySession[sessionId] ?? []), { ...c, id: genId() }] } }));
}

export function removeComment(sessionId: string, id: string): void {
  useReviewComments.setState((s) => ({ bySession: { ...s.bySession, [sessionId]: (s.bySession[sessionId] ?? []).filter((x) => x.id !== id) } }));
}

export function clearComments(sessionId: string): void {
  useReviewComments.setState((s) => { const { [sessionId]: _, ...rest } = s.bySession; return { bySession: rest }; });
}

/** Sends the comments to the conversation as one message (queued if it is running) and clears them. */
export async function sendComments(sessionId: string): Promise<void> {
  const list = useReviewComments.getState().bySession[sessionId];
  if (!list?.length) return;
  clearComments(sessionId);
  try {
    await useStore.getState().send(sessionId, formatComments(list));
  } catch (e) {
    useReviewComments.setState((s) => ({ bySession: { ...s.bySession, [sessionId]: [...list, ...(s.bySession[sessionId] ?? [])] } }));
    throw e;
  }
}
