import { useEffect, useMemo, useRef, useState } from 'react';
import type { EngineId, EngineLoginImportResult, EngineLoginProvider, EngineLoginSession } from '@shared';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { openExternal } from '@/features/chat/link-route';
import { tr } from '@/i18n';
import { Icon } from '@/ui/icons';
import { useGateway } from './state';
import { useEscClose } from './use-esc-close';

const ENGINE_NAME: Record<EngineId, string> = { cliproxyapi: 'CLIProxyAPI', magpie: 'Magpie' };

/**
 * Vendor sign-ins that live in an engine (Magpie's provider plugins, CLIProxyAPI's management OAuth). The engine
 * keeps the account and serves its models; claude-web only opens the sign-in and shows what came back. This is the
 * path for providers whose own OAuth client is not public but whose engine adapter is: Gemini, Antigravity, Kimi,
 * Grok, Qoder, Trae, WorkBuddy, ZCode, Kiro, Devin, Factory, MiMo, Cline.
 */
export function EngineLoginDialog({ providerId, engine: onlyEngine, embedded, onClose, onDone }: {
  providerId?: string;
  engine?: EngineId;
  embedded?: boolean;
  onClose(): void;
  onDone?(): void;
}) {
  const toast = useStore((s) => s.toast);
  const engines = useGateway((s) => s.engines);
  const [providers, setProviders] = useState<EngineLoginProvider[]>([]);
  const [session, setSession] = useState<EngineLoginSession | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [importFor, setImportFor] = useState<EngineLoginProvider | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);
  const sessionRef = useRef<EngineLoginSession | null>(null);
  sessionRef.current = session;
  const escRef = useEscClose<HTMLDivElement>(() => { if (!busy) close(); }, !!embedded);

  useEffect(() => {
    ws.request<{ providers: EngineLoginProvider[] }>({ kind: 'engines.login.providers' })
      .then((r) => setProviders(r.providers))
      .catch((e: any) => setError(e.message));
  }, []);

  const stopPolling = () => { if (timer.current !== null) { window.clearInterval(timer.current); timer.current = null; } };
  const cancelSession = () => {
    const s = sessionRef.current;
    if (s && s.state === 'pending') void ws.request({ kind: 'engines.login.cancel', id: s.engine, loginId: s.id }).catch(() => {});
  };
  useEffect(() => () => { stopPolling(); cancelSession(); }, []);

  const close = () => { stopPolling(); cancelSession(); onClose(); };
  const rows = useMemo(() => providers.filter((p) => (!providerId || p.catalogId === providerId) && (!onlyEngine || p.engine === onlyEngine)), [providers, providerId, onlyEngine]);

  const watch = (s: EngineLoginSession) => {
    stopPolling();
    timer.current = window.setInterval(async () => {
      try {
        const next = await ws.request<EngineLoginSession>({ kind: 'engines.login.status', id: s.engine, loginId: s.id });
        setSession(next);
        if (next.state === 'pending') return;
        stopPolling();
        setBusy(null);
        if (next.state === 'done') {
          toast(tr('登录完成，模型会出现在「{name}」来源里', { name: ENGINE_NAME[next.engine] }), true);
          await useGateway.getState().loadEngines().catch(() => {});
          await useGateway.getState().load().catch(() => {});
          onDone?.();
        } else if (next.state === 'error') setError(next.message ?? tr('登录没有完成'));
      } catch (e: any) {
        stopPolling();
        setBusy(null);
        setError(e.message);
      }
    }, 1500);
  };

  const begin = async (p: EngineLoginProvider) => {
    setBusy(`${p.engine}:${p.provider}`);
    setError('');
    setSession(null);
    try {
      const s = await ws.request<EngineLoginSession>({ kind: 'engines.login.begin', id: p.engine, provider: p.provider });
      setSession(s);
      if (s.url) openExternal(s.url);
      if (s.state === 'pending') watch(s);
      else {
        setBusy(null);
        if (s.state === 'done') { toast(tr('登录完成，模型会出现在「{name}」来源里', { name: ENGINE_NAME[s.engine] }), true); onDone?.(); }
      }
    } catch (e: any) {
      setBusy(null);
      setError(e.message);
    }
  };

  const pickImport = (p: EngineLoginProvider) => { setImportFor(p); fileRef.current?.click(); };
  const doImport = async (file: File) => {
    const p = importFor;
    if (!p) return;
    setBusy(`${p.engine}:${p.provider}:import`);
    setError('');
    try {
      const res = await ws.request<EngineLoginImportResult>({ kind: 'engines.login.import', id: p.engine, provider: p.provider, text: await file.text() });
      toast(tr('已导入 {n} 个账号', { n: res.imported }), true);
      await useGateway.getState().loadEngines().catch(() => {});
      await useGateway.getState().load().catch(() => {});
      onDone?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
      setImportFor(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const body = (
    <>
      {!embedded && <h3>{tr('用 {name} 登录第三方账号', { name: onlyEngine ? ENGINE_NAME[onlyEngine] : tr('本地网关') })}</h3>}
      <div className="sub">
        {tr('账号由{name}保存和调用；登录后模型会出现在它的来源里。这里不会复制一份令牌。', { name: onlyEngine ? ENGINE_NAME[onlyEngine] : tr('本地网关') })}
      </div>

      {!session && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json,text/plain"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); }}
          />
          <div className="gw-catalog" role="list">
            {rows.map((p) => {
              const running = engines.find((e) => e.id === p.engine)?.running;
              const id = `${p.engine}:${p.provider}`;
              return (
                <div key={id} className="gw-catalog-item">
                  <button className="gw-catalog-row" data-id={id} disabled={!!busy} onClick={() => void begin(p)}>
                    <span className="gw-source-who">
                      <b>{p.name}</b>
                      <span className="sub">{p.reason ?? (running ? tr('通过 {engine} 登录', { engine: ENGINE_NAME[p.engine] }) : tr('会先安装并启动 {engine}', { engine: ENGINE_NAME[p.engine] }))}</span>
                    </span>
                    <span className="gw-tag">{p.method === 'device' ? tr('设备码') : p.method === 'local' ? tr('本机登录态') : tr('浏览器登录')}</span>
                    {busy === id && <Icon name="refresh" size={13} />}
                  </button>
                  {p.engine === 'magpie' && (
                    <button className="link" disabled={!!busy} onClick={() => pickImport(p)}>
                      {busy === `${p.engine}:${p.provider}:import` ? tr('导入中…') : tr('从文件导入…')}
                    </button>
                  )}
                </div>
              );
            })}
            {!rows.length && !error && <div className="sub">{tr('正在读取登录方式…')}</div>}
            {rows.some((p) => p.engine === 'magpie') && (
              <div className="sub">{tr('导入文件支持 Sub2API / CLIProxyAPI / Codex / Claude / Antigravity 的账号导出。')}</div>
            )}
          </div>
        </>
      )}

      {session && (
        <div className="gateway-card" role="status">
          <div className="gw-kv"><span className="muted">{tr('登录方式')}</span><span>{ENGINE_NAME[session.engine]}</span></div>
          {session.state === 'pending' && <div className="sub">{tr('正在等待登录完成…')}</div>}
          {session.userCode && (
            <div className="gateway-row">
              <code style={{ fontSize: 18, letterSpacing: 2 }}>{session.userCode}</code>
              {session.url && <button className="link" onClick={() => openExternal(session.url!)}>{tr('打开登录页面')}</button>}
            </div>
          )}
          {!session.userCode && session.url && <button className="link" onClick={() => openExternal(session.url!)}>{tr('打开登录页面')}</button>}
          {session.message && <div className="sub">{session.message}</div>}
          {session.state === 'done' && <div className="ok"><Icon name="checkCircle" size={14} /> {tr('已登录')}</div>}
          {session.state === 'error' && <div className="sub warn">{session.message}</div>}
          {session.state === 'pending' && <button className="btn sm ghost" onClick={() => { cancelSession(); setSession({ ...session, state: 'cancelled' }); }}>{tr('取消登录')}</button>}
          <button className="btn sm ghost" onClick={() => setSession(null)}>{tr('换一个')}</button>
        </div>
      )}

      {error && <div className="sub warn" role="status">{error}</div>}

      <div className="actions">
        <button className="btn ghost" onClick={close}>{session?.state === 'done' ? tr('完成') : tr('关闭')}</button>
      </div>
    </>
  );

  if (embedded) return <div className="gw-embedded-add">{body}</div>;
  return (
    <div ref={escRef} className="modal-bg dialog-bg" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="modal" style={{ width: 600 }} role="dialog" aria-label={tr('第三方登录')}>{body}</div>
    </div>
  );
}
