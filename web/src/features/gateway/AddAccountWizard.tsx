import { useEffect, useRef, useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { pairQr } from '@/features/settings/pair-qr';
import { FAMILY_LABEL } from './tasks-model';
import type { SidecarProxy, UpstreamAccountView, UpstreamKind } from '@shared';
import { tr } from '@/i18n';
import { Icon } from '@/ui/icons';
import { checkGeminiCookie, parseGeminiInput, SESSION_COOKIE } from './gemini-cookie';
import { canSignIn, signInGemini } from './gemini-login';
import { Select } from '@/ui/Select';
import { Segmented } from '@/ui/Segmented';
import { useEscClose } from './use-esc-close';

interface Login { url: string; state: string }

/** What is wrong with each pasted Gemini cookie, in words; empty when every one is complete. */
function geminiProblems(list: string[]): { block: string[]; warn: string[] } {
  const block: string[] = [];
  const warn: string[] = [];
  list.forEach((c, i) => {
    const r = checkGeminiCookie(c);
    const who = list.length > 1 ? tr('第 {n} 个：', { n: i + 1 }) : '';
    if (r.missing.length) {
      block.push(who + tr('缺 {names}', { names: r.missing.join('、') }));
      if (r.onlyGeminiRow) block.push(tr('看起来只复制了 gemini.google.com 那一栏——SID、SAPISID 这些挂在 .google.com 上。按上面的步骤从「网络」里复制 cookie 整行就齐了。'));
    } else if (r.noSession) {
      warn.push(who + tr('没有 {name}，登录可能很快失效', { name: SESSION_COOKIE }));
    }
  });
  return { block: [...new Set(block)], warn };
}

/**
 * 添加账号: pick one of three kinds, paste the one thing that kind needs (Claude token / JSON, Gemini cookies,
 * WorkBuddy cockpit JSON) or scan WorkBuddy's QR; on the desktop a Gemini account is a Google sign-in in a window of
 * its own instead. One risk checkbox, one button.
 */
export function AddAccountWizard({ onClose, kind: fixed, embedded, onAdded }: {
  onClose(): void;
  /** only this kind (a source's detail, the 添加来源 wizard): no kind chips */
  kind?: UpstreamKind;
  /** drawn inside another dialog (添加来源): no backdrop of its own */
  embedded?: boolean;
  /** after a successful add (default: onClose) */
  onAdded?(): void;
}) {
  const toast = useStore((s) => s.toast);
  const [kind, setKind] = useState<UpstreamKind>(fixed ?? 'claude');
  const done = () => (onAdded ?? onClose)();
  const escRef = useEscClose<HTMLDivElement>(() => { if (!busy) onClose(); }, !!embedded);
  const [wbMode, setWbMode] = useState<'qr' | 'json'>('qr');
  const [gMode, setGMode] = useState<'login' | 'paste'>(canSignIn() ? 'login' : 'paste');
  const [gNote, setGNote] = useState('');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [logining, setLogining] = useState(false);
  const [realm, setRealm] = useState<'cn' | 'global'>('cn');
  const [login, setLogin] = useState<Login | null>(null);
  const [qr, setQr] = useState<{ src: string; size: number } | null>(null);
  const [exits, setExits] = useState<SidecarProxy[]>([]);
  const [exitId, setExitId] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);

  // the sign-in should leave from the same exit the requests will use (0 = direct)
  useEffect(() => {
    if (kind !== 'gemini' || gMode !== 'login') return;
    ws.request<SidecarProxy[]>({ kind: 'upstreams.proxies', id: 'gemini' }).then(setExits).catch(() => setExits([]));
  }, [kind, gMode]);

  const stopPolling = () => {
    if (timer.current !== null) { window.clearInterval(timer.current); timer.current = null; }
  };
  useEffect(() => stopPolling, []);

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    setText(await f.text());
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
  };

  const credentials = (): unknown[] => {
    const raw = text.trim();
    if (!raw) return [];
    if (kind === 'gemini') return parseGeminiInput(raw);
    return [raw];
  };
  const save = async () => {
    if (!text.trim()) { toast(kind === 'gemini' ? tr('先粘贴 cookie') : tr('先粘贴凭据')); return; }
    const list = credentials();
    setBusy(true);
    try {
      let added = 0;
      let dup = 0;
      const failed: string[] = [];
      for (let i = 0; i < list.length; i++) {
        const r = await ws.request<{ duplicate: boolean; id: string }>({
          kind: 'upstreams.add',
          input: {
            kind,
            name: list.length > 1 && name.trim() ? `${name.trim()} ${i + 1}` : name,
            credential: list[i],
            source: text.trim().startsWith('{') || text.trim().startsWith('[') ? 'file' : 'paste',
          },
        });
        if (r.duplicate) dup++; else added++;
        // a Gemini cookie is taken without asking Google: ask now, so a dead one is said here and not on first use
        if (kind === 'gemini' && !r.duplicate) {
          const v = await ws.request<UpstreamAccountView>({ kind: 'upstreams.probe', id: r.id }).catch(() => null);
          if (v && v.health !== 'ok') failed.push(v.lastError ?? tr('没有登录态'));
        }
      }
      if (failed.length) toast(tr('已添加，但检查没通过：{e}', { e: failed[0] }));
      else toast(dup ? tr('已添加 {n} 个，{d} 个已经在里面了', { n: added, d: dup }) : tr('已添加 {n} 个账号', { n: added }), true);
      done();
    } catch (e: any) { toast(e.message); } finally { setBusy(false); }
  };

  const startLogin = async () => {
    setLogining(true);
    try {
      const r = await ws.request<Login>({ kind: 'upstreams.oauth.start', id: 'workbuddy', realm });
      setLogin(r);
      setQr(await pairQr(r.url).catch(() => null));
      stopPolling();
      timer.current = window.setInterval(async () => {
        try {
          const p = await ws.request<{ done: boolean }>({ kind: 'upstreams.oauth.poll', state: r.state });
          if (!p.done) return;
          stopPolling();
          await ws.request({ kind: 'upstreams.sync', id: 'workbuddy' });
          toast(tr('登录成功，账号已添加'), true);
          setLogining(false);
          done();
        } catch (e: any) {
          stopPolling();
          setLogining(false);
          toast(e.message);
        }
      }, 2000);
    } catch (e: any) { toast(e.message); setLogining(false); }
  };

  const googleSignIn = async () => {
    setBusy(true);
    setGNote('');
    try {
      const r = await signInGemini({ name: name.trim() || undefined, proxyId: exitId || undefined });
      if (!r) {
        setGNote(tr('没完成登录。可以再试一次，或者改用粘贴 cookie。'));
        return;
      }
      if (r.account.health === 'ok') toast(r.duplicate ? tr('这个账号已经在里面了，登录已更新') : tr('已添加，登录有效'), true);
      else toast(tr('已添加，但检查没通过：{e}', { e: r.account.lastError ?? tr('没有登录态') }));
      done();
    } catch (e: any) { setGNote(e.message); } finally { setBusy(false); }
  };

  const geminiList = kind === 'gemini' && gMode === 'paste' ? parseGeminiInput(text) : [];
  const gProblems = geminiProblems(geminiList);
  const geminiBlocked = kind === 'gemini' && gMode === 'paste' && (!!gProblems.block.length || (!!text.trim() && !geminiList.length));

  const hint = kind === 'claude'
    ? tr('sk-ant-oat… 令牌，或 Claude Code 的 .credentials.json')
    : tr('cockpit 导出（含 uid / accessToken / refreshToken 的 JSON）');
  const placeholder = kind === 'claude' ? tr('粘贴令牌或 JSON') : kind === 'gemini' ? '__Secure-1PSID=…; __Secure-1PSIDTS=…' : '[{"uid":"…","accessToken":"…","refreshToken":"…"}]';
  const body = (
    <>
        {!embedded && <h3>{fixed ? tr('添加 {name} 账号', { name: FAMILY_LABEL[fixed] }) : tr('添加账号')}</h3>}
        {!fixed && <div className="row gw-kind-row" style={{ gap: 6, marginBottom: 8 }}>
          {(['claude', 'gemini', 'workbuddy'] as const).map((k) => (
            <button key={k} className={kind === k ? 'chip gateway-kind on' : 'chip gateway-kind'} aria-pressed={kind === k} onClick={() => { setKind(k); setText(''); }}>
              <Icon name={k === 'workbuddy' ? 'agent' : k} size={13} /> {FAMILY_LABEL[k]}
            </button>
          ))}
        </div>}
        {kind === 'workbuddy' && (
          <Segmented
            className="gw-mode"
            label={tr('登录方式')}
            value={wbMode}
            onChange={setWbMode}
            arrows
            options={[{ value: 'qr', label: tr('扫码登录') }, { value: 'json', label: tr('粘贴 JSON') }]}
          />
        )}
        {kind === 'gemini' && gMode === 'login' && (
          <div className="gateway-card gemini-login">
            <div className="sub">{tr('会打开你电脑上的 Chrome（没有 Chrome 就用 Edge）到 Google 登录页。登录进 Gemini 后，关掉那个 Chrome 窗口，账号会自动加进来。它用的是单独的登录状态，不影响你平时用的 Chrome。')}</div>
            <label className="field"><span>{tr('名称')}</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('可留空')} /></label>
            {exits.some((x) => x.enabled) && (
              <label className="field">
                <span>{tr('登录出口')}</span>
                <Select value={String(exitId)} onValueChange={(value) => setExitId(Number(value))} aria-label={tr('登录出口')} options={[{ value: '0', label: tr('不用代理（本机直连）') }, ...exits.filter((x) => x.enabled).map((x) => ({ value: String(x.id), label: x.name, description: x.url }))]} />
              </label>
            )}
            <button className="btn" onClick={() => void googleSignIn()} disabled={busy}>
              {busy ? tr('等你在 Chrome 里登录，登录完关掉窗口…') : tr('登录 Google 账号')}
            </button>
            {gNote && <div className="sub warn" role="status">{gNote}</div>}
            <button className="link" onClick={() => { setGMode('paste'); setGNote(''); }} disabled={busy}>{tr('改用粘贴 cookie')}</button>
          </div>
        )}
        {kind === 'gemini' && gMode === 'paste' && (
          <ol className="sub gemini-steps">
            <li>{tr('在浏览器里打开 gemini.google.com 并登录（最好用无痕窗口），按 F12。')}</li>
            <li>{tr('切到「网络」（Network），刷新页面，点列表里的第一个请求。')}</li>
            <li>{tr('在「请求标头」（Request Headers）里找到 cookie 那一行，复制整行粘贴到下面。')}</li>
            <li>{tr('复制完直接关掉那个窗口，别点退出登录，也别接着在里面用——不然登录会被换掉，这里的就失效了。')}</li>
          </ol>
        )}
        {!(kind === 'workbuddy' && wbMode === 'qr') && !(kind === 'gemini' && gMode === 'login') && (
          <>
            {kind !== 'gemini' && <div className="sub">{hint}</div>}
            <label className="field"><span>{tr('名称')}</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('可留空')} /></label>
            <label className="field">
              <span>{kind === 'gemini' ? tr('Cookie（每行一个）') : kind === 'workbuddy' ? tr('cockpit JSON') : tr('凭据')}</span>
              <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} />
            </label>
            <input ref={file} type="file" accept=".json,.txt" hidden onChange={(e) => void readFile(e.target.files?.[0])} />
            {kind === 'gemini' && text.trim() && (
              <div className="sub" role="status">
                {!geminiList.length && <div className="warn">{tr('没认出 cookie。粘贴的应该是 SID=…; HSID=…; … 这样的一整行。')}</div>}
                {gProblems.block.map((m) => <div key={m} className="warn">{m}</div>)}
                {gProblems.warn.map((m) => <div key={m}>{m}</div>)}
                {!!geminiList.length && !gProblems.block.length && !gProblems.warn.length && <div className="ok">{tr('cookie 齐了，可以添加')}</div>}
              </div>
            )}
            <div className="row" style={{ gap: 12 }}>
              <button className="link" onClick={() => file.current?.click()}>{tr('从文件导入')}</button>
              {kind === 'gemini' && canSignIn() && <button className="link" onClick={() => setGMode('login')}>{tr('改用登录窗口')}</button>}
            </div>
          </>
        )}
        {kind === 'workbuddy' && wbMode === 'qr' && (
          <div className="gateway-card">
            <div className="gateway-row">
              <span className="grow">{tr('用手机扫码登录')}</span>
              <Select value={realm} onValueChange={(value) => setRealm(String(value) as 'cn' | 'global')} aria-label={tr('站点')} options={[{ value: 'cn', label: tr('国内版') }, { value: 'global', label: tr('国际版') }]} />
              <button className="btn sm" onClick={() => void startLogin()} disabled={logining}>{logining ? tr('等待扫码…') : tr('扫码登录')}</button>
            </div>
            {login && (
              <div className="row" style={{ alignItems: 'flex-start' }}>
                {qr && <img className="pair-qr" src={qr.src} style={{ width: qr.size }} alt={tr('登录二维码')} />}
                <div className="sub" style={{ minWidth: 0 }}>
                  <div>{tr('登录完成后账号会自动加进来。')}</div>
                  <a href={login.url} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all' }}>{login.url}</a>
                </div>
              </div>
            )}
          </div>
        )}
        {geminiBlocked && <div className="sub" role="status">{tr('cookie 还缺必需项，补齐后才能添加。')}</div>}
        <div className="sub">{tr('添加后马上就能用。')}</div>
        <div className="actions">
          <button className="btn ghost" onClick={onClose} disabled={busy}>{tr('取消')}</button>
          {!(kind === 'workbuddy' && wbMode === 'qr') && !(kind === 'gemini' && gMode === 'login') && (
            <button className="btn" onClick={() => void save()} disabled={busy || geminiBlocked}>{busy ? tr('添加中…') : tr('添加')}</button>
          )}
        </div>
    </>
  );
  if (embedded) return <div className="gw-embedded-add">{body}</div>;
  return (
    <div ref={escRef} className="modal-bg dialog-bg" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" style={{ width: 560 }} role="dialog" aria-label={tr('添加账号')}>{body}</div>
    </div>
  );
}
