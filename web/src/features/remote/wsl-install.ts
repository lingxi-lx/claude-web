// 在 WSL 里安装 (stage E5): show the exact command first; nothing runs until the user says yes.
import type { WslDistro } from '@shared';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { dlg } from '@/ui/dialog';
import { tr } from '@/i18n';

/** Returns the distro checked again after a good install, else null (declined, failed). */
export async function installClaudeInWsl(distro: string): Promise<WslDistro | null> {
  const { command } = await ws.request<{ command: string }>({ kind: 'wsl.installCommand' });
  const ok = await dlg.confirm(tr('要在 {d} 里运行下面的命令安装 Claude Code：\n\n{cmd}\n\n确定后开始安装。', { d: distro, cmd: command }), { okLabel: tr('安装') });
  if (!ok) return null;
  const st = useStore.getState();
  st.toast(tr('安装中…'), true);
  try {
    const r = await ws.request<{ code: number | null; tail: string }>({ kind: 'wsl.install', distro, confirmed: true });
    if (r.code !== 0) { await dlg.alert(r.tail || tr('安装没有成功')); return null; }
    st.toast(tr('装好了'), true);
    return await ws.request<WslDistro>({ kind: 'wsl.check', distro });
  } catch (e: any) {
    await dlg.alert(String(e?.message ?? e));
    return null;
  }
}
