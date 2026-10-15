import { useEffect, useState } from 'react';
import { ws } from '@/ws/client';
import { useScopedSession, useStore } from '@/store';
import { dlg } from '@/ui/dialog';
import { imeComposing } from '@/ui/ime';
import type { SkillInfo } from '@shared';
import { Icon } from '@/ui/icons';
import { joinPath } from '@/features/paths';
import { tr } from '@/i18n';

const SUGGESTED = [
  { src: 'anthropics/skills', l: tr('Anthropic 官方 skills 合集'), d: tr('docx / pptx / xlsx / pdf 等文档技能') },
  { src: 'obra/superpowers', l: 'superpowers', d: tr('brainstorm / TDD / 调试 / 计划 等工作流技能') },
];

/** Skills: list (user + project), install from GitHub / local, scaffold new, open in editor, remove. The backup is `SkillsBackup`. */
export function SkillsSection() {
  const active = useScopedSession();
  const openTile = useStore((s) => s.openTile);
  const [list, setList] = useState<SkillInfo[]>([]);
  const [src, setSrc] = useState('');
  const [scope, setScope] = useState<'user' | 'project'>('user');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const cwd = active?.cwd;
  const reload = () => ws.request<SkillInfo[]>({ kind: 'skills.list', cwd }).then(setList).catch((e) => setMsg(e.message));
  useEffect(() => { void reload(); }, [cwd]);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setMsg('');
    try { setMsg(await fn()); await reload(); } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };
  const install = (s = src) => run(async () => { const r = await ws.request<string[]>({ kind: 'skills.install', source: s, scope, cwd }); setSrc(''); return tr('已安装 {rCount} 个：{map}', { rCount: r.length, map: r.map((p) => p.split(/[\\/]/).pop()).join(', ') }); });
  const create = async () => {
    const name = await dlg.prompt(tr('新 skill 名称'), 'my-skill', { message: tr('小写字母、数字、连字符') });
    if (!name) return;
    const description = (await dlg.prompt(tr('一句话描述（什么时候用）'), '')) ?? '';
    await run(async () => { const p = await ws.request<string>({ kind: 'skills.create', name, scope, cwd, description }); openTile({ id: `d${Date.now()}`, kind: 'doc', path: joinPath(p, 'SKILL.md') }, 'tab'); return tr('已创建 {p}', { p }); });
  };
  return (
    <>
      <div className="section">
        <h5>{tr('已安装（{listCount}）', { listCount: list.length })}</h5>
        <div className="list">
          {list.map((s) => (
            <div key={s.path} className="row" title={s.path}>
              <span><Icon name="skill" size={13} /></span>
              <div className="grow">
                <div>/{s.name} <span className="badge">{s.scope === 'user' ? tr('用户') : tr('项目')}</span></div>
                <div className="sub">{s.description || s.path}</div>
              </div>
              <button className="btn sm ghost" onClick={() => openTile({ id: `d${Date.now()}`, kind: 'doc', path: joinPath(s.path, 'SKILL.md') }, 'tab')}>{tr('编辑')}</button>
              <button className="btn sm ghost" onClick={() => ws.request({ kind: 'shell.open', path: s.path })}>{tr('目录')}</button>
              <button className="btn sm ghost danger" onClick={async () => { if (await dlg.confirm(tr('删除 skill「{name}」？', { name: s.name }), { danger: true })) void run(async () => { await ws.request({ kind: 'skills.remove', path: s.path }); return tr('已删除'); }); }} aria-label={tr('删除')}><Icon name="trash" size={12} /></button>
            </div>
          ))}
          {!list.length && <div className="empty">{tr('还没有 skill。下面从 GitHub 安装或新建一个。')}</div>}
        </div>
      </div>
      <div className="section">
        <h5>{tr('安装')}</h5>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input className="field" style={{ flex: 1 }} placeholder={tr('owner/repo、owner/repo/子目录、GitHub 链接或本地路径')} value={src} onChange={(e) => setSrc(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !imeComposing(e.nativeEvent) && src && install()} />
          <select className="field" value={scope} onChange={(e) => setScope(e.target.value as any)}>
            <option value="user">{tr('用户级 ~/.claude/skills')}</option>
            <option value="project" disabled={!cwd}>{tr('项目级 .claude/skills')}</option>
          </select>
          <button className="btn sm primary" disabled={busy || !src.trim()} onClick={() => install()}>{busy ? tr('处理中…') : tr('安装')}</button>
          <button className="btn sm" disabled={busy} onClick={create}><Icon name="plus" size={12} /> {tr('新建')}</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {SUGGESTED.map((s) => <button key={s.src} className="chip" title={s.d} disabled={busy} onClick={() => install(s.src)}>{s.l}</button>)}
        </div>
        {msg && <div className="sub" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{msg}</div>}
      </div>
    </>
  );
}

/** Backup of the user-level skills (a tar in ~/.claude-web/backups). Settings → Skills → 更多选项. */
export function SkillsBackup() {
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const backup = async () => {
    setBusy(true); setMsg('');
    try { const f = await ws.request<string>({ kind: 'skills.backup' }); toast(tr('已备份'), true); setMsg(tr('已备份到 {f}', { f })); } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };
  return (
    <div className="section">
      <h5>{tr('备份')}</h5>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn sm" disabled={busy} onClick={backup}>{tr('备份用户级 skills')}</button>
        <button className="btn sm ghost" onClick={() => ws.request({ kind: 'shell.open', path: '~/.claude-web/backups' }).catch(() => {})}>{tr('打开备份目录')}</button>
      </div>
      <div className="sub" style={{ marginTop: 4 }}>{tr('tar 归档放在 ~/.claude-web/backups；恢复：把 tar 解压回 ~/.claude 即可。')}</div>
      {msg && <div className="sub" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{msg}</div>}
    </div>
  );
}
