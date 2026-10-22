// The backdrop worker, made in one place: Vite turns `new Worker(new URL('./x.ts', import.meta.url))` into the built
// asset's address only in that exact form (a `new URL(…)` anywhere else becomes a second, raw copy of the source).
import { workerSandboxed } from './sandbox';

const said = new WeakMap<Worker, Promise<string>>();

export function backdropWorker(): Worker {
  const w = new Worker(new URL('./backdrop-worker.ts', import.meta.url), { type: 'module' });
  // a Worker does not say its address: the worker's first message does (`hello`)
  said.set(w, new Promise((resolve) => {
    const on = (e: MessageEvent<{ type?: string; url?: string }>) => {
      if (e.data?.type !== 'hello') return;
      w.removeEventListener('message', on);
      resolve(String(e.data.url));
    };
    w.addEventListener('message', on);
  }));
  return w;
}

/** Whether a theme that is not built in may run in this worker: its script came with the no-network CSP. */
export function sandboxReady(w: Worker): Promise<boolean> {
  const url = said.get(w);
  return url ? url.then((u) => workerSandboxed(new URL(u))) : Promise.resolve(false);
}
