import { useRef, useState } from 'react';
import { Icon } from '@/ui/icons';
import { Popover } from '@/features/composer/Popover';
import { ago } from '@/util';
import type { UpstreamAccountView } from '@shared';
import { QuotaBar } from './QuotaBar';
import { FAMILY_LABEL } from './tasks-model';
import { tr } from '@/i18n';

const HEALTH: Record<UpstreamAccountView['health'], { l: string; c: string }> = {
  unknown: { l: tr('未检查'), c: '' },
  ok: { l: tr('正常'), c: 'ok' },
  cooling: { l: tr('冷却中'), c: 'warn' },
  expired: { l: tr('已过期'), c: 'bad' },
  disabled: { l: tr('已停用'), c: '' },
  error: { l: tr('出错'), c: 'bad' },
};

/** One account in the list: identity, health, whether a route uses it, and the actions that keep it useful. */
export function AccountRow(p: {
  a: UpstreamAccountView;
  busy: boolean;
  /** a gateway group / pool already uses this account */
  routed: boolean;
  onProbe(): void;
  onToggle(): void;
  onEdit(): void;
  onRemove(): void;
  onAttach(): void;
  /** Gemini on the desktop: sign in to Google again (the same login window as when it was added) */
  onSignIn?(): void;
}) {
  const h = HEALTH[p.a.health] ?? HEALTH.unknown;
  // a component-stopped account is `disabled` too, but its login is what died: offer the sign-in again
  const relogin = p.onSignIn && (p.a.health !== 'ok' || !!p.a.autoDisabledAt);
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const run = (fn: () => void) => () => { setMenu(false); fn(); };
  return (
    <div className="gateway-row" data-id={p.a.id}>
      <Icon name="agent" size={16} />
      <span className="gw-who">
        <span className="l">{p.a.name}</span>
        <span className="sub">{p.a.identity?.email ?? FAMILY_LABEL[p.a.kind]} · {p.a.credentialMasked}</span>
        {(p.a.sidecarProxy || p.a.autoDisabledAt) && (
          <span className="sub">
            {p.a.sidecarProxy ? tr('出口：{name}', { name: p.a.sidecarProxy.name ?? `#${p.a.sidecarProxy.id}` }) : ''}
            {p.a.sidecarProxy?.failCount ? ` · ${tr('失败 {n} 次', { n: p.a.sidecarProxy.failCount })}` : ''}
            {p.a.autoDisabledAt ? ` · ${tr('组件自动停用，检查通过后会自动启用')}` : ''}
          </span>
        )}
        {p.a.lastError && <span className="sub" title={p.a.lastError}>{p.a.lastError.slice(0, 80)}</span>}
      </span>
      <span className="grow" />
      {p.a.quota?.windows.slice(0, 2).map((w) => <QuotaBar key={w.id} w={w} />)}
      <span className={`gateway-badge ${h.c}`}>{h.l}</span>
      {!p.routed && <button className="btn sm" disabled={p.busy} onClick={p.onAttach}>{tr('加入默认入口')}</button>}
      {relogin && <button className="btn sm" disabled={p.busy} onClick={p.onSignIn}>{tr('重新登录')}</button>}
      <button className="btn sm ghost" disabled={p.busy} onClick={p.onProbe}>{tr('检查')}</button>
      <button className="btn sm ghost" disabled={p.busy} onClick={p.onEdit}>{tr('编辑')}</button>
      <button ref={more} className="icon-btn xs" aria-haspopup="menu" aria-expanded={menu} aria-label={tr('更多账号操作')} title={tr('更多')} onClick={() => setMenu((v) => !v)}>
        <Icon name="more" size={14} />
      </button>
      {menu && (
        <Popover anchor={more} onClose={() => setMenu(false)} align="right" label={tr('账号操作')}>
          <div className="menu-label">{p.a.lastUsedAt ? tr('{a}前用过', { a: ago(p.a.lastUsedAt) }) : tr('没用过')}</div>
          <button data-mi="" role="menuitem" onClick={run(p.onToggle)}><Icon name={p.a.enabled ? 'stop' : 'play'} size={13} /> {p.a.enabled ? tr('停用') : tr('启用')}</button>
          <button data-mi="" role="menuitem" className="danger" onClick={run(p.onRemove)}><Icon name="trash" size={13} /> {tr('删除')}</button>
        </Popover>
      )}
    </div>
  );
}
