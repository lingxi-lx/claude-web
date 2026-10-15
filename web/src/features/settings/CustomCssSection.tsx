import { useStore } from '@/store';
import { ws } from '@/ws/client';
import { fmtSize } from '@/model/attachments';
import { CUSTOM_CSS_KEY } from '@/app/custom-css';
import { Row, Toggle } from './controls';
import { tr } from '@/i18n';

/**
 * 外观 → 自定义样式 (GitHub issue #2): where custom.css is, whether it is loaded, and a way to start one. It goes over
 * the built-in styles in every window and reloads the moment it is saved; the desktop app's updates leave it alone.
 */
export function CustomCssSection() {
  const c = useStore((s) => s.customCss);
  const on = useStore((s) => s.settings[CUSTOM_CSS_KEY] !== false);
  const st = useStore.getState;
  const edit = async () => {
    try {
      const r = await ws.request<{ path: string }>({ kind: 'ui.customCss.create' });
      await st().loadCustomCss();
      useStore.setState({ settingsOpen: null });
      st().openTile({ id: `d${Date.now().toString(36)}`, kind: 'doc', path: r.path }, 'tab');
    } catch (e) {
      st().toast(e instanceof Error ? e.message : String(e));
    }
  };
  const folder = () => {
    const p = c?.path;
    if (!p) return;
    void ws.request({ kind: 'shell.open', path: p.replace(/[\\/][^\\/]*$/, '') }).catch((e) => st().toast(e.message));
  };
  const state = !c ? tr('读取中…')
    : c.error ? c.error
    : !c.exists ? tr('还没有这个文件')
    : !on ? tr('已关闭（文件还在）')
    : tr('已加载 · {size}', { size: fmtSize(c.size) });
  return (
    <div className="section custom-css">
      <h5>{tr('自定义样式')}</h5>
      <Row label={tr('使用 custom.css')} hint={tr('在内置样式之后加载你自己的 CSS，保存后所有窗口立即生效，不用重启；应用更新不会覆盖它。改坏了就在这里关掉。')}>
        <Toggle k={CUSTOM_CSS_KEY} def label={tr('使用 custom.css')} />
      </Row>
      <div className="kv" style={{ marginTop: 4 }}>
        <span className="k">{tr('文件')}</span><span className="mono" style={{ userSelect: 'text', wordBreak: 'break-all' }}>{c?.path ?? '…'}</span>
        <span className="k">{tr('状态')}</span><span data-custom-css-state={c ? (c.error ? 'error' : !c.exists ? 'missing' : on ? 'loaded' : 'off') : 'loading'} style={c?.error ? { color: 'var(--err)' } : undefined}>{state}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button className="btn sm" data-act="custom-css-edit" onClick={() => void edit()}>{c?.exists ? tr('编辑 custom.css') : tr('新建 custom.css')}</button>
        <button className="btn sm ghost" disabled={!c?.path} onClick={folder}>{tr('打开所在文件夹')}</button>
      </div>
      <div className="sub" style={{ marginTop: 8 }}>{tr('新建的文件里写着可以放心用的类名和 data 属性（比如计划的 data-done / data-total 和 --progress），以后的版本保持不变。')}</div>
    </div>
  );
}
