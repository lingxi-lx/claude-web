// PR 监控条 (spec 2026-10-16 review-pr §3): the pull request of the conversation's branch, over the conversation —
// its checks, and a CI menu: 自动修 CI (the conversation is asked to fix a failed check, once per push), 就绪后自动合并
// (GitHub auto-merge, squash). With 设置 → PR 合并或关闭后自动归档对话 the conversation archives itself when the PR is done.
import { useCallback, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { parsePeerId, type BranchPr } from '@shared';
import { useStore } from '@/store';
import { ws } from '@/ws/client';
import { clsx } from '@/util';
import { Icon } from '@/ui/icons';
import { tr } from '@/i18n';
import { Popover } from '@/features/composer/Popover';
import { ciFixMessage, fixKey, newFailures, prSettled } from './pr-bar-model';

const POLL_MS = 60_000;
const NONE: string[] = [];

// One bar per conversation does the work, whichever on-screen one asked first: it polls, and only it auto-fixes or
// auto-archives (a conversation can sit in two panes; hidden tabs stay mounted). The others draw what it found.
/** also read by 总览 (MissionPanel): what the bars found, by conversation */
export const usePrs = create<{ bySession: Record<string, BranchPr | null> }>(() => ({ bySession: {} }));
const owners = new Map<string, symbol>();
const claim = (sid: string, me: symbol) => { const o = owners.get(sid); if (o && o !== me) return false; owners.set(sid, me); return true; };
// asked already in this window, before meta.json's `prFixed` comes back round (two renders a frame apart must not both send)
const sentFix = new Set<string>();
// 自动归档 acts on a PR this window saw open: turning the setting on must not sweep up conversations whose PRs were
// merged months ago; one try each (a Codex conversation's archive never shows in sessionMeta)
const sawOpen = new Set<string>();

export function PrBar({ sessionId, visible = true }: { sessionId: string; visible?: boolean }) {
  const cwd = useStore((s) => s.open[sessionId]?.cwd);
  const state = useStore((s) => s.open[sessionId]?.state);
  const autoFix = useStore((s) => !!s.sessionMeta[sessionId]?.prAutoFix);
  const asked = useStore((s) => s.sessionMeta[sessionId]?.prFixed) ?? NONE;
  const autoArchive = useStore((s) => s.settings['ui.autoArchivePr'] === true);
  const pr = usePrs((s) => s.bySession[sessionId] ?? null);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const ciBtn = useRef<HTMLButtonElement>(null);
  const me = useRef(Symbol('pr-bar')).current;
  const remote = !!parsePeerId(sessionId);
  const idle = state === 'idle' || state === 'history' || state === 'closed';
  const on = visible && !remote && !!cwd;

  useEffect(() => () => { if (owners.get(sessionId) === me) owners.delete(sessionId); }, [sessionId, me]);
  useEffect(() => { if (!visible && owners.get(sessionId) === me) owners.delete(sessionId); }, [visible, sessionId, me]);

  const refresh = useCallback(async () => {
    if (!on || !claim(sessionId, me)) return;
    try {
      const r = (await ws.request({ kind: 'vcs.prForBranch', cwd: cwd! })) as { pr?: BranchPr };
      const next = r.pr ?? null;
      if (next?.state === 'open') sawOpen.add(sessionId);
      usePrs.setState((st) => ({ bySession: { ...st.bySession, [sessionId]: next } }));
    } catch { /* offline / rate-limited: keep what is shown */ }
  }, [on, cwd, sessionId, me]);

  // on open, whenever a turn ends (it may have pushed or opened the PR), and every minute while it is on screen
  useEffect(() => { if (idle) void refresh(); }, [idle, refresh]);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, POLL_MS);
    return () => clearInterval(t);
  }, [on, refresh]);

  // 自动修 CI: a check failed on the pushed commit and the conversation is not busy — ask it once
  useEffect(() => {
    if (!pr || !autoFix || !idle || owners.get(sessionId) !== me) return;
    const fs = newFailures(pr, asked).filter((x) => !sentFix.has(fixKey(pr, x)));
    if (!fs.length) return;
    const keys = fs.map((x) => fixKey(pr, x));
    keys.forEach((k) => sentFix.add(k));
    const st = useStore.getState();
    void st.setSessionMeta(sessionId, { prFixed: [...asked, ...keys].slice(-50) });
    st.send(sessionId, ciFixMessage(pr, fs)).catch((e) => st.toast(String(e?.message ?? e)));
  }, [pr, autoFix, idle, asked, sessionId, me]);

  // 自动归档: a PR seen open here is now merged / closed, nothing running
  useEffect(() => {
    if (!autoArchive || !idle || !prSettled(pr) || !sawOpen.has(sessionId) || owners.get(sessionId) !== me) return;
    sawOpen.delete(sessionId);
    const merged = pr!.state === 'merged';
    ws.request({ kind: 'library.archive', sessionIds: [sessionId], archived: true })
      .then(() => useStore.getState().toast(merged ? tr('PR #{n} 已合并，对话已归档', { n: pr!.number }) : tr('PR #{n} 已关闭，对话已归档', { n: pr!.number }), true))
      .catch((e) => useStore.getState().toast(String(e?.message ?? e)));
  }, [autoArchive, idle, pr, sessionId, me]);

  if (!pr || remote) return null;
  const c = pr.checks;
  const setAutoMerge = async (on: boolean) => {
    if (!cwd) return;
    setBusy(true);
    try { await ws.request({ kind: 'vcs.autoMerge', cwd, prId: pr.id, on }); await refresh(); }
    catch (e: any) { useStore.getState().toast(tr('没能设置自动合并：{msg}（仓库要先在 GitHub 设置里允许 auto-merge）', { msg: String(e?.message ?? e) })); }
    setBusy(false);
  };
  const stateWord = pr.state === 'merged' ? tr('已合并') : pr.state === 'closed' ? tr('已关闭') : pr.draft ? tr('草稿') : pr.mergeable === false ? tr('有冲突') : '';
  return (
    <div className={clsx('pr-bar', pr.state)} role="status">
      <Icon name="branch" size={13} />
      <a className="pr-n" href={pr.url} target="_blank" rel="noreferrer" title={pr.title}>PR #{pr.number}</a>
      <span className="pr-t">{pr.title}</span>
      {stateWord && <span className="pr-state">{stateWord}</span>}
      {pr.state === 'open' && c.total > 0 && (
        <span className="pr-checks" title={c.failures.map((f) => f.name).join('\n') || undefined}>
          {c.passed > 0 && <span className="ok"><Icon name="check" size={11} />{c.passed}</span>}
          {c.failed > 0 && <span className="bad"><Icon name="close" size={11} />{c.failed}</span>}
          {c.pending > 0 && <span className="wait"><Icon name="circle" size={10} />{c.pending}</span>}
        </span>
      )}
      {pr.state === 'open' && (
        <button ref={ciBtn} className={clsx('pr-ci', (autoFix || pr.autoMerge) && 'on')} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          CI <Icon name="chevronDown" size={10} />
        </button>
      )}
      {menu && (
        <Popover anchor={ciBtn} onClose={() => setMenu(false)} prefer="down" align="right" className="pr-menu" label="CI">
          <button role="menuitemcheckbox" data-mi aria-checked={autoFix} className="cm-it" onClick={() => { void useStore.getState().setSessionMeta(sessionId, { prAutoFix: !autoFix }); }}>
            <span className="cm-ck">{autoFix && <Icon name="check" size={13} />}</span>
            <span className="cm-tx"><span className="cm-l">{tr('自动修 CI')}</span><span className="cm-d">{tr('检查失败时让这个对话看日志、修好、推送（每次推送只问一次）')}</span></span>
          </button>
          <button role="menuitemcheckbox" data-mi aria-checked={pr.autoMerge} className="cm-it" disabled={busy} onClick={() => void setAutoMerge(!pr.autoMerge)}>
            <span className="cm-ck">{pr.autoMerge && <Icon name="check" size={13} />}</span>
            <span className="cm-tx"><span className="cm-l">{tr('就绪后自动合并')}</span><span className="cm-d">{tr('检查都通过后由 GitHub 自动 squash 合并')}</span></span>
          </button>
        </Popover>
      )}
    </div>
  );
}
