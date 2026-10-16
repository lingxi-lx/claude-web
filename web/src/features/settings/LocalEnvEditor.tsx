// 本机环境变量 (spec 2026-10-16 sessions-env §6): variables every conversation and terminal started by this app gets,
// stored encrypted on this computer (server/src/runtime/local-env.ts). Values never come down with the list: 👁 asks for
// one. Names that choose the model / account belong to 供应商 and are refused by the server.
import { useEffect, useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { Icon } from '@/ui/icons';
import { tr } from '@/i18n';

export function LocalEnvEditor() {
  const [names, setNames] = useState<string[] | null>(null);
  const [shown, setShown] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = (m: string) => useStore.getState().toast(m);

  useEffect(() => {
    ws.request({ kind: 'env.list' }).then((r: any) => setNames(r.names ?? [])).catch((e) => { setNames([]); toast(String(e?.message ?? e)); });
  }, []);

  const save = async (n: string, v: string | null) => {
    setBusy(true);
    try {
      const r = (await ws.request({ kind: 'env.set', name: n, value: v })) as { names: string[] };
      setNames(r.names);
      setShown(({ [n]: _, ...rest }) => rest);
      return true;
    } catch (e: any) {
      toast(String(e?.message ?? e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const reveal = async (n: string) => {
    if (n in shown) { setShown(({ [n]: _, ...rest }) => rest); return; }
    const r = (await ws.request({ kind: 'env.reveal', name: n }).catch(() => null)) as { value?: string } | null;
    if (r) setShown((s) => ({ ...s, [n]: r.value ?? '' }));
  };

  return (
    <div className="section env-editor local-env">
      <div className="sub" style={{ marginBottom: 8 }}>
        {tr('这台电脑上由这个应用开的每个对话和终端都会带上，加密保存在本机。改了之后新开的对话和终端生效。选模型 / 账号的变量（ANTHROPIC_… 等）由供应商决定，这里不收。')}
      </div>
      {names?.map((n) => (
        <div key={n} className="env-row">
          <code>{n}</code>
          <input className="field" readOnly type={n in shown ? 'text' : 'password'} value={n in shown ? shown[n] : '••••••••'} aria-label={n} />
          <button className="icon-btn" onClick={() => void reveal(n)} aria-label={n in shown ? tr('隐藏') : tr('显示密钥')}><Icon name="eye" size={14} /></button>
          <button className="icon-btn" disabled={busy} onClick={() => void save(n, null)} aria-label={tr('删除 {name}', { name: n })}><Icon name="trash" size={14} /></button>
        </div>
      ))}
      {names && !names.length && <div className="sub" style={{ marginBottom: 6 }}>{tr('还没有。')}</div>}
      <form
        className="env-row"
        onSubmit={async (e) => {
          e.preventDefault();
          const n = name.trim();
          if (!n || busy) return;
          if (await save(n, value)) { setName(''); setValue(''); }
        }}
      >
        <input className="field mono" style={{ flex: 'none', width: 200 }} placeholder={tr('名字，例如 DATABASE_URL')} value={name} onChange={(e) => setName(e.target.value)} aria-label={tr('变量名')} spellCheck={false} />
        <input className="field" type="password" placeholder={tr('值')} value={value} onChange={(e) => setValue(e.target.value)} aria-label={tr('变量值')} autoComplete="off" />
        <button className="btn sm primary" type="submit" disabled={busy || !name.trim()}>{tr('添加')}</button>
      </form>
    </div>
  );
}
