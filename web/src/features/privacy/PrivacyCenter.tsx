// 隐私保护 center (spec 2026-10-26 §4): the privacy pipeline's switches, custom words / patterns, allow-list, local skip,
// a preview of what an upstream would receive, and the hit counts since the app started. Self-contained: the gateway
// UI mounts it where it fits (`<PrivacyCenter />`). Settings live in meta.json on the server (privacy.get / privacy.set);
// the preview is computed on the server and nothing of it is stored.
import { useEffect, useRef, useState } from 'react';
import type { PrivacyAction, PrivacyCategory, PrivacyPreview, PrivacySettings, PrivacyStatus } from '@shared';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { tr } from '@/i18n';
import { Select } from '@/ui/Select';

export const CATEGORIES: PrivacyCategory[] = ['api_key', 'private_key', 'jwt', 'password', 'email', 'phone', 'id_card', 'bank_card', 'name', 'address', 'custom'];

export function categoryName(c: PrivacyCategory): string {
  switch (c) {
    case 'api_key': return tr('API Key');
    case 'private_key': return tr('私钥');
    case 'jwt': return 'JWT';
    case 'password': return tr('密码 / Token');
    case 'email': return tr('邮箱');
    case 'phone': return tr('手机号');
    case 'id_card': return tr('身份证号');
    case 'bank_card': return tr('银行卡号');
    case 'name': return tr('人名');
    case 'address': return tr('地址');
    case 'custom': return tr('自定义内容');
  }
}

export const actionName = (a: PrivacyAction) => (a === 'off' ? tr('不检查') : a === 'redact' ? tr('脱敏') : a === 'warn' ? tr('只提醒') : tr('拦截'));
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

function ListBox({ label, hint, value, onSave }: { label: string; hint: string; value: string[]; onSave: (v: string[]) => void }) {
  const [text, setText] = useState(value.join('\n'));
  const synced = useRef(value.join('\n'));
  useEffect(() => { const v = value.join('\n'); if (v !== synced.current) { synced.current = v; setText(v); } }, [value]);
  const dirty = lines(text).join('\n') !== value.join('\n');
  return (
    <div className="privacy-list" data-privacy-list>
      <div className="privacy-label">{label}</div>
      <div className="sub">{hint}</div>
      <textarea rows={3} value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)' }} />
      {dirty && <button className="btn sm" onClick={() => onSave(lines(text))}>{tr('保存')}</button>}
    </div>
  );
}

