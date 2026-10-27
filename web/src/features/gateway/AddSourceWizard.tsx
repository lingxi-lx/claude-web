import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from '@/util';
import { Icon, type IconName } from '@/ui/icons';
import { imeComposing } from '@/ui/ime';
import type { UpstreamKind } from '@shared';
import { QuickConnect } from '@/features/providers/QuickConnect';
import { PRESETS } from '@/features/providers/quick';
import { useStore } from '@/store';
import { AddAccountWizard } from './AddAccountWizard';
import { useAddSource, closeAddSource, type AddStart } from './add-source';
import type { Provider } from '@shared';
import { useGateway } from './state';
import { tr } from '@/i18n';

type How = { type: 'account'; kind: UpstreamKind } | { type: 'api'; preset: string };
interface Entry { id: string; name: string; groups: AddStart[]; icon?: IconName; note: string; how: How }

const presetName = (id: string) => PRESETS.find((p) => p.id === id)?.name ?? id;

/** The full list. Only what can really be added today — nothing that would end in 「暂不支持」. */
export const CATALOG: Entry[] = [
  { id: 'openrouter-free', name: tr('OpenRouter 免费模型'), groups: ['free'], note: tr('注册拿一个 Key，名字带 :free 的模型不花钱'), how: { type: 'api', preset: 'openrouter' } },
  { id: 'gemini-key', name: tr('Gemini 官方免费 Key'), groups: ['free'], icon: 'gemini', note: tr('Google AI Studio 的 Key 自带免费额度'), how: { type: 'api', preset: 'gemini' } },
  { id: 'siliconflow-free', name: tr('硅基流动免费模型'), groups: ['free'], note: tr('部分模型免费，用自己的 Key'), how: { type: 'api', preset: 'siliconflow' } },
  { id: 'claude', name: tr('Claude 订阅账号'), groups: ['login'], icon: 'claude', note: tr('粘贴 Claude 的登录令牌或凭据文件'), how: { type: 'account', kind: 'claude' } },
  { id: 'gemini-web', name: tr('Gemini 网页'), groups: ['login', 'free'], icon: 'gemini', note: tr('用 Google 账号登录，按网页版的额度用'), how: { type: 'account', kind: 'gemini' } },
  { id: 'workbuddy', name: 'WorkBuddy', groups: ['login', 'free'], icon: 'agent', note: tr('扫码登录，每天签到领额度'), how: { type: 'account', kind: 'workbuddy' } },
  ...PRESETS.map((p): Entry => ({
    id: `api-${p.id}`,
    name: p.id === 'relay' ? tr('中转站 / 其它兼容地址') : p.name,
    groups: ['api'],
    icon: p.id === 'gemini' ? 'gemini' : p.id === 'kimi' ? 'kimi' : p.id === 'qwen' ? 'qwen' : undefined,
    note: p.id === 'relay' ? tr('填地址和 Key，Claude、OpenAI、Gemini 格式都行') : tr('填 {name} 的 Key', { name: presetName(p.id) }),
    how: { type: 'api', preset: p.id },
  })),
];

const CHOICES: { id: AddStart; title: string; note: string; icon: IconName }[] = [
  { id: 'free', title: tr('免费使用'), note: tr('不花钱的模型和免费额度'), icon: 'sparkle' },
  { id: 'login', title: tr('登录账号'), note: tr('Claude、Gemini 网页、WorkBuddy'), icon: 'user' },
  { id: 'api', title: tr('填写 API 地址'), note: tr('官方或中转的地址和 Key'), icon: 'cloud' },
];

