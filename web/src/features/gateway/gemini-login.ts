import { desktop } from '@/desktop';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import type { LoginTunnel, UpstreamAccountView, UpstreamStatus } from '@shared';
import { tr } from '@/i18n';

/** meta.json: account id → the cookie store its Google login lives in (desktop/src/gemini-login.ts), to sign in again. */
export const LOGINS_KEY = 'gateway.geminiLogins';

export const canSignIn = (): boolean => !!desktop?.geminiLogin;

let signingIn = false;

const logins = (): Record<string, string> => {
  const v = useStore.getState().settings[LOGINS_KEY];
  return v && typeof v === 'object' ? (v as Record<string, string>) : {};
};

/** The account is gone: so is the Google login its window kept. */
export async function forgetGeminiLogin(accountId: string): Promise<void> {
  const all = logins();
  const partition = all[accountId];
  if (!partition) return;
  const { [accountId]: _, ...rest } = all;
  await useStore.getState().setSetting(LOGINS_KEY, rest);
  await desktop?.geminiForget?.(partition).catch(() => {});
}

/**
 * Sign in to Google in the desktop's login window, then add the account (or, with `accountId`, give that account the
 * new cookies) and check it. Null when the user closed the window first.
 */
export async function signInGemini(opts: { accountId?: string; name?: string; proxyId?: number }): Promise<{ account: UpstreamAccountView; duplicate: boolean } | null> {
  // one sign-in at a time: a second one would be handed the first window's login (another account's)
  if (signingIn) throw new Error(tr('已经有一个登录窗口开着，先在那里登录或把它关掉。'));
  signingIn = true;
  let r: Awaited<ReturnType<NonNullable<NonNullable<typeof desktop>['geminiLogin']>>>;
  let tunnel: LoginTunnel | null = null;
  try {
    // sign in from the same exit the requests will use: Chrome cannot carry proxy credentials, so the
    // server tunnels a loopback port to the chosen residential exit
    if (opts.proxyId) tunnel = await ws.request<LoginTunnel>({ kind: 'upstreams.loginTunnel.open', id: 'gemini', proxyId: opts.proxyId });
    r = await desktop!.geminiLogin!(opts.accountId ? logins()[opts.accountId] : undefined, tunnel?.server);
  } catch (e: any) {
    const raw = String(e?.message ?? e ?? '');
    // the shell's own guard (another app window started a sign-in)
    if (raw.includes('gemini-login-busy')) throw new Error(tr('已经有一个登录窗口开着，先在那里登录或把它关掉。'));
    // IPC wraps the shell's message: "Error invoking remote method 'desktop:gemini:login': Error: <what to say>"
    throw new Error(raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '') || tr('登录没成功'));
  } finally {
    signingIn = false;
    if (tunnel) await ws.request({ kind: 'upstreams.loginTunnel.close', tunnelId: tunnel.tunnelId }).catch(() => {});
  }
  if (!r) return null;
  const credential = { cookie: r.cookie, userAgent: r.userAgent };
  let id = opts.accountId;
  let duplicate = false;
  if (id) {
    // a fresh login is a working login: a component-stopped account comes back on with it
    await ws.request({ kind: 'upstreams.update', id, patch: { credential, enabled: true } });
  } else {
    const added = await ws.request<{ id: string; duplicate: boolean }>({ kind: 'upstreams.add', input: { kind: 'gemini', name: opts.name, credential, source: 'desktop' } });
    id = added.id;
    duplicate = added.duplicate;
  }
  await useStore.getState().setSetting(LOGINS_KEY, { ...logins(), [id]: r.partition });
  const account = await ws.request<UpstreamAccountView>({ kind: 'upstreams.probe', id });
  return { account, duplicate };
}

/** One recovery attempt per account per hour: a dead login must not cost a Chrome launch every ten minutes. */
const recoveredAt = new Map<string, number>();
const RECOVER_EVERY_MS = 60 * 60_000;

/**
 * Bring a Gemini account back without the user. Chromium renews __Secure-1PSIDTS while it is on
 * gemini.google.com — the sidecar's own rotate is refused by Google — so this loads the account's own profile in a
 * windowless Chrome for a few seconds, writes the renewed cookies back and checks again. False when there is no
 * profile, a sign-in owns it, nothing changed, or the login is really gone (then the account row says 重新登录).
 */
export async function recoverGeminiAccount(accountId: string): Promise<boolean> {
  if (!desktop?.geminiRefresh) return false;
  const partition = logins()[accountId];
  if (!partition) return false;
  if (Date.now() - (recoveredAt.get(accountId) ?? 0) < RECOVER_EVERY_MS) return false;
  recoveredAt.set(accountId, Date.now());
  const got = await desktop.geminiRefresh(partition).catch(() => null);
  if (!got) return false;
  try {
    await ws.request({ kind: 'upstreams.update', id: accountId, patch: { credential: { cookie: got.cookie, userAgent: got.userAgent }, enabled: true } });
    const account = await ws.request<UpstreamAccountView>({ kind: 'upstreams.probe', id: accountId });
    return account.health === 'ok';
  } catch { return false; }
}

let keepalive: number | null = null;

/**
 * The app's own keepalive for Gemini web: once after start and then every ten minutes, every account whose login
 * looks dead gets one recovery attempt. Silent when it cannot be saved (the accounts page already explains it).
 */
export function startGeminiKeepalive(): void {
  if (keepalive !== null || !desktop?.geminiRefresh) return;
  const tick = async () => {
    try {
      const st = await ws.request<UpstreamStatus>({ kind: 'upstreams.status' });
      const dead = st.accounts.filter((a) => a.kind === 'gemini' && (
        a.health === 'expired' || a.health === 'error' || (a.health === 'disabled' && !!a.autoDisabledAt)
      ));
      for (const a of dead) {
        if (await recoverGeminiAccount(a.id)) useStore.getState().toast(tr('Gemini 账号已自动恢复'), true);
      }
    } catch { /* the server is not up yet: the next tick tries again */ }
  };
  window.setTimeout(() => void tick(), 30_000);
  keepalive = window.setInterval(() => void tick(), 10 * 60_000);
}
