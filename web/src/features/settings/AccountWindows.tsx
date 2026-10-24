import { useEffect, useState } from 'react';
import type { AccountFamily, AccountWindows as Windows } from '@account-window';
import { Segmented } from '@/ui/Segmented';
import { imeComposing } from '@/ui/ime';
import { tr } from '@/i18n';
import { CompactAt } from './CompactAt';
import { accountCompactWindow } from './compact-model';

export interface AccountPrefsDraft { windows: Windows; compactAt?: number; /** why the typed 自动压缩 point is not saved */ error?: string }

const FAMILIES: { f: AccountFamily; l: string }[] = [{ f: 'opus', l: 'Opus' }, { f: 'sonnet', l: 'Sonnet' }, { f: 'fable', l: 'Fable' }];
type Size = '200000' | '1000000';

/**
 * The Claude account's windows (spec 2026-10-24 A7): 200K / 1M for each family that has 1M (1M unless picked), Haiku
 * fixed at 200K, then 自动压缩 checked against the largest pick. Used for the own login (settings claude.contextWindows /
 * claude.compactAt) and for a claude-account profile (its contextWindows / compactAt).
 * `onChange` gets an update of the draft (a state setter fits): two picks before a render must not undo each other.
 */
export function AccountWindows({ windows, compactAt, onChange, onEnter }: { windows: Windows; compactAt: number | undefined; onChange: (update: (prev: AccountPrefsDraft) => AccountPrefsDraft) => void; onEnter?: () => void }) {
  const put = (f: AccountFamily, s: Size) => onChange((p) => ({ ...p, windows: { ...p.windows, [f]: Number(s) as 200_000 | 1_000_000 } }));
  return (
    <div className="account-windows" data-act="account-windows">
      <div className="aw-rows">
        {FAMILIES.map(({ f, l }) => (
          <div key={f} className="aw-row" data-family={f}>
            <span className="aw-name">{l}</span>
            <Segmented<Size> className="sp-seg" label={l} arrows value={String(windows[f] ?? 1_000_000) as Size} onChange={(s) => put(f, s)}
              options={[{ value: '200000', label: '200K', data: { 'data-size': '200000' } }, { value: '1000000', label: '1M', data: { 'data-size': '1000000' } }]} />
          </div>
        ))}
        <div className="aw-row dim" data-family="haiku">
          <span className="aw-name">Haiku</span>
          <span className="sub">{tr('200K（只有这一档）')}</span>
        </div>
      </div>
      <div className="sub aw-hint">{tr('选 1M 的模型发给 Claude 时带 [1m]。新对话立刻用，正在跑的对话重新打开后用。')}</div>
      <CompactAt value={compactAt} window={accountCompactWindow(windows)} onEnter={onEnter}
        onChange={(v, e) => onChange((p) => ({ ...p, compactAt: v, error: e }))} />
    </div>
  );
}

/**
 * 「Claude 账号的上下文窗口」 as a dialog with 保存 / 取消 (nothing reaches the conversations until 保存: each save may
 * restart idle ones on the new picks). `name`: whose account, under the title (a claude-account profile).
 */
export function AccountWindowsDialog({ name, windows, compactAt, onSave, onClose }: { name?: string; windows: Windows; compactAt: number | undefined; onSave: (p: { windows: Windows; compactAt?: number }) => Promise<void>; onClose: () => void }) {
  const [draft, setDraft] = useState<AccountPrefsDraft>({ windows, compactAt });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // the refusal shown by 保存 goes once the point holds
  useEffect(() => { if (!draft.error) setErr(''); }, [draft.error]);
  const save = async () => {
    if (busy) return;
    if (draft.error) { setErr(draft.error); return; }
    setBusy(true);
    setErr('');
    try {
      await onSave({ windows: draft.windows, compactAt: draft.compactAt });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-bg dialog-bg" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()} onKeyDown={(e) => { if (e.key === 'Escape' && !imeComposing(e.nativeEvent) && !busy) { e.stopPropagation(); onClose(); } }}>
      <div className="modal account-windows-dlg" role="dialog" aria-modal="true" aria-label={tr('Claude 账号的上下文窗口')} data-act="account-windows-dialog">
        <h3>{tr('Claude 账号的上下文窗口')}</h3>
        {name && <div className="sub aw-who">{name}</div>}
        <AccountWindows windows={draft.windows} compactAt={draft.compactAt} onChange={setDraft} onEnter={() => void save()} />
        {err && <div className="sub err" role="alert">{err}</div>}
        <div className="row-btns">
          <span className="grow" />
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>{tr('取消')}</button>
          <button type="button" className="btn primary" data-act="account-windows-save" disabled={busy} onClick={() => void save()}>{tr('保存')}</button>
        </div>
      </div>
    </div>
  );
}
