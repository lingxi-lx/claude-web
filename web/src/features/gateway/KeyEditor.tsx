import { useEscClose } from './use-esc-close';
import { useState } from 'react';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { useGateway } from './state';
import type { GatewayKeyGroup } from '@shared';
import { tr } from '@/i18n';
import { Select } from '@/ui/Select';
import { SwitchChip } from '@/ui/Switch';

interface Form extends GatewayKeyGroup {
  ipLines: string;
  allowLines: string;
}

/** A key group: which route groups, from where, how often, and which models. */
export function KeyEditor({ group, onClose, onSaved }: { group: GatewayKeyGroup; onClose(): void; onSaved(): void }) {
  const toast = useStore((s) => s.toast);
  const routeGroups = useGateway((s) => s.routeGroups);
  const [g, setG] = useState<Form>({
    ...group,
    ipLines: group.ipAllowlist.join('\n'),
    allowLines: (group.modelAllowlist ?? []).join('\n'),
  });
  const save = async () => {
    try {
      await ws.request({
        kind: 'gateway.keyGroups.upsert',
        group: {
          ...(g.id ? { id: g.id } : {}),
          name: g.name,
          allowLan: g.allowLan,
          routeGroupIds: g.routeGroupIds,
          ipAllowlist: g.ipLines.split('\n').map((s) => s.trim()).filter(Boolean),
          modelAllowlist: g.allowLines.split('\n').map((s) => s.trim()).filter(Boolean),
          rateLimit: {
            ...(g.rateLimit?.rpm ? { rpm: g.rateLimit.rpm } : {}),
            ...(g.rateLimit?.concurrent ? { concurrent: g.rateLimit.concurrent } : {}),
            ...(g.rateLimit?.dailyTokens ? { dailyTokens: g.rateLimit.dailyTokens } : {}),
          },
        },
      });
      onSaved();
    } catch (e: any) { toast(e.message); }
  };
  const escRef = useEscClose<HTMLDivElement>(onClose);
  return (
    <div ref={escRef} className="modal-bg dialog-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 560 }}>
        <h3>{group.id ? tr('编辑密钥组') : tr('新建密钥组')}</h3>
        <label className="field"><span>{tr('名称')}</span><input value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} /></label>
        <label className="field">
          <span>{tr('允许的网关组（不选 = 全部）')}</span>
          <Select multiple value={g.routeGroupIds} onValueChange={(value) => setG({ ...g, routeGroupIds: value as string[] })} aria-label={tr('允许的网关组')} options={routeGroups.map((p) => ({ value: p.id, label: p.name, description: p.id }))} placeholder={g.routeGroupIds.length ? undefined : tr('全部网关组')} />
        </label>
        <SwitchChip on={g.allowLan} onChange={(on) => setG({ ...g, allowLan: on })}>{tr('允许局域网使用')}</SwitchChip>
        <label className="field"><span>{tr('来源 IP 白名单（每行一个 CIDR；留空 = 只允许本机）')}</span><textarea className="field" rows={3} value={g.ipLines} onChange={(e) => setG({ ...g, ipLines: e.target.value })} placeholder={'192.168.1.0/24'} /></label>
        <label className="field"><span>{tr('模型白名单（每行一个 glob；留空 = 全部）')}</span><textarea className="field" rows={3} value={g.allowLines} onChange={(e) => setG({ ...g, allowLines: e.target.value })} placeholder={'claude-*'} /></label>
        <div className="row">
          <label className="field"><span>{tr('每分钟请求')}</span><input type="number" min={0} value={g.rateLimit?.rpm ?? 0} onChange={(e) => setG({ ...g, rateLimit: { ...g.rateLimit, rpm: Number(e.target.value) || undefined } })} /></label>
          <label className="field"><span>{tr('并发')}</span><input type="number" min={0} value={g.rateLimit?.concurrent ?? 0} onChange={(e) => setG({ ...g, rateLimit: { ...g.rateLimit, concurrent: Number(e.target.value) || undefined } })} /></label>
          <label className="field"><span>{tr('每天 token')}</span><input type="number" min={0} value={g.rateLimit?.dailyTokens ?? 0} onChange={(e) => setG({ ...g, rateLimit: { ...g.rateLimit, dailyTokens: Number(e.target.value) || undefined } })} /></label>
        </div>
        <div className="row"><span className="grow" /><button className="btn sm ghost" onClick={onClose}>{tr('取消')}</button><button className="btn sm" onClick={() => void save()}>{tr('保存')}</button></div>
      </div>
    </div>
  );
}
