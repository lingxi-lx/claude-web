import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentInfo, AgentSelectionState } from '@shared';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import { AGENT_ICONS, ICON_NAMES, Icon, type IconName } from '@/ui/icons';
import { dlg } from '@/ui/dialog';
import { Select } from '@/ui/Select';
import { clsx } from '@/util';
import { tr } from '@/i18n';

interface AgentRow {
  id: string;
  kind: string;
  name: string;
  icon: IconName;
  installed: boolean;
  enabled: boolean;
  model: string;
  models: string[];
  effort?: string;
  path?: string;
  install?: string;
  probeError?: string;
}

interface Preset {
  id: string;
  name: string;
  models: Record<string, string>;
}

/** Shown until the server has answered `agents.list` (or on a server that knows no agents at all). */
const FALLBACK: AgentRow[] = [
  { id: 'claude', kind: 'claude', name: 'Claude Code', icon: 'claude', installed: true, enabled: true, model: 'claude/claude-opus-4.7', models: [], effort: tr('高'), path: '~/.claude/settings.json' },
  { id: 'codex', kind: 'codex', name: 'Codex', icon: 'codex', installed: true, enabled: true, model: 'codex/gpt-5.5', models: [], effort: tr('中'), path: '~/.codex/config.toml' },
  { id: 'gemini', kind: 'gemini', name: 'Gemini CLI', icon: 'gemini', installed: false, enabled: true, model: tr('未选择'), models: [], path: '~/.gemini/settings.json' },
  { id: 'opencode', kind: 'opencode', name: 'OpenCode', icon: 'opencode', installed: true, enabled: true, model: 'group/coder', models: [], path: '~/.config/opencode/opencode.json' },
  { id: 'cursor', kind: 'cursor', name: 'Cursor CLI', icon: 'agent', installed: false, enabled: true, model: tr('未选择'), models: [] },
];

function iconOf(a: AgentInfo): IconName {
  if ((ICON_NAMES as string[]).includes(a.icon)) return a.icon as IconName;
  return AGENT_ICONS[a.kind] ?? 'agent';
}

function fromAgent(a: AgentInfo): AgentRow {
  return {
    id: a.kind,
    kind: a.kind,
    name: a.label ? `${a.name} · ${a.label}` : a.name,
    icon: iconOf(a),
    installed: a.installed,
    enabled: a.enabled,
    model: a.model || a.reportedModels?.[0]?.value || tr('默认模型'),
    models: a.reportedModels?.map((m) => m.value) ?? a.models ?? [],
    path: a.path || a.command,
    install: a.install,
    probeError: a.probeError,
  };
}

/**
 * 接入 (spec §6.11): which agents are installed, which model each one uses, and the saved model presets. The rows
 * come from `useStore.agents`; until that list arrives (or on an older server) a static set keeps the page legible.
 */
