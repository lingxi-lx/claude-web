import { useStore } from '@/store';
import { tr } from '@/i18n';

const KEY = 'gateway.fingerprint';
const TLS_KEY = 'gateway.fingerprint.tls';
const CHOICES = ['off', 'auto', 'claude-code', 'codex', 'gemini-cli'] as const;
type Choice = (typeof CHOICES)[number];

const choiceLabel = (c: Choice | '') => {
  switch (c) {
    case '': return tr('跟随默认');
    case 'off': return tr('关闭');
    case 'auto': return tr('按接口自动选');
    case 'claude-code': return 'Claude Code CLI';
    case 'codex': return 'Codex CLI';
    case 'gemini-cli': return 'Gemini CLI';
  }
};

/**
 * 设置 → 客户端指纹 (gateway.fingerprint): per source, make gateway requests look like the official CLI (UA, header
 * order, body key order, TLS). Off by default; '*' is the default for sources without their own choice.
 */
export function FingerprintSettings() {
  const raw = useStore((s) => s.settings[KEY]);
  const tls = useStore((s) => s.settings[TLS_KEY]);
  const providers = useStore((s) => s.providers);
  const setSetting = useStore((s) => s.setSetting);
  const toast = useStore((s) => s.toast);
  const map: Record<string, string> = raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};

  const save = (id: string, v: Choice | '') => {
    const next = { ...map };
    if (v) next[id] = v; else delete next[id];
    setSetting(KEY, next).catch((e: Error) => toast(e.message));
  };

  return (
    <div className="hub-setcard">
      <div className="hub-setrow">
        <div className="hub-setlabel">
          <b>{tr('默认')}</b>
          <span>{tr('让发往上游的请求和官方命令行一样：User-Agent、请求头顺序、字段顺序、TLS 握手。只在中转或订阅接口挑客户端时才需要打开。')}</span>
        </div>
        <span className="hub-grow" />
        <select aria-label={tr('默认')} value={map['*'] ?? 'off'} onChange={(e) => save('*', e.target.value as Choice)}>
          {CHOICES.map((c) => <option key={c} value={c}>{choiceLabel(c)}</option>)}
        </select>
      </div>
      <div className="hub-setrow">
        <div className="hub-setlabel">
          <b>{tr('TLS 握手')}</b>
          <span>{tr('自动：装了本机指纹助手就用它，否则用 Node 近似。')}</span>
        </div>
        <span className="hub-grow" />
        <select aria-label={tr('TLS 握手')} value={typeof tls === 'string' ? tls : 'auto'} onChange={(e) => setSetting(TLS_KEY, e.target.value).catch((err: Error) => toast(err.message))}>
          <option value="auto">{tr('自动')}</option>
          <option value="node">{tr('只用 Node 近似')}</option>
          <option value="off">{tr('不改 TLS（只改请求头和字段）')}</option>
        </select>
      </div>
      {providers.map((p) => (
        <div className="hub-setrow" key={p.id}>
          <div className="hub-setlabel"><b>{p.name}</b></div>
          <span className="hub-grow" />
          <select aria-label={p.name} value={map[p.id] ?? ''} onChange={(e) => save(p.id, e.target.value as Choice | '')}>
            {(['', ...CHOICES] as const).map((c) => <option key={c} value={c}>{choiceLabel(c)}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}
