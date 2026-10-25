import { lazy, Suspense } from 'react';
import { useRecording } from './recorder';

// review X1: the 录屏 picker (and its countdown) load the first time a recording is started, not with the app
const Picker = lazy(() => import('./SourcePicker').then((m) => ({ default: m.SourcePicker })));

export function SourcePickerLazy() {
  const on = useRecording((s) => s.phase === 'picking' || s.phase === 'countdown');
  return on ? <Suspense fallback={null}><Picker /></Suspense> : null;
}
