// Messages between <Backdrop> and the backdrop worker.
export type ToWorker =
  | { type: 'init'; canvas: OffscreenCanvas; source: string; width: number; height: number; dpr: number; colors: Record<string, string>; scene: 'welcome' | 'chat'; speed: number; reduce: boolean }
  | { type: 'resize'; width: number; height: number; dpr: number }
  | { type: 'pointer'; x: number | null; y?: number; down?: boolean; click?: boolean }
  | { type: 'type'; text: string }
  | { type: 'process'; process: string }
  | { type: 'colors'; colors: Record<string, string> }
  | { type: 'data'; data: unknown }
  | { type: 'pause' }
  | { type: 'resume' };

export type FromWorker = { type: 'stats'; avgMs: number } | { type: 'error'; message: string };
