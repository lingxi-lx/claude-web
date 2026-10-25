import { lazy, Suspense } from 'react';
import { useCloud } from './cloud-open';

// review X1: the dialogs load the first time one is opened, not with the app
const Host = lazy(() => import('./CloudDialogs').then((m) => ({ default: m.CloudDialogsHost })));

export function CloudDialogsLazy() {
  const open = useCloud((s) => s.d !== null);
  return open ? <Suspense fallback={null}><Host /></Suspense> : null;
}
