// Messages between <Backdrop> and the backdrop worker.
export type ToWorker =
  | { type: 'init'; canvas: OffscreenCanvas; source: string; width: number; height: number; dpr: number; colors: Record<string, string>; scene: 'welcome' | 'chat'; speed: number; reduce: boolean; trusted: boolean; probe: string }
  | { type: 'resize'; width: number; height: number; dpr: number }
  | { type: 'pointer'; x: number | null; y?: number; down?: boolean; click?: boolean }
  | { type: 'type'; text: string }
  | { type: 'process'; process: string }
  | { type: 'colors'; colors: Record<string, string> }
  | { type: 'data'; data: unknown }
  /** where the page's words are (canvas px): a backdrop keeps these quiet */
  | { type: 'quiet'; rects: { x: number; y: number; w: number; h: number }[] }
  | { type: 'pause' }
  | { type: 'resume' };

/** `still`: motion is reduced and the still frame is drawn — no more word until the next resize */
export type FromWorker = { type: 'stats'; avgMs: number } | { type: 'error'; message: string } | { type: 'still' };
