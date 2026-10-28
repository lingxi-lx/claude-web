import { useEffect, useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import type {
  SyncApplyResult, SyncPreview, SyncRemoteConfig, SyncRemotePullResult, SyncRemotePushResult,
  SyncRemoteStatus, SyncRemoteTestResult,
} from '@shared';
import { tr } from '@/i18n';
import { SyncPreviewCard } from './SyncPanel';

const EMPTY: SyncRemoteConfig = {
  backend: 'webdav',
  webdav: { url: '', username: '', password: '' },
  s3: { endpoint: '', bucket: '', region: '', accessKeyId: '', secretAccessKey: '', prefix: '' },
  github: { repo: '', branch: '', path: '', token: '' },
};

const fromStatus = (s: SyncRemoteStatus): SyncRemoteConfig => ({
  backend: s.backend,
  webdav: { ...s.webdav },
  s3: { ...s.s3 },
  github: { ...s.github },
});

const when = (t: number) => new Date(t).toLocaleString();

/**
 * 备份与同步 → 远程同步: WebDAV / S3 / GitHub hold the same bundle as 导出文件. The server stores the credentials
 * encrypted and only ever sends the mask back; a pulled bundle is applied through the same per-item preview as 导入.
 */
export function RemoteSyncPanel() {
  const toast = useStore((s) => s.toast);
  const [status, setStatus] = useState<SyncRemoteStatus | null>(null);
  const [form, setForm] = useState<SyncRemoteConfig>(EMPTY);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const dirty = !!status && JSON.stringify(form) !== JSON.stringify(fromStatus(status));

  const refresh = async (fillForm: boolean) => {
    const r = await ws.request<SyncRemoteStatus>({ kind: 'sync.remote.status' });
    setStatus(r);
    if (fillForm) setForm(fromStatus(r));
  };

  useEffect(() => { void refresh(true).catch((e: any) => toast(e.message)); }, [toast]);

  const w = (k: keyof SyncRemoteConfig['webdav'], v: string) => setForm((f) => ({ ...f, webdav: { ...f.webdav, [k]: v } }));
  const s = (k: keyof SyncRemoteConfig['s3'], v: string) => setForm((f) => ({ ...f, s3: { ...f.s3, [k]: v } }));
  const g = (k: keyof SyncRemoteConfig['github'], v: string) => setForm((f) => ({ ...f, github: { ...f.github, [k]: v } }));

  const save = async () => {
    setBusy(true);
    try {
      const r = await ws.request<SyncRemoteStatus>({ kind: 'sync.remote.set', config: form });
      setStatus(r);
      setForm(fromStatus(r));
      toast(tr('远程同步设置已保存'), true);
    } catch (e: any) { toast(e.message); } finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true);
    try {
      const r = await ws.request<SyncRemoteTestResult>({ kind: 'sync.remote.test' });
      toast(r.message, true);
      await refresh(false);
    } catch (e: any) { toast(e.message); await refresh(false).catch(() => {}); } finally { setBusy(false); }
  };

  const push = async () => {
    setBusy(true);
    try {
      const r = await ws.request<SyncRemotePushResult>({ kind: 'sync.remote.push', ...(pass ? { passphrase: pass } : {}) });
      toast(r.warning ?? tr('已推送 {n} KB', { n: Math.max(1, Math.round(r.bytes / 1024)) }), true);
      await refresh(false);
    } catch (e: any) { toast(e.message); await refresh(false).catch(() => {}); } finally { setBusy(false); }
  };

  const pull = async () => {
    setBusy(true);
    try {
      const r = await ws.request<SyncRemotePullResult>({ kind: 'sync.remote.pull', ...(pass ? { passphrase: pass } : {}) });
      setPreview(r);
      toast(tr('已拉取，确认后导入'), true);
      await refresh(false);
    } catch (e: any) { toast(e.message); await refresh(false).catch(() => {}); } finally { setBusy(false); }
  };

  const apply = async (skip: string[]) => {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await ws.request<SyncApplyResult>({ kind: 'sync.apply', token: preview.token, skip });
      toast(r.conflicts ? tr('已导入 {n} 项，{c} 项冲突两边都保留了', { n: r.applied, c: r.conflicts }) : tr('已导入 {n} 项', { n: r.applied }), true);
      setPreview(null);
    } catch (e: any) { toast(e.message); } finally { setBusy(false); }
  };

  const cancelPreview = () => {
    if (preview) void ws.request({ kind: 'sync.cancel', token: preview.token }).catch(() => {});
    setPreview(null);
  };

  const cancelOp = () => { void ws.request({ kind: 'sync.remote.cancel' }).catch(() => {}); };

  return (
    <div className="gateway-tab cw-sync">
      <div className="gateway-card">
        <div className="gateway-row">
          <b>{tr('远程同步')}</b>
          <span className="sub">{tr('把这份备份放到 WebDAV、S3 或 GitHub，另一台电脑拉下来逐项合并。')}</span>
          <span className="grow" />
          <select className="input" value={form.backend} disabled={busy} onChange={(e) => setForm((f) => ({ ...f, backend: e.target.value as SyncRemoteConfig['backend'] }))}>
            <option value="webdav">WebDAV</option>
            <option value="s3">S3</option>
            <option value="github">GitHub</option>
          </select>
        </div>

        {form.backend === 'webdav' && (
          <>
            <div className="gateway-row">
              <span className="sub" style={{ minWidth: 90 }}>{tr('地址')}</span>
              <input className="input grow" placeholder="https://dav.example.com/claude-web/" value={form.webdav.url} disabled={busy} onChange={(e) => w('url', e.target.value)} />
            </div>
            <div className="gateway-row">
              <span className="sub" style={{ minWidth: 90 }}>{tr('用户名')}</span>
              <input className="input grow" value={form.webdav.username} disabled={busy} onChange={(e) => w('username', e.target.value)} autoComplete="username" />
            </div>
            <div className="gateway-row">
              <span className="sub" style={{ minWidth: 90 }}>{tr('密码')}</span>
              <input className="input grow" type="password" placeholder={tr('留空表示匿名')} value={form.webdav.password} disabled={busy} onChange={(e) => w('password', e.target.value)} autoComplete="new-password" />
            </div>
          </>
        )}

        {form.backend === 's3' && (
          <>
            <div className="gateway-row">
              <span className="sub" style={{ minWidth: 90 }}>{tr('地址')}</span>
              <input className="input grow" placeholder="https://s3.us-east-1.amazonaws.com" value={form.s3.endpoint} disabled={busy} onChange={(e) => s('endpoint', e.target.value)} />
            </div>
            <div className="gateway-row">
              <span className="sub" style={{ minWidth: 90 }}>{tr('存储桶')}</span>
              <input className="input grow" value={form.s3.bucket} disabled={busy} onChange={(e) => s('bucket', e.target.value)} />
            </div>
            <div className="gateway-row">
              <span className="sub" style={{ minWidth: 90 }}>{tr('区域')}</span>
              <input className="input grow" placeholder="us-east-1" value={form.s3.region} disabled={busy} onChange={(e) => s('region', e.target.value)} />
            </div>
            <div className="gateway-row">
              <span className="sub" style={{ minWidth: 90 }}>{tr('Access Key')}</span>
              <input className="input grow" value={form.s3.accessKeyId} disabled={busy} onChange={(e) => s('accessKeyId', e.target.value)} autoComplete="off" />
            </div>
            <div className="gateway-row">
              <span className="sub" style={{ minWidth: 90 }}>{tr('Secret Key')}</span>
              <input className="input grow" type="password" value={form.s3.secretAccessKey} disabled={busy} onChange={(e) => s('secretAccessKey', e.target.value)} autoComplete="new-password" />
            </div>
            <div className="gateway-row">
              <span className="sub" style={{ minWidth: 90 }}>{tr('前缀')}</span>
              <input className="input grow" placeholder={tr('留空表示存储桶根目录')} value={form.s3.prefix} disabled={busy} onChange={(e) => s('prefix', e.target.value)} />
            </div>
          </>
        )}

        {form.backend === 'github' && (
          <>
            <div className="gateway-row">
              <span className="sub" style={{ minWidth: 90 }}>{tr('仓库')}</span>
              <input className="input grow" placeholder="owner/repo" value={form.github.repo} disabled={busy} onChange={(e) => g('repo', e.target.value)} />
            </div>
            <div className="gateway-row">
              <span className="sub" style={{ minWidth: 90 }}>{tr('分支')}</span>
              <input className="input grow" placeholder="main" value={form.github.branch} disabled={busy} onChange={(e) => g('branch', e.target.value)} />
            </div>
            <div className="gateway-row">
              <span className="sub" style={{ minWidth: 90 }}>{tr('路径')}</span>
              <input className="input grow" placeholder={tr('留空表示仓库根目录')} value={form.github.path} disabled={busy} onChange={(e) => g('path', e.target.value)} />
            </div>
            <div className="gateway-row">
              <span className="sub" style={{ minWidth: 90 }}>{tr('令牌')}</span>
              <input className="input grow" type="password" value={form.github.token} disabled={busy} onChange={(e) => g('token', e.target.value)} autoComplete="new-password" />
            </div>
          </>
        )}

        <div className="gateway-row">
          <span className="sub" style={{ minWidth: 90 }}>{tr('口令')}</span>
          <input className="input grow" type="password" placeholder={tr('加密密钥和隐私规则用；留空则推送不含密钥的备份')} value={pass} disabled={busy} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
        </div>

        <div className="gateway-row">
          <button className="btn sm" disabled={busy || !status} onClick={() => void save()}>{tr('保存')}</button>
          <button className="btn sm" disabled={busy || dirty || !status?.configured} onClick={() => void test()}>{tr('测试连接')}</button>
          <button className="btn sm" disabled={busy || dirty || !status?.configured} onClick={() => void push()}>{tr('推送')}</button>
          <button className="btn sm" disabled={busy || dirty || !status?.configured} onClick={() => void pull()}>{tr('拉取')}</button>
          <span className="grow" />
          {busy && <button className="btn sm ghost" onClick={cancelOp}>{tr('取消')}</button>}
        </div>

        {dirty && <div className="sub">{tr('改动还没保存，先点「保存」再测试或同步。')}</div>}
        {status?.lastError && <div className="sub" style={{ color: 'var(--warn)' }}>{status.lastError}</div>}
        {status && !status.configured && <div className="sub">{tr('还缺：{fields}', { fields: status.missing.join('、') })}</div>}
        {status && status.configured && (
          <div className="sub">
            {status.lastPushAt ? tr('上次推送：{time}', { time: when(status.lastPushAt) }) : tr('还没有推送过')}
            {status.lastPullAt ? ` · ${tr('上次拉取：{time}', { time: when(status.lastPullAt) })}` : ''}
            {status.lastTestAt ? ` · ${tr('上次测试：{time}', { time: when(status.lastTestAt) })}` : ''}
          </div>
        )}
        <div className="sub">{tr('测试、推送和拉取都用已保存的设置；密码、Secret Key 和令牌保存后只显示圆点。')}</div>
      </div>

      {preview && (
        <SyncPreviewCard key={preview.token} preview={preview} busy={busy} onApply={apply} onCancel={cancelPreview} />
      )}
    </div>
  );
}
