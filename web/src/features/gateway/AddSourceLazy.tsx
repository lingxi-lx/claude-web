import { lazy, Suspense } from 'react';
import { useAddSource } from './add-source';

// 添加来源 loads the first time it is opened, not with the app
const Host = lazy(() => import('./AddSourceWizard').then((m) => ({ default: m.AddSourceHost })));

export function AddSourceLazy() {
  const open = useAddSource((s) => s.open);
  return open ? <Suspense fallback={null}><Host /></Suspense> : null;
}
