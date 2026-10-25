// 录屏 in the composer (spec E3, fix E-minor): the keyframes are taken as soon as a recording is in the box and shown
// under its chip, each with a remove button — what is sent is what the user saw. Pure.
import type { PendingRecording } from './recorder';

export type Frame = { mediaType: 'image/jpeg'; data: string };
/** frames: taken (possibly trimmed by the user); undefined = still being taken; framesFailed = could not be taken */
export type ComposerRecording = PendingRecording & { frames?: Frame[]; framesFailed?: boolean };

export function withFrames(list: readonly ComposerRecording[], id: string, frames: Frame[] | null): ComposerRecording[] {
  return list.map((r) => (r.id !== id ? r : frames ? { ...r, frames, framesFailed: false } : { ...r, frames: undefined, framesFailed: true }));
}

export function withoutFrame(list: readonly ComposerRecording[], id: string, index: number): ComposerRecording[] {
  return list.map((r) => (r.id === id && r.frames ? { ...r, frames: r.frames.filter((_, i) => i !== index) } : r));
}

/** What a recording sends: its shown frames ('ready'), none because they could not be taken ('failed'), or not yet taken ('pending'). */
export function framesState(r: ComposerRecording): 'ready' | 'failed' | 'pending' {
  return r.frames ? 'ready' : r.framesFailed ? 'failed' : 'pending';
}
