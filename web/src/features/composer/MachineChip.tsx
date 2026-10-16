// 新对话选机器 (spec 2026-10-16 sessions-env §3; the official app's environment picker): on the welcome page, which
// computer the new conversation runs on — this one or a connected federation peer. Only drawn when there is a peer.
import { useRef, useState } from 'react';
import type { PeerInfo } from '@shared';
import { clsx } from '@/util';
import { Icon } from '@/ui/icons';
import { tr } from '@/i18n';
import { Popover } from './Popover';

export function MachineChip({ peers, value, onPick }: { peers: PeerInfo[]; value: string; onPick: (peerId: string) => void }) {
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  const usable = peers.filter((p) => p.enabled);
  if (!usable.length) return null;
  const cur = usable.find((p) => p.id === value);
  const pick = (id: string) => { setOpen(false); onPick(id); };
  return (
    <>
      <button ref={chip} type="button" className={clsx('cchip machine-chip', open && 'open')} aria-haspopup="menu" aria-expanded={open}
        title={tr('新对话在哪台电脑上运行')} onClick={() => setOpen((o) => !o)}>
        <Icon name="monitor" size={14} />
        <span className="cchip-l">{cur ? cur.name : tr('本机')}</span>
      </button>
      {open && (
        <Popover anchor={chip} onClose={() => setOpen(false)} prefer="up" align="left" className="machine-menu" label={tr('运行在')}>
          <button role="menuitemradio" data-mi aria-checked={!cur} className="cm-it" onClick={() => pick('')}>
            <span className="cm-ck">{!cur && <Icon name="check" size={13} />}</span>
            <span className="cm-tx"><span className="cm-l">{tr('本机')}</span></span>
          </button>
          {usable.map((p) => {
            const online = p.state === 'online';
            return (
              <button key={p.id} role="menuitemradio" data-mi aria-checked={p.id === value} className="cm-it" disabled={!online} onClick={() => pick(p.id)}>
                <span className="cm-ck">{p.id === value && <Icon name="check" size={13} />}</span>
                <span className="cm-tx">
                  <span className="cm-l">{p.name}</span>
                  <span className="cm-d">{online ? tr('已连接') : tr('现在连不上')}</span>
                </span>
              </button>
            );
          })}
        </Popover>
      )}
    </>
  );
}