/** 添加来源: three big choices, a search over the full list, then only the steps the picked source needs. */
function AddSourceWizard() {
  const start = useAddSource((s) => s.start);
  const [group, setGroup] = useState<AddStart | null>(start);
  const [query, setQuery] = useState('');
  const [entry, setEntry] = useState<Entry | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => search.current?.focus({ preventScroll: true }), 0); }, []);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CATALOG.filter((e) => (!group || e.groups.includes(group)) && (!q || e.name.toLowerCase().includes(q) || e.note.toLowerCase().includes(q)));
  }, [group, query]);

  const finished = (name: string, p: Provider | null = null) => {
    setDone(name);
    // opened from a conversation: it switches to what was just added (its draft stays where it is)
    try { useAddSource.getState().onAdded?.(p); } catch { /* the caller's problem, not the wizard's */ }
    void useStore.getState().loadProviders().catch(() => {});
    if (useGateway.getState().open) void useGateway.getState().load().catch(() => {});
  };
  const back = () => { if (done) { setDone(null); setEntry(null); } else if (entry) setEntry(null); else if (group) setGroup(null); else closeAddSource(); };

  return (
    <div
      className="modal-bg dialog-bg gw-add-bg"
      onMouseDown={(e) => e.target === e.currentTarget && closeAddSource()}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || imeComposing(e.nativeEvent) || e.defaultPrevented) return;
        if ((e.target as HTMLElement).closest('.menu')) return;
        e.preventDefault();
        e.stopPropagation();
        // the innermost step first: the form → the list → the three choices → closed
        back();
      }}
    >
      <div className="modal gw-add" role="dialog" aria-label={tr('添加来源')} data-step={done ? 'done' : entry ? 'form' : 'pick'}>
        <div className="gw-add-head">
          {(entry || group || done) && <button className="icon-btn" aria-label={tr('返回')} onClick={back}><Icon name="arrowLeft" size={15} /></button>}
          <h3>{done ? tr('已可用') : entry ? entry.name : tr('添加来源')}</h3>
          <span className="grow" />
          <button className="icon-btn" aria-label={tr('关闭')} onClick={closeAddSource}><Icon name="close" size={15} /></button>
        </div>

        {done && (
          <div className="gw-add-done">
            <Icon name="checkCircle" size={28} />
            <div className="l">{tr('「{name}」已可用', { name: done })}</div>
            <div className="sub">{tr('它的模型已经在对话的模型菜单里。')}</div>
            <div className="actions">
              <button className="btn ghost" onClick={() => { setDone(null); setEntry(null); }}>{tr('再添加一个')}</button>
              <button className="btn" onClick={closeAddSource}>{tr('完成')}</button>
            </div>
          </div>
        )}

        {!done && entry?.how.type === 'account' && (
          <AddAccountWizard embedded kind={entry.how.kind} onClose={() => setEntry(null)} onAdded={() => finished(entry.name)} />
        )}
        {!done && entry?.how.type === 'api' && (
          <QuickConnect key={entry.id} preset={entry.how.preset} makeDefault={false} onDone={(p) => finished(p.name, p)} />
        )}

        {!done && !entry && (
          <>
            <div className="gw-choices">
              {CHOICES.map((c) => (
                <button key={c.id} className={clsx('gw-choice', group === c.id && 'on')} data-id={c.id} aria-pressed={group === c.id} onClick={() => setGroup(group === c.id ? null : c.id)}>
                  <Icon name={c.icon} size={18} />
                  <b>{c.title}</b>
                  <span className="sub">{c.note}</span>
                </button>
              ))}
            </div>
            <div className="gw-add-search">
              <Icon name="search" size={13} />
              <input
                ref={search}
                value={query}
                placeholder={tr('搜索来源')}
                aria-label={tr('搜索来源')}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && query && !imeComposing(e.nativeEvent)) { e.preventDefault(); e.stopPropagation(); setQuery(''); }
                  if (e.key === 'Enter' && !imeComposing(e.nativeEvent) && list.length === 1) setEntry(list[0]);
                }}
              />
            </div>
            <div className="gw-catalog">
              {list.map((e) => (
                <button key={e.id} className="gw-catalog-row" data-id={e.id} onClick={() => setEntry(e)}>
                  <span className="gw-logo sm">{e.icon ? <Icon name={e.icon} size={14} /> : e.name.slice(0, 1).toUpperCase()}</span>
                  <span className="gw-source-who"><b>{e.name}</b><span className="sub">{e.note}</span></span>
                  {e.groups.includes('free') && <span className="gw-tag">{tr('免费')}</span>}
                  <Icon name="chevronRight" size={13} />
                </button>
              ))}
              {!list.length && <div className="empty">{tr('没找到。试试「填写 API 地址」→ 中转站，任何兼容地址都能接。')}</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Mounted once in App.tsx; the wizard itself is drawn only while open (and fresh each time it opens). */
export function AddSourceHost() {
  const open = useAddSource((s) => s.open);
  const seq = useAddSource((s) => s.seq);
  return open ? <AddSourceWizard key={seq} /> : null;
}
