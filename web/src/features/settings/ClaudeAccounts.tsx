import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import type { Provider } from '@shared';
import { useStore } from '@/store';
import { ws } from '@/ws/client';
import { clsx } from '@/util';
import { dlg } from '@/ui/dialog';
import { imeComposing } from '@/ui/ime';
import { Row } from './controls';
import { tr } from '@/i18n';
import { tokenIn } from './account-token';

const isAccount = (p: Provider) => p.type === 'claude-account';

/**
 * The add dialog lives outside the settings page (App renders AddAccountHost): running `claude setup-token` opens a
 * terminal tab, which closes settings — the dialog inside it went with it, and the token never arrived.
 */
export const useAddAccount = create<{ open: boolean }>(() => ({ open: false }));

/**
 * 账号与登录 → 其它 Claude 账号 (user request 2026-10-15: several Claude accounts side by side, switch any time): each is
 * a profile of its own (`claude-account`: the token `claude setup-token` prints), so every conversation picks its
 * account in the model menu like a provider — the quota of one runs out, the next turn goes on with another.
 */
export function ClaudeAccounts() {
  const providers = useStore((s) => s.providers);
  const def = useStore((s) => s.settings.defaultProviderId as string | undefined);
  const setSetting = useStore((s) => s.setSetting);
  const accounts = providers.filter(isAccount);
  const [checking, setChecking] = useState<string | null>(null);
  const st = useStore.getState;
  const check = async (p: Provider) => {
    setChecking(p.id);
    try {
      const r = await ws.request<{ ok: boolean; error?: string; ms: number }>({ kind: 'providers.probe', id: p.id });
      st().toast(r.ok ? tr('「{name}」可以用（{secs} 秒）', { name: p.name, secs: Math.round(r.ms / 100) / 10 }) : tr('「{name}」测试失败：{error}', { name: p.name, error: r.error ?? '' }), r.ok);
    } catch (e) {
      st().toast(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(null);
    }
  };
  const rename = async (p: Provider) => {
    const name = (await dlg.prompt(tr('账号的名字'), p.name))?.trim();
    if (!name || name === p.name) return;
    await ws.request({ kind: 'providers.upsert', provider: { id: p.id, name } }).catch((e) => st().toast(e.message));
    await st().loadProviders();
  };
  const remove = async (p: Provider) => {
    if (!(await dlg.confirm(tr('移除「{name}」？用它的对话下次发送时改用新对话的默认（另一个账号或供应商）。令牌本身要到 claude.ai 的设置里吊销。', { name: p.name }), { danger: true, okLabel: tr('移除') }))) return;
    if (def === p.id) await setSetting('defaultProviderId', undefined);
    await ws.request({ kind: 'providers.remove', id: p.id }).catch((e) => st().toast(e.message));
    await st().loadProviders();
  };
  return (
    <>
      <div className="sp-blk-h">{tr('其它 Claude 账号')}</div>
      <div className="sp-card claude-accounts">
        {accounts.map((p) => (
          <Row key={p.id} label={p.name} hint={def === p.id ? tr('新对话默认用这个账号 · 在模型菜单里选「{name} / …」换用', { name: p.name }) : tr('在模型菜单里选「{name} / …」的模型，这个对话就用这个账号', { name: p.name })}>
            <button className={clsx('btn sm', def === p.id && 'primary')} disabled={def === p.id} onClick={() => void setSetting('defaultProviderId', p.id)}>{def === p.id ? tr('默认') : tr('设为默认')}</button>
            <button className="btn sm ghost" disabled={checking === p.id} onClick={() => void check(p)}>{checking === p.id ? tr('测试中…') : tr('测试')}</button>
            <button className="btn sm ghost" onClick={() => void rename(p)}>{tr('改名')}</button>
            <button className="btn sm ghost danger" onClick={() => void remove(p)}>{tr('移除')}</button>
          </Row>
        ))}
        <Row label={accounts.length ? tr('再加一个账号') : tr('添加一个 Claude 账号')} hint={tr('同时用几个 Claude（Pro / Max）账号：每个对话在模型菜单里选用哪个，一个额度用完了换另一个接着聊。')}>
          <button className="btn sm" data-act="account-add" onClick={() => useAddAccount.setState({ open: true })}>{tr('添加账号')}</button>
        </Row>
      </div>
    </>
  );
}

/** Where the add dialog is drawn (App): over everything, or — while the terminal runs — a small card out of its way. */
export function AddAccountHost() {
  const open = useAddAccount((s) => s.open);
  const count = useStore((s) => s.providers.filter(isAccount).length);
  if (!open) return null;
  return <AddAccount count={count} onClose={() => useAddAccount.setState({ open: false })} />;
}

/**
 * The add dialog: a terminal runs `claude setup-token` (the dialog steps aside into a card so the terminal can be used:
 * the sign-in may ask for a key press or a pasted code), the token it prints fills in by itself (or is pasted).
 */
function AddAccount({ count, onClose }: { count: number; onClose: () => void }) {
  const [name, setName] = useState(tr('Claude 账号 {n}', { n: count + 2 }));
  const [waiting, setWaiting] = useState(false);
  const [token, setToken] = useState('');
  const [seen, setSeen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const out = useRef(new Map<string, string>());
  const typed = useRef(false);
  const st = useStore.getState;
  // what the terminals print while this is open: the token `claude setup-token` ends with
  useEffect(() => { const off = ws.on((e) => {
    if (e.kind !== 'terminal.data') return;
    const all = ((out.current.get(e.termId) ?? '') + e.data).slice(-20_000);
    out.current.set(e.termId, all);
    const t = tokenIn(all);
    // the newest one the terminal printed, unless the user typed in the box meanwhile
    if (t && !typed.current) { setToken(t); setSeen(true); setWaiting(false); }
  }); return () => { off(); }; }, []);
  const runSetup = () => {
    setWaiting(true);
    useStore.setState({ settingsOpen: null });
    st().openTile({ id: `t${Date.now()}`, kind: 'term', cwd: '', cmd: 'claude setup-token', title: tr('添加 Claude 账号') }, 'tab');
  };
  const save = async () => {
    setErr('');
    const t = token.trim();
    if (!/^sk-ant-oat\d{2}-[A-Za-z0-9_-]{40,}$/.test(t)) { setErr(tr('这不像 claude setup-token 打出来的令牌（应该以 sk-ant-oat 开头）')); return; }
    setBusy(true);
    try {
      const p = await ws.request<Provider>({ kind: 'providers.upsert', provider: { name: name.trim() || tr('Claude 账号'), type: 'claude-account', apiKey: t, baseUrl: '' } });
      await st().loadProviders();
      const r = await ws.request<{ ok: boolean; error?: string }>({ kind: 'providers.probe', id: p.id });
      if (!r.ok) { setErr(tr('已保存，但测试没通过：{error}', { error: r.error ?? '' })); return; }
      st().toast(tr('已添加「{name}」：在模型菜单里选它的模型就用这个账号', { name: p.name }), true);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (waiting) {
    return (
      <div className="add-account-wait" role="status" data-phase="waiting">
        <div className="t"><span className="spinner" /> {tr('等终端里的令牌…')}</div>
        <div className="sub">{tr('在终端里跟着 claude setup-token 走：浏览器登录要添加的账号并授权。令牌打出来后会自动回到这里。')}</div>
        <div className="row-btns">
          <button type="button" className="btn sm ghost" onClick={() => setWaiting(false)}>{tr('手动粘贴令牌')}</button>
          <button type="button" className="btn sm ghost" onClick={onClose}>{tr('取消')}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="modal-bg dialog-bg" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()} onKeyDown={(e) => { if (e.key === 'Escape' && !imeComposing(e.nativeEvent) && !busy) { e.stopPropagation(); onClose(); } }}>
      <div className="modal add-account" role="dialog" aria-modal="true" aria-label={tr('添加 Claude 账号')}>
        <h3>{tr('添加 Claude 账号')}</h3>
        <ol className="sub add-account-steps">
          <li>{tr('点下面的按钮：会开一个终端运行 claude setup-token。浏览器里登录要添加的那个账号（当前浏览器登着别的账号的话，先退出或用无痕窗口），然后授权。')}</li>
          <li>{tr('终端最后会打出一串 sk-ant-oat 开头的令牌（一年有效），这里会自动填上；没填上就复制过来。')}</li>
          <li>{tr('起个名字，保存。保存时会用它发一条很短的消息测试。')}</li>
        </ol>
        <button type="button" className="btn sm" data-act="account-setup-token" onClick={runSetup}>{tr('在终端里运行 claude setup-token')}</button>
        <label className="field-row"><span>{tr('名字')}</span><input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('比如：工作号')} /></label>
        <label className="field-row"><span>{tr('令牌')}</span><input className="field mono" type="password" autoComplete="off" value={token} onChange={(e) => { typed.current = true; setToken(e.target.value); }} placeholder="sk-ant-oat01-…" /></label>
        {seen && <div className="sub ok">{tr('已从终端读到令牌')}</div>}
        {err && <div className="sub err" role="alert">{err}</div>}
        <div className="row-btns">
          <span className="grow" />
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>{tr('取消')}</button>
          <button type="button" className="btn primary" disabled={busy || !token.trim()} onClick={() => void save()}>{busy ? tr('保存并测试中…') : tr('保存并测试')}</button>
        </div>
      </div>
    </div>
  );
}
