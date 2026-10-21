import { useState } from 'react';
import { ws } from '@/ws/client';
import { useGateway } from './state';
import { useStore } from '@/store';
import { dlg } from '@/ui/dialog';
import { tr } from '@/i18n';

/** 日志: the whitelisted audit lines. Prompts and bodies are never in here. */
export function LogsTab() {
  const logs = useGateway((s) => s.logs);
  const toast = useStore((s) => s.toast);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const rows = onlyErrors ? logs.filter((l) => l.status >= 400) : logs;
  const clear = async () => {
    if (!(await dlg.confirm(tr('清空审计日志？'), { danger: true, okLabel: tr('清空') }))) return;
    await ws.request({ kind: 'gateway.audit.clear' });
    await useGateway.getState().load();
  };
  const exportAll = async () => {
    const text = await ws.request<string>({ kind: 'gateway.audit.export' });
    const url = URL.createObjectURL(new Blob([text], { type: 'application/jsonl' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gateway-audit.jsonl';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(tr('已导出'), true);
  };
  return (
    <div className="gateway-tab">
      <div className="gateway-row">
        <label className="chip"><input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> {tr('只看错误')}</label>
        <span className="grow" />
        <button className="btn sm ghost" onClick={() => void exportAll()}>{tr('导出')}</button>
        <button className="btn sm ghost danger" onClick={() => void clear()}>{tr('清空')}</button>
      </div>
      <div className="gateway-log">
        {rows.map((l, i) => (
          <div className="gateway-row" key={`${l.ts}-${i}`}>
            <span className="sub">{new Date(l.ts).toLocaleTimeString()}</span>
            <code>{l.protocol}</code>
            <span className="grow">{l.model}</span>
            <span className="sub">{l.member}</span>
            <span className={`gateway-badge ${l.status >= 400 ? 'bad' : 'ok'}`}>{l.status}</span>
            <span className="sub">{l.ms}ms</span>
          </div>
        ))}
        {rows.length === 0 && <div className="empty">{tr('还没有记录')}</div>}
      </div>
    </div>
  );
}
