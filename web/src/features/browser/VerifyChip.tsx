// The strip under a turn whose preview check found errors (auto-verify.ts): 「预览有 N 个报错」, the errors when
// opened, and 「让 Claude 修」 — the errors and the picture into the input box (nothing is sent). While the check
// runs, a quiet 「正在检查预览…」.
import { useState } from 'react';
import { useStore } from '@/store';
import { Icon } from '@/ui/icons';
import { tr } from '@/i18n';
import { dismissVerify, fixWithClaude, useVerify } from './auto-verify';

export function VerifyChip({ sessionId, turnId }: { sessionId: string; turnId: string }) {
  const v = useVerify((s) => s.bySession[sessionId]);
  const [open, setOpen] = useState(false);
  if (!v || v.turn !== turnId) return null;
  if (v.status === 'checking') {
    return (
      <div className="verify-chip checking" data-id="verify-chip" data-state="checking">
        <span className="spin" aria-hidden />
        <span className="t">{tr('正在检查预览…')}</span>
      </div>
    );
  }
  const n = v.errors.length;
  const fix = () => {
    const st = useStore.getState();
    const did = fixWithClaude(sessionId, v, st);
    dismissVerify(sessionId);
    st.toast(did === 'bundle' ? tr('报错和截图已放进输入框') : tr('报错已放进输入框'), true);
  };
  return (
    <div className="verify-chip" data-id="verify-chip" data-state="errors" data-count={n}>
      <div className="row">
        <Icon name="alert" size={14} />
        <button className="link t" aria-expanded={open} onClick={() => setOpen(!open)} title={v.url}>{tr('预览有 {n} 个报错', { n })}</button>
        <span className="grow" />
        <button className="btn sm primary" data-act="verify-fix" onClick={fix} title={tr('把报错和截图放进输入框（不会自动发送）')}>{tr('让 Claude 修')}</button>
        <button className="icon-btn" data-act="verify-dismiss" onClick={() => dismissVerify(sessionId)} title={tr('关掉')} aria-label={tr('关掉')}><Icon name="close" size={13} /></button>
      </div>
      {open && (
        <ol className="errs" data-id="verify-errors">
          {v.errors.map((e, i) => <li key={i}><code>{e.text.slice(0, 400)}</code>{e.url && <span className="src">{e.url}</span>}</li>)}
        </ol>
      )}
    </div>
  );
}
