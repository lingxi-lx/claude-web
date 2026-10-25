// A project with extra folders (stage C2): the files / search / git panels show one foldable group per folder —
// the main one first. With one folder it is just that folder's panel, as before. Folded state is the component's own.
import { useState } from 'react';
import { basename, clsx } from '@/util';
import { Icon } from '@/ui/icons';

export function RootGroups({ roots, children }: { roots: string[]; children: (root: string) => React.ReactNode }) {
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  if (roots.length <= 1) return <>{children(roots[0] ?? '')}</>;
  return (
    <div className="root-groups" data-id="root-groups">
      {roots.map((r) => {
        const open = !folded[r];
        return (
          <div key={r} className={clsx('root-group', open && 'open')} data-root={r}>
            <button className="root-group-head" aria-expanded={open} title={r} onClick={() => setFolded((f) => ({ ...f, [r]: open }))}>
              <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
              <Icon name="folder" size={13} />
              <span className="grow">{basename(r) || r}</span>
            </button>
            {open && <div className="root-group-body">{children(r)}</div>}
          </div>
        );
      })}
    </div>
  );
}