/** The privacy center. Mount it anywhere; it loads its own state. */
export function PrivacyCenter() {
  const toast = useStore((s) => s.toast);
  const [st, setSt] = useState<PrivacyStatus | null>(null);
  const [sample, setSample] = useState('');
  const [preview, setPreview] = useState<PrivacyPreview | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    try { setSt(await ws.request<PrivacyStatus>({ kind: 'privacy.get' })); setError(''); } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => {
    void load();
    // settings and hit counts are pushed by the server (privacy.changed, at most once a second)
    const off = ws.on((ev) => { if (ev.kind === 'privacy.changed') setSt(ev.status); });
    return () => { off(); };
  }, []);

  const set = async (patch: Partial<Omit<PrivacySettings, 'actions'>> & { actions?: Partial<Record<PrivacyCategory, PrivacyAction>> }) => {
    try { setSt(await ws.request<PrivacyStatus>({ kind: 'privacy.set', patch })); toast(tr('已保存'), true); } catch (e) { toast((e as Error).message); }
  };
  const runPreview = async () => {
    try { setPreview(await ws.request<PrivacyPreview>({ kind: 'privacy.preview', text: sample })); } catch (e) { toast((e as Error).message); }
  };

  if (!st) return <div className="privacy-center sub">{error || tr('加载中…')}</div>;
  const s = st.settings;
  const stats = st.stats;
  return (
    <div className="privacy-center" data-privacy-center>
      <label className="privacy-row" style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
        <input type="checkbox" checked={s.enabled} onChange={(e) => void set({ enabled: e.target.checked })} />
        {tr('发给模型前先脱敏')}
      </label>
      <div className="sub">
        {tr('对话、Agent 和连接测试发给模型的请求：敏感内容换成占位符（如 {example}）再发，回答里的占位符换回原文。原文只留在本机内存里。开着但处理出错时，请求不会发出。', { example: '{{API_KEY_a1b2c3d4}}' })}
      </div>
      <div className="sub">
        {tr('打开以后，已经在跑的对话要重新开始才会经过这里。需要模型看到原文才能做的事（比如用这个 Key 调接口），脱敏后做不了。图片里的文字不处理。')}
      </div>

      <label className="privacy-row" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
        <input type="checkbox" checked={s.skipLocal} onChange={(e) => void set({ skipLocal: e.target.checked })} />
        {tr('本机和局域网上的模型不处理')}
      </label>

      <div className="privacy-cats" style={{ display: 'grid', gridTemplateColumns: 'auto auto auto', gap: '4px 12px', alignItems: 'center', margin: '8px 0' }}>
        {CATEGORIES.map((c) => (
          <div key={c} style={{ display: 'contents' }} data-privacy-cat={c}>
            <span>{categoryName(c)}</span>
            <Select value={s.actions[c]} onValueChange={(v) => void set({ actions: { [c]: String(v) as PrivacyAction } })} aria-label={categoryName(c)} options={(['off', 'redact', 'warn', 'block'] as PrivacyAction[]).map((a) => ({ value: a, label: actionName(a) }))} />
            <span className="sub">{stats.hits[c] ? tr('命中 {n} 次', { n: stats.hits[c] }) : ''}</span>
          </div>
        ))}
      </div>

      <ListBox label={tr('自定义词')} hint={tr('人名、项目代号、主机名……每行一个，不分大小写')} value={s.words} onSave={(words) => void set({ words })} />
      <ListBox label={tr('自定义正则')} hint={tr('每行一个 JavaScript 正则')} value={s.patterns} onSave={(patterns) => void set({ patterns })} />
      {st.badPatterns.length > 0 && <div className="sub" style={{ color: 'var(--danger, #c33)' }}>{tr('这些正则用不了：{list}', { list: st.badPatterns.join('  ') })}</div>}
      <ListBox label={tr('白名单')} hint={tr('这些值总是原样发送，每行一个')} value={s.allow} onSave={(allow) => void set({ allow })} />

      <div className="privacy-preview" style={{ marginTop: 12 }}>
        <div className="privacy-label">{tr('预览')}</div>
        <div className="sub">{tr('贴一段文字，看模型会收到什么。不保存。')}</div>
        <textarea rows={4} value={sample} spellCheck={false} onChange={(e) => setSample(e.target.value)} style={{ width: '100%' }} />
        <button className="btn sm" disabled={!sample.trim()} onClick={() => void runPreview()}>{tr('预览')}</button>
        {preview && (
          <div style={{ marginTop: 6 }}>
            {preview.blocked && <div style={{ color: 'var(--danger, #c33)' }}>{tr('这段内容会被拦截，不会发出')}</div>}
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{preview.text}</pre>
            <div className="sub">
              {preview.hits.length
                ? preview.hits.map((h, i) => <span key={i} style={{ marginRight: 8 }}>{categoryName(h.category)} · {actionName(h.action)}</span>)
                : tr('没有发现敏感内容')}
            </div>
          </div>
        )}
      </div>

      <div className="privacy-stats" style={{ marginTop: 12 }}>
        <div className="privacy-label">{tr('最近')}</div>
        <div className="sub">
          {tr('自 {since} 起：处理 {requests} 个请求，脱敏 {redacted} 个，提醒 {warned} 个，拦截 {blocked} 个', { since: new Date(stats.since).toLocaleString(), requests: stats.requests, redacted: stats.redacted, warned: stats.warned, blocked: stats.blocked })}
        </div>
        {stats.recent.slice(0, 10).map((r, i) => (
          <div key={`${r.ts}-${i}`} className="sub" style={{ display: 'flex', gap: 8 }}>
            <span>{new Date(r.ts).toLocaleTimeString()}</span>
            <span>{r.source}</span>
            <span>{Object.entries(r.categories).map(([c, n]) => `${categoryName(c as PrivacyCategory)} ×${n}`).join('，')}</span>
            {r.blocked && <span style={{ color: 'var(--danger, #c33)' }}>{tr('已拦截')}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