export function AgentsPage() {
  const agents = useStore((s) => s.agents);
  const loadAgents = useStore((s) => s.loadAgents);
  const toast = useStore((s) => s.toast);
  const setSetting = useStore((s) => s.setSetting);
  const rawPresets = useStore((s) => s.settings['hub.agentPresets']);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<AgentRow | null>(null);
  const [model, setModel] = useState('');

  const rows = agents.length ? agents.map(fromAgent) : FALLBACK;
  const presets = useMemo<Preset[]>(() => (Array.isArray(rawPresets) ? (rawPresets as Preset[]).filter((p) => p && typeof p.id === 'string' && p.models) : []), [rawPresets]);
  const savePresets = (list: Preset[]) => setSetting('hub.agentPresets', list).catch((e: any) => toast(e.message));

  const rescan = async () => {
    setBusy(true);
    try {
      await loadAgents(true);
      toast(tr('已重新扫描'), true);
    } catch (e: any) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };
  const savePreset = async () => {
    const name = await dlg.prompt(tr('方案名称'), tr('我的方案'));
    if (!name) return;
    const models = Object.fromEntries(rows.filter((a) => a.installed).map((a) => [a.kind, a.model]));
    const next = [...presets.filter((p) => p.name !== name), { id: `${Date.now().toString(36)}`, name, models }];
    await savePresets(next);
    toast(tr('已保存方案「{name}」', { name }), true);
  };
  const applyPreset = async (p: Preset) => {
    setBusy(true);
    try {
      for (const [kind, value] of Object.entries(p.models)) {
        await ws.request({ kind: 'agents.set', agent: kind as any, patch: { model: value } });
      }
      await loadAgents(false);
      toast(tr('已应用方案「{name}」', { name: p.name }), true);
    } catch (e: any) { toast(e.message); } finally { setBusy(false); }
  };
  const renamePreset = async (p: Preset) => {
    const name = await dlg.prompt(tr('方案名称'), p.name);
    if (!name || name === p.name) return;
    await savePresets(presets.map((x) => (x.id === p.id ? { ...x, name } : x)));
  };
  const deletePreset = async (p: Preset) => {
    if (!(await dlg.confirm(tr('删除方案「{name}」？', { name: p.name }), { danger: true }))) return;
    await savePresets(presets.filter((x) => x.id !== p.id));
  };

  const changeModel = (a: AgentRow) => {
    setEditing(a);
    setModel(a.model === tr('默认模型') ? '' : a.model);
  };
  const saveModel = async () => {
    if (!editing) return;
    try {
      await ws.request({ kind: 'agents.set', agent: editing.kind as any, patch: { model: model.trim() } });
      await loadAgents(false);
      toast(tr('已改 {name} 的模型', { name: editing.name }), true);
      setEditing(null);
    } catch (e: any) { toast(e.message); }
  };
  const disconnect = async (a: AgentRow) => {
    if (!(await dlg.confirm(tr('断开 {name}？', { name: a.name }), { message: tr('会把它改过的配置键还原，之后重新连接就会再用新的模型。'), danger: true, okLabel: tr('断开') }))) return;
    try {
      await ws.request({ kind: 'agents.set', agent: a.kind as any, patch: { enabled: false } });
      await loadAgents(false);
      toast(tr('已断开 {name}', { name: a.name }), true);
    } catch (e: any) { toast(e.message); }
  };
  const connect = async (a: AgentRow) => {
    if (a.install) {
      try { await navigator.clipboard.writeText(a.install); toast(tr('安装命令已复制：{cmd}', { cmd: a.install }), true); }
      catch { toast(tr('安装命令：{cmd}', { cmd: a.install })); }
    } else {
      toast(tr('{name} 还没有安装', { name: a.name }));
    }
  };

  return (
    <div className="hub-body">
      <div className="hub-row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn sm" disabled={busy} onClick={() => void rescan()}>
          <Icon name="refresh" size={13} /> {busy ? tr('扫描中…') : tr('重新扫描')}
        </button>
        <button className="btn sm ghost" onClick={() => void savePreset()}>
          <Icon name="star" size={13} /> {tr('保存当前为方案')}
        </button>
        <span className="hub-grow" />
        <span className="hub-muted hub-sml">{tr('配置只改它自己的键，断开时还原')}</span>
      </div>

      <section className="hub-card">
        <div className="hd">
          <h3>{tr('Agent')}</h3>
          <span className="hub-grow" />
          <span className="hub-muted hub-sml">{tr('{n} 个已接入', { n: rows.filter((r) => r.installed).length })}</span>
        </div>
        <div className="bd">
          {rows.map((a) => (
            <div className="hub-agent-row" key={a.id} title={a.path}>
              <span className="hub-ic"><Icon name={a.icon} size={16} /></span>
              <div className="nm">
                <b>{a.name}</b>
                <span>
                  {a.installed ? tr('已接入') : tr('未安装')}
                  {!a.enabled ? ` · ${tr('已停用')}` : ''}
                  {a.path ? ` · ${a.path}` : ''}
                </span>
                {a.probeError && <span style={{ color: 'var(--warn)' }}>{a.probeError}</span>}
              </div>
              {a.installed ? (
                <>
                  <span className={clsx('hub-chip', 'green')}>{a.model}</span>
                  {a.effort && <span className="hub-chip">{a.effort}</span>}
                  <button className="btn sm" onClick={() => changeModel(a)}>{tr('改模型')}</button>
                  <button className="btn sm ghost" onClick={() => disconnect(a)}>{tr('断开')}</button>
                </>
              ) : (
                <>
                  <span className="hub-chip">{a.model}</span>
                  <button className="btn sm" onClick={() => connect(a)}>{tr('接入')}</button>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      <AgentConfigFiles />

      <section className="hub-card" style={{ marginTop: 12 }}>
        <div className="hd">
          <h3>{tr('方案')}</h3>
          <span className="hub-grow" />
          <button className="btn sm ghost" onClick={() => toast(tr('新建方案'))}>
            <Icon name="plus" size={12} /> {tr('新建方案')}
          </button>
        </div>
        <div className="bd">
          {presets.map((p) => (
            <div className="hub-agent-row" key={p.id}>
              <div className="nm">
                <b>{p.name}</b>
                <span>{Object.values(p.models).filter(Boolean).slice(0, 3).join(' · ')}</span>
              </div>
              <button className="btn sm" disabled={busy} onClick={() => void applyPreset(p)}>{tr('应用')}</button>
              <button className="btn sm ghost" onClick={() => void renamePreset(p)}>{tr('改名')}</button>
              <button className="btn sm ghost" onClick={() => void deletePreset(p)}>{tr('删除')}</button>
            </div>
          ))}
          {!presets.length && <div className="hub-empty-inline">{tr('还没有方案。调好每个 Agent 的模型后，用上面的「保存当前为方案」存一套。')}</div>}
        </div>
      </section>

      <p className="hub-muted hub-sml" style={{ marginTop: 12 }}>
        {tr('导入：Claude Code settings.json、Codex config.toml、Magpie providers.json、CPA config.yaml + auths/。')}
      </p>
      {editing && (
        <div className="modal-bg dialog-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="modal hub-edit-modal" role="dialog" aria-label={tr('改 {name} 的模型', { name: editing.name })} style={{ maxWidth: 520, height: 'auto' }}>
            <div className="gw-detail-head">
              <h3>{tr('改 {name} 的模型', { name: editing.name })}</h3>
              <span className="hub-grow" />
              <button className="icon-btn" aria-label={tr('关闭')} onClick={() => setEditing(null)}><Icon name="close" size={15} /></button>
            </div>
            <div className="hub-edit-body">
              {editing.models.length > 0 ? (
                <Select value={model} onValueChange={(v) => setModel(String(v))} aria-label={tr('模型')} searchable options={[{ value: '', label: tr('默认模型') }, ...editing.models.map((m) => ({ value: m, label: m }))]} />
              ) : (
                <label className="field"><span>{tr('模型 id')}</span><input value={model} onChange={(e) => setModel(e.target.value)} placeholder={tr('留空 = 用 Agent 自己的默认模型')} autoFocus /></label>
              )}
              <div className="hub-row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
                <button className="btn sm ghost" onClick={() => setEditing(null)}>{tr('取消')}</button>
                <button className="btn sm" onClick={() => void saveModel()}>{tr('保存')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const fieldName = (f: string) => (f === 'model' ? tr('模型') : tr('推理强度'));
const shown = (v: string) => v || tr('未设置');

/**
 * Every agent the registry knows (server agent-config/registry.ts), what its own config file says now, what
 * claude-web last wrote there, and whether the file was changed since — with re-apply / keep / restore.
 */
function AgentConfigFiles() {
  const toast = useStore((s) => s.toast);
  const [list, setList] = useState<AgentSelectionState[] | null>(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try { setList(await ws.request<AgentSelectionState[]>({ kind: 'agentConfig.selections' })); } catch (e: any) { toast(e.message); }
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  const act = async (a: AgentSelectionState, kind: 'agentConfig.selection.reapply' | 'agentConfig.selection.accept' | 'agentConfig.selection.restore', done: string) => {
    setBusy(a.id);
    try {
      const next = await ws.request<AgentSelectionState>({ kind, agent: a.id });
      setList((cur) => (cur ?? []).map((x) => (x.id === a.id ? next : x)));
      toast(done, true);
    } catch (e: any) { toast(e.message); } finally { setBusy(''); }
  };
  const setModel = async (a: AgentSelectionState) => {
    const model = await dlg.prompt(tr('{name} 用的模型', { name: a.name }), a.model, { message: tr('只改它配置文件里的模型这一项，其它内容保持不变。') });
    if (model === null || !model.trim()) return;
    let effort: string | null | undefined;
    if (a.effortField) {
      const e = await dlg.prompt(tr('{name} 的推理强度', { name: a.name }), a.effort, { message: tr('留空 = 不设置') });
      if (e === null) return;
      effort = e.trim() || null;
    }
    setBusy(a.id);
    try {
      const next = await ws.request<AgentSelectionState>({ kind: 'agentConfig.selection.apply', agent: a.id, model: model.trim(), ...(effort === undefined ? {} : { effort }) });
      setList((cur) => (cur ?? []).map((x) => (x.id === a.id ? next : x)));
      toast(tr('已改 {name} 的模型', { name: a.name }), true);
    } catch (e: any) { toast(e.message); } finally { setBusy(''); }
  };
  const restore = async (a: AgentSelectionState) => {
    if (!(await dlg.confirm(tr('还原 {name} 的配置？', { name: a.name }), { message: tr('把模型和推理强度改回 claude-web 第一次写入之前的值。'), okLabel: tr('还原') }))) return;
    await act(a, 'agentConfig.selection.restore', tr('已还原 {name}', { name: a.name }));
  };

  const rows = list ?? [];
  const drifted = rows.filter((a) => a.drift?.drifted).length;
  return (
    <section className="hub-card" style={{ marginTop: 12 }} data-hook="agent-config-files">
      <div className="hd">
        <h3>{tr('各 Agent 的配置文件')}</h3>
        <span className="hub-grow" />
        {drifted > 0 && <span className="hub-chip" style={{ color: 'var(--warn)' }}>{tr('{n} 个被改过', { n: drifted })}</span>}
        <button className="btn sm ghost" onClick={() => void load()} aria-label={tr('刷新')}><Icon name="refresh" size={12} /></button>
      </div>
      <div className="bd">
        {list === null && <div className="hub-empty-inline">{tr('读取中…')}</div>}
        {rows.map((a) => (
          <div key={a.id} className="hub-agent-row" title={a.configPath} data-agent={a.id} style={{ flexWrap: 'wrap' }}>
            <div className="nm">
              <b>{a.name}</b>
              <span>{a.detected ? a.configPath : tr('本机没有它的配置文件')}</span>
              {a.error && <span style={{ color: 'var(--warn)' }}>{a.error}</span>}
              {a.drift?.drifted && (
                <span style={{ color: 'var(--warn)' }}>
                  {tr('配置文件在 claude-web 之外被改过：')}
                  {a.drift.changes.map((c) => tr('{field} 现在是 {current}，claude-web 写的是 {expected}', { field: fieldName(c.field), current: shown(c.current), expected: shown(c.expected) })).join('；')}
                </span>
              )}
              {a.wsl?.map((w) => (
                <span key={w.distro} className="hub-muted">
                  {`WSL · ${w.distro}：${shown(w.model)}${w.effort ? ` · ${w.effort}` : ''}`}
                  {w.drift?.drifted ? ` · ${tr('和 claude-web 写的不一样')}` : ''}
                </span>
              ))}
            </div>
            {a.detected && <span className={clsx('hub-chip', a.drift?.drifted ? undefined : 'green')}>{shown(a.model)}</span>}
            {a.detected && a.effort && <span className="hub-chip">{a.effort}</span>}
            {a.drift?.drifted && (
              <>
                <button className="btn sm" disabled={busy === a.id} onClick={() => void act(a, 'agentConfig.selection.reapply', tr('已重新应用 {name}', { name: a.name }))}>{tr('重新应用')}</button>
                <button className="btn sm ghost" disabled={busy === a.id} onClick={() => void act(a, 'agentConfig.selection.accept', tr('已保留 {name} 现在的配置', { name: a.name }))}>{tr('保留现在的')}</button>
              </>
            )}
            {a.detected && <button className="btn sm ghost" disabled={busy === a.id} onClick={() => void setModel(a)}>{tr('改模型')}</button>}
            {a.restorable && <button className="btn sm ghost" disabled={busy === a.id} onClick={() => void restore(a)}>{tr('还原')}</button>}
          </div>
        ))}
      </div>
    </section>
  );
}
