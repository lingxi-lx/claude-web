// The right panel's 网吧: the cafe of the conversation in front, small; a guest opens its conversation on the 后台
// page (there is room for it there), the admin is the conversation itself.
import { lazy, Suspense } from 'react';
import { useStore } from '@/store';
import { openAgent, openBackground, useBackground } from '@/features/background/state';
import { ErrorBoundary } from '@/ui/ErrorBoundary';

const Cafe = lazy(() => import('./Cafe').then((m) => ({ default: m.Cafe })));

export function CafePanel() {
  const sid = useStore((s) => s.activeId);
  const session = useBackground((s) => (sid ? s.sessions[sid] : undefined));
  return (
    <div className="cafe-panel">
      <ErrorBoundary area="网吧">
        <Suspense fallback={null}>
          <Cafe
            session={session ?? (sid ? { sessionId: sid, updatedAt: 0, tasks: [], events: [] } : undefined)}
            compact
            onPick={(agentKey, taskId) => { if (sid && openBackground(sid, taskId)) openAgent({ sessionId: sid, taskId, agentKey }); }}
            onAdmin={() => { if (sid) useStore.getState().openInPane(sid, 'replace'); }}
          />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
