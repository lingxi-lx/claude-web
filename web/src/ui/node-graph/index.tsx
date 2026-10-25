import { lazy, Suspense } from 'react';
import type { NodeGraphProps } from './types';
export type { NodeGraphProps } from './types';
// The component (+ its CSS) is its own chunk: background panel and orchestra live in boot, which has ~85 KB headroom.
const Impl = lazy(() => import('./NodeGraph').then((m) => ({ default: m.NodeGraph })));
export function LazyNodeGraph(p: NodeGraphProps) {
  return (
    <Suspense fallback={<div className="ng ng-loading" style={{ height: p.height ?? 360 }} aria-busy="true" />}>
      <Impl {...p} />
    </Suspense>
  );
}
