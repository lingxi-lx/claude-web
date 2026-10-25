// 设置 → PR 与 MR (stage E2): the self-hosted GitLab addresses, and a token per host. Tokens are only ever sent to
// this computer's server (vcs.tokens.set), stored there encrypted, never shown again: the box is never prefilled.
import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/store';
import { ws } from '@/ws/client';
import { tr } from '@/i18n';
import { imeComposing } from '@/ui/ime';

const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/;
/** the server's normalizeHost (vcs/token-store.ts): a bare host, optionally :port, lower case */
export function normalizeHostInput(s: string): string | null {
  const h = s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return HOST.test(h) && /[.:]/.test(h) ? h : null;
}

type HostRow = { host: string; saved: boolean; glab: boolean };

export function GitlabSection({ label }: { label: string }) {
  const v = useStore((s) => s.settings['vcs.gitlabHosts']);
  const set = useStore((s) => s.setSetting);
  const toast = useStore((s) => s.toast);
  const saved = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').join('\n') : '';
  const [text, setText] = useState(saved);
  const [rows, setRows] = useState<HostRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => setText(saved), [saved]);

  const load = useCallback(() => {
    ws.request<{ hosts: HostRow[] }>({ kind: 'vcs.tokens.list' }).then((r) => setRows(r.hosts ?? [])).catch(() => setRows([]));
  }, []);
  useEffect(load, [load, saved]);

  const commit = () => {
    const lines = [...new Set(text.split(/\r?\n/).map(normalizeHostInput).filter((x): x is string => !!x))];
    if (lines.join('\n') !== saved) void set('vcs.gitlabHosts', lines.length ? lines : undefined);
    setText(lines.join('\n'));
  };
  const save = async (host: string, token: string | null) => {
    try {
      await ws.request({ kind: 'vcs.tokens.set', host, token });
      setDrafts((d) => ({ ...d, [host]: '' }));
      toast(token ? tr('已保存 {host} 的令牌', { host }) : tr('已删除 {host} 的令牌', { host }), true);
      load();
    } catch (e: any) { toast(String(e?.message ?? e)); }
  };

  return (
    <div className="gl-sec">
      <textarea className="field mono" rows={3} aria-label={label} placeholder="git.example.com" spellCheck={false} value={text}
        onChange={(e) => setText(e.target.value)} onBlur={commit} />
      {rows.length > 0 && (
        <div className="gl-hosts">
          {rows.map((r) => (
            <div key={r.host} className="gl-host" data-host={r.host}>
              <span className="gl-h mono">{r.host}</span>
              <span className="gl-st">{r.glab ? tr('glab 已登录') : r.saved ? tr('已保存令牌') : tr('没有令牌')}</span>
              <input className="field" type="password" autoComplete="off" aria-label={tr('{host} 的访问令牌', { host: r.host })} placeholder={tr('访问令牌')}
                value={drafts[r.host] ?? ''} onChange={(e) => setDrafts((d) => ({ ...d, [r.host]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter' && !imeComposing(e.nativeEvent) && (drafts[r.host] ?? '').trim()) { e.preventDefault(); void save(r.host, drafts[r.host]!.trim()); } }} />
              <button className="btn" disabled={!(drafts[r.host] ?? '').trim()} onClick={() => void save(r.host, drafts[r.host]!.trim())}>{tr('保存')}</button>
              {r.saved && <button className="btn" onClick={() => void save(r.host, null)}>{tr('删除')}</button>}
            </div>
          ))}
          <div className="sub">{tr('只存在这台电脑上，不会发给手机或其它电脑')}</div>
        </div>
      )}
    </div>
  );
}
