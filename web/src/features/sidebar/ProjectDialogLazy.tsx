import { lazy, Suspense } from 'react';
import { useProjectDialog } from './project-dialog-open';

// review X1: the dialog loads the first time it is opened, not with the app
const Host = lazy(() => import('./ProjectDialog').then((m) => ({ default: m.ProjectDialogHost })));

export function ProjectDialogLazy() {
  const open = useProjectDialog((s) => s.id !== null);
  return open ? <Suspense fallback={null}><Host /></Suspense> : null;
}
