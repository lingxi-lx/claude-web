import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store';
import { basename, clsx } from '@/util';
import type { PermissionRequestEvent, PermissionResponse } from '@shared';
import { DiffView, Markdown } from './Markdown';
import { CodeBlock } from './CodeBlock';
import { langFromPath } from './highlight';
import { JsonTree } from './tools/McpTool';
import { Icon } from '@/ui/icons';
import { DOCK_DENY_QUEUED, DOCK_HINT, DOCK_STATUS } from '@/ui/terms';
import { useLeaveGhost, type GhostOpts } from '@/ui/ghost';
import { SITE_TOOL, alwaysDetails, alwaysLabel, denyResponse, dockKind, permissionTitle, primaryKey } from './permission-dock';
import { ACCESS_NOTE, accessAsk } from '@/features/computer/computer-tools';
import { tr } from '@/i18n';
import { imeComposing } from '@/ui/ime';

// The card a permission request, an AskUserQuestion or an ExitPlanMode docks above the composer (redesign phase 5,
// spec §5.3 / §5.11): one at a time, 「还有 N 条」 when more wait. The old 「拒绝理由 / 修改意见」 field is the composer
// itself — sending there denies with those words (Composer + `dockAction`), and an empty Enter is this card's main
// button, registered here by the composer's pane + request id. Mission Control, IM and the sidebar answer through
// the same `respondPermission`; a request answered there disappears here on `permission.resolved`.

/** The main button of each docked card (允许一次 / 批准并开始 / 提交回答), for the composer's empty Enter. */
const primaries = new Map<string, () => boolean>();
/** Press the docked card's main button (`key` = `primaryKey(scope, requestId)`); false when it cannot go yet (a question with no answer picked). */
export function runDockPrimary(key: string): boolean {
  return primaries.get(key)?.() ?? false;
}
function usePrimary(scope: string, requestId: string, fn: () => boolean) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const key = primaryKey(scope, requestId);
    const f = () => ref.current();
    primaries.set(key, f);
    return () => { if (primaries.get(key) === f) primaries.delete(key); };
  }, [scope, requestId]);
}

/** One answer per request: the buttons stay disabled until the server says it is resolved (or it failed). */
function useRespond(p: PermissionRequestEvent) {
  const respond = useStore((s) => s.respondPermission);
  const [busy, setBusy] = useState(false);
  const send = (r: PermissionResponse) => {
    if (busy) return false;
    setBusy(true);
    void respond(p.requestId, r).finally(() => setBusy(false));
    return true;
  };
  return { busy, send };
}

interface CardProps { p: PermissionRequestEvent; agent: string; cwd: string; more: number; reason: string; onReasonUsed: () => void; scope: string; note?: string; onDenyQueued?: () => void }

/**
 * The line left of the buttons: the hint (the composer is where another instruction goes), or the composer's note
 * about what Enter will do now. Announced through the card's status line (`DockLive`), not from here.
 */
const Hint = ({ hint, note }: { hint: string; note?: string }) => (note ? <span className="pd-hint note">{note}</span> : <span className="pd-hint">{hint}</span>);

/**
 * The card's status line for screen readers (`aria-live="polite"`, visually hidden): what the card asks and what an
 * empty Enter does on it (「Claude 想运行一条命令。空着按 Enter 允许一次」), then whatever the composer has to say —
 * an Enter it did not take, words that will be queued… (review M-6). The region stays mounted while cards come and
 * go and gets its words a moment after they change, so every change is read out.
 */
function DockLive({ text }: { text: string }) {
  const [said, setSaid] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSaid(text), 60);
    return () => clearTimeout(t);
  }, [text]);
  return <div className="pd-live" role="status" aria-live="polite" aria-atomic="true">{said}</div>;
}

/**
 * After words written before the card were queued by an Enter: take that message back and answer the card with it
 * (拒绝 / 要求修改 / 跳过 with those words). A button, not an Enter — what Enter means never depends on hidden state.
 */
const DenyQueued = ({ p, busy, onDenyQueued }: { p: PermissionRequestEvent; busy: boolean; onDenyQueued?: () => void }) =>
  onDenyQueued ? <button className="btn ghost" data-act="deny-queued" disabled={busy} onClick={onDenyQueued} title={tr('把刚才排队的那条消息撤回来，用它的文字回答这张卡片')}>{DOCK_DENY_QUEUED[dockKind(p)]}</button> : null;

function Head({ p, agent, more, where }: { p: PermissionRequestEvent; agent: string; more: number; where?: string }) {
  const kind = dockKind(p);
  return (
    <div className="pd-head">
      <span className="pd-ic" aria-hidden><Icon name={kind === 'ask' ? 'question' : kind === 'plan' ? 'plan' : kind === 'access' ? 'machine' : 'shield'} size={15} /></span>
      <span className="pd-title">{permissionTitle(p, agent)}</span>
      {more > 0 && <span className="pd-more" title={tr('其它请求排在这一条后面，一次处理一条')}>{tr('还有 {more} 条', { more })}</span>}
      <span className="grow" />
      {where && <span className="pd-where" title={where}><Icon name="folder" size={12} />{basename(where)}</span>}
    </div>
  );
}

/** Enter in an empty composer = this; the ↵ on the button says so. */
const Enter = () => <kbd className="pd-kbd" aria-hidden>↵</kbd>;

function ToolPermission({ p, agent, cwd, more, reason, onReasonUsed, scope, note, onDenyQueued }: CardProps) {
  const { busy, send } = useRespond(p);
  const inp = p.input as Record<string, any>;
  const allowOnce = () => send({ behavior: 'allow' });
  usePrimary(scope, p.requestId, allowOnce);
  const always = alwaysLabel(p.suggestions);
  const deny = () => { if (send(denyResponse(p, reason)) && reason.trim()) onReasonUsed(); };
  const shell = p.toolName === 'Bash' || p.toolName === 'PowerShell';
  const edit = p.toolName === 'Edit' || p.toolName === 'MultiEdit';
  return (
    <>
      <Head p={p} agent={agent} more={more} where={cwd} />
      <div className="pd-body">
        {shell ? (
          <>
            <div className="pd-cmd"><span className="ps" aria-hidden>{p.toolName === 'PowerShell' ? '>' : '$'}</span><code>{String(inp.command ?? '')}</code></div>
            {inp.description && <div className="pd-note">{String(inp.description)}</div>}
          </>
        ) : edit ? (
          <div className="pd-scroll">{(p.toolName === 'MultiEdit' ? inp.edits ?? [] : [inp]).map((e: any, i: number) => <DiffView key={i} oldText={String(e.old_string ?? '')} newText={String(e.new_string ?? '')} title={String(inp.file_path ?? '')} collapse={false} />)}</div>
        ) : p.toolName === 'Write' ? (
          <div className="pd-scroll"><CodeBlock code={String(inp.content ?? '')} lang={langFromPath(String(inp.file_path ?? ''))} title={String(inp.file_path ?? '')} maxLines={40} /></div>
        ) : (
          <div className="pd-scroll jt"><JsonTree value={p.input} /></div>
        )}
        {p.decisionReason && <div className="pd-note">{p.decisionReason}</div>}
      </div>
      <div className="pd-actions">
        <Hint hint={DOCK_HINT.tool(agent)} note={note} />
        <DenyQueued p={p} busy={busy} onDenyQueued={onDenyQueued} />
        <button className="btn" data-act="deny" disabled={busy} onClick={deny} title={reason.trim() ? tr('拒绝，并把输入框里的话告诉 {agent}', { agent }) : tr('拒绝这次操作')}>{tr('拒绝')}</button>
        {always && <button className="btn" data-act="always" disabled={busy} title={tr("允许，并写进权限规则，之后同样的操作不再询问：\n{alwaysDetails}", { alwaysDetails: alwaysDetails(p.suggestions).join('\n') })} onClick={() => send({ behavior: 'allow', updatedPermissions: p.suggestions })}>{always}</button>}
        <button className="btn primary pd-main" data-act="allow" disabled={busy} onClick={allowOnce} title={tr('允许这一次（输入框空着时按 Enter 也是）')}>{tr('允许一次')} <Enter /></button>
      </div>
    </>
  );
}

/**
 * 操控电脑 asking which applications it may control (server/src/computer/access.ts): the applications, the agent's
 * reason, what a yes means. No main button for Enter: control of the desktop is given with a click.
 */
function AccessRequest({ p, agent, more, reason, onReasonUsed, note, onDenyQueued }: CardProps) {
  const { busy, send } = useRespond(p);
  const ask = accessAsk(p.input);
  const deny = () => { if (send(denyResponse(p, reason)) && reason.trim()) onReasonUsed(); };
  return (
    <>
      <Head p={p} agent={agent} more={more} />
      <div className="pd-body pd-access">
        {ask.reason && <div className="pd-why"><span className="k">{tr('它说要做的事')}</span>{ask.reason}</div>}
        <ul className="pd-apps" aria-label={tr('要操控的应用')}>
          {ask.apps.map((a) => <li key={a} className="pd-app"><Icon name="machine" size={13} />{a}</li>)}
        </ul>
        {ask.extras.length > 0 && <div className="pd-note">{tr('还会：{extras}', { extras: ask.extras.join('；') })}</div>}
        <div className="pd-note">{ACCESS_NOTE}</div>
      </div>
      <div className="pd-actions">
        <Hint hint={DOCK_HINT.access(agent)} note={note} />
        <DenyQueued p={p} busy={busy} onDenyQueued={onDenyQueued} />
        <button className="btn" data-act="deny" disabled={busy} onClick={deny} title={reason.trim() ? tr('不允许，并把输入框里的话告诉 {agent}', { agent }) : tr('不允许')}>{tr('不允许')}</button>
        <button className="btn primary pd-main" data-act="allow" disabled={busy} onClick={() => send({ behavior: 'allow' })} title={tr('允许它在这个对话里操控这些应用（只能点这里，按键不会允许）')}>{tr('允许操控')}</button>
      </div>
    </>
  );
}

/** What a site card says each op is going to do, in the user's words. */
const SITE_OP: Record<string, () => string> = {
  click: () => tr('点击'), type: () => tr('输入文字'), key: () => tr('按键'), scroll: () => tr('滚动页面'), computer: () => tr('用鼠标键盘操作'),
  hover: () => tr('把鼠标移到元素上'), drag: () => tr('拖动'), select: () => tr('在下拉框里选择'), eval: () => tr('运行脚本'),
};

/**
 * 允许的网站 (server/src/web/site-gate.ts): Claude wants to change something on a page of a site that is not on the
 * list — 允许一次 / 总是允许这个网站 / 拒绝; or to run a script in the page (asked every time, on any site) —
 * 允许一次 / 拒绝, with the start of the script. An empty Enter allows a site once; a script only with a click.
 */
function SiteRequest({ p, agent, more, reason, onReasonUsed, scope, note, onDenyQueued }: CardProps) {
  const { busy, send } = useRespond(p);
  const inp = p.input as Record<string, unknown>;
  const isEval = inp.eval === true;
  const host = String(inp.host ?? '');
  const op = String(inp.op ?? '');
  const script = String(inp.script ?? '');
  const longer = Number(inp.scriptLength) > script.length;
  const allowOnce = () => send({ behavior: 'allow' });
  // a script runs only on a click: no Enter says yes to it
  usePrimary(scope, isEval ? '' : p.requestId, allowOnce);
  const deny = () => { if (send(denyResponse(p, reason)) && reason.trim()) onReasonUsed(); };
  return (
    <>
      <Head p={p} agent={agent} more={more} />
      <div className="pd-body pd-site" data-id="site-card" data-host={host} data-op={op}>
        <div className="pd-why"><span className="k">{tr('网站')}</span><code>{host || tr('（没有网址的页面）')}</code></div>
        <div className="pd-note">{tr('要做的事：{what}（{tool}）', { what: (SITE_OP[op] ?? (() => op))(), tool: String(inp.tool ?? '') })}</div>
        {isEval ? (
          <>
            <div className="pd-scroll"><CodeBlock code={script + (longer ? '\n…' : '')} lang="javascript" title={longer ? tr('脚本的前 {n} 个字', { n: script.length }) : tr('脚本')} maxLines={14} /></div>
            <div className="pd-note">{tr('脚本能读写这个页面上的一切（包括你登录后的内容）。每次运行都会问你。')}</div>
          </>
        ) : (
          <div className="pd-note">{tr('点「总是允许这个网站」后，Claude 在这个网站上操作页面不再问你（设置 → 联网 → 允许的网站 里可以删掉）。')}</div>
        )}
      </div>
      <div className="pd-actions">
        <Hint hint={DOCK_HINT.tool(agent)} note={note} />
        <DenyQueued p={p} busy={busy} onDenyQueued={onDenyQueued} />
        <button className="btn" data-act="deny" disabled={busy} onClick={deny} title={reason.trim() ? tr('拒绝，并把输入框里的话告诉 {agent}', { agent }) : tr('拒绝这次操作')}>{tr('拒绝')}</button>
        {!isEval && host && <button className="btn" data-act="always" disabled={busy} title={tr('允许，并把 {host} 加进允许的网站，之后在这个网站上操作不再询问', { host })} onClick={() => send({ behavior: 'allow', updatedInput: { allow: 'always' } })}>{tr('总是允许这个网站')}</button>}
        <button className="btn primary pd-main" data-act="allow" disabled={busy} onClick={allowOnce} title={isEval ? tr('允许运行这一次（只能点这里）') : tr('允许这一次（输入框空着时按 Enter 也是）')}>{tr('允许一次')}{!isEval && <> <Enter /></>}</button>
      </div>
    </>
  );
}

function PlanApproval({ p, agent, more, reason, onReasonUsed, scope, note, onDenyQueued }: CardProps) {
  const { busy, send } = useRespond(p);
  const approve = () => send({ behavior: 'allow', updatedInput: p.input });
  // Ctrl+Enter only (the composer decides): a plan is long, an Enter while reading it must not start the work
  usePrimary(scope, p.requestId, approve);
  const revise = () => { if (send(denyResponse(p, reason)) && reason.trim()) onReasonUsed(); };
  return (
    <>
      <Head p={p} agent={agent} more={more} />
      <div className="pd-body"><div className="pd-scroll pd-plan"><Markdown text={String(p.input.plan ?? '')} /></div></div>
      <div className="pd-actions">
        <Hint hint={DOCK_HINT.plan()} note={note} />
        <DenyQueued p={p} busy={busy} onDenyQueued={onDenyQueued} />
        <button className="btn" data-act="deny" disabled={busy} onClick={revise} title={reason.trim() ? tr('把输入框里的修改意见发给 Claude') : tr('要求修改计划')}>{tr('要求修改')}</button>
        <button className="btn primary pd-main" data-act="allow" disabled={busy} onClick={approve} title={tr('批准并开始（输入框空着时按 Ctrl+Enter 也是）')}>{tr('批准并开始')} <kbd className="pd-kbd" aria-hidden>Ctrl ↵</kbd></button>
      </div>
    </>
  );
}

function AskQuestion({ p, agent, more, reason, onReasonUsed, scope, note, onDenyQueued }: CardProps) {
  const { busy, send } = useRespond(p);
  const qs: any[] = (p.input.questions as any[]) ?? [];
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const toggle = (q: any, label: string) => {
    setSel((s) => {
      const cur = s[q.question] ?? [];
      if (q.multiSelect) return { ...s, [q.question]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] };
      return { ...s, [q.question]: [label] };
    });
  };
  const done = (s: Record<string, string[]>) => qs.every((q) => (s[q.question]?.length ?? 0) > 0 || other[q.question]?.trim());
  const complete = done(sel);
  const submit = (s: Record<string, string[]> = sel) => {
    if (!done(s)) return false;
    const answers: Record<string, string> = {};
    for (const q of qs) {
      const o = other[q.question]?.trim();
      const chosen = s[q.question] ?? [];
      answers[q.question] = o ? [...chosen, o].join(', ') : chosen.join(', ');
    }
    return send({ behavior: 'allow', updatedInput: { ...p.input, answers } });
  };
  usePrimary(scope, p.requestId, () => submit());
  const skip = () => { if (send(denyResponse(p, reason)) && reason.trim()) onReasonUsed(); };
  // Enter in the card answers (2026-10-19 user: typed an answer, Enter did nothing): in the 其它 field, or on a
  // single-choice option — that option chosen and sent; on a multi-choice option it only ticks it (Space too)
  const enter = (e: React.KeyboardEvent, q?: any, label?: string) => {
    if (e.key !== 'Enter' || e.shiftKey || imeComposing(e.nativeEvent)) return;
    e.preventDefault();
    if (q && label && q.multiSelect) { toggle(q, label); return; }
    if (!q || !label) { submit(); return; }
    // chosen in any case; sent once every question has an answer (with more than one, Enter is how you go through them)
    const next = { ...sel, [q.question]: [label] };
    if ((sel[q.question] ?? [])[0] !== label) toggle(q, label);
    if (done(next)) submit(next);
  };
  return (
    <>
      <Head p={p} agent={agent} more={more} />
      <div className="pd-body pd-scroll">
        {qs.map((q) => (
          <div key={q.question} className="pd-q">
            <div className="pd-qt">{q.header && <span className="badge">{q.header}</span>} {q.question}</div>
            {q.options.map((o: any) => {
              const on = !!sel[q.question]?.includes(o.label);
              return (
                <button key={o.label} className={clsx('q-opt', on && 'sel')} role={q.multiSelect ? 'checkbox' : 'radio'} aria-checked={on} onClick={() => toggle(q, o.label)} onKeyDown={(e) => enter(e, q, o.label)}>
                  <span className="opt-mark"><Icon name={on ? 'checkCircle' : 'circle'} size={14} /></span>
                  <span className="q-txt">
                    <span className="q-l">{o.label}</span>
                    {o.description && <span className="d">{o.description}</span>}
                    {o.preview && <pre>{o.preview}</pre>}
                  </span>
                </button>
              );
            })}
            <input className="pd-other" placeholder={tr('其它（自定义回答）')} value={other[q.question] ?? ''} onChange={(e) => setOther((s) => ({ ...s, [q.question]: e.target.value }))} onKeyDown={(e) => enter(e)} />
          </div>
        ))}
      </div>
      <div className="pd-actions">
        <Hint hint={DOCK_HINT.ask(agent)} note={note} />
        <DenyQueued p={p} busy={busy} onDenyQueued={onDenyQueued} />
        <button className="btn" data-act="deny" disabled={busy} onClick={skip}>{tr('跳过')}</button>
        <button className="btn primary pd-main" data-act="allow" disabled={busy || !complete} onClick={() => submit()} title={tr('提交回答（选好之后在空输入框按 Enter 也是）')}>{tr('提交回答')} <Enter /></button>
      </div>
    </>
  );
}

/**
 * The card as it leaves (UI refresh §6: out in 180ms): answered here, in Mission Control or from IM, or followed by
 * the next request — an inert copy of it fades out where it was (ui/ghost.ts), under another class (`pdock-out`, the
 * same look in floating.css) so nothing that looks the docked card up by `.pdock` ever finds the copy, without its
 * status line (it would be read out again), floating over what takes its place (the next card, the run card).
 * One instance per request (keyed): its cleanup runs while the card it belonged to is still whole.
 */
const CARD_GHOST: GhostOpts = { ms: 180, className: 'leaving', rename: ['pdock', 'pdock-out'], strip: '.pd-live', float: true };
function CardLeave({ dock }: { dock: HTMLElement | null }) {
  useLeaveGhost(() => dock, () => CARD_GHOST, [dock]);
  return null;
}

/**
 * The first pending request of this conversation, docked above its composer (it replaces the run card while it is
 * there). `reason`: what is typed in the composer — 拒绝 / 要求修改 / 跳过 send it as the reason, then `onReasonUsed`
 * clears the box. `scope`: the composer's pane + tile (the main button is registered per pane). `note`: what Enter
 * will do now, when that is not the usual (words from before the card, queued words, attachments). `onDenyQueued`:
 * words from before the card were queued — the card offers to take them back as its answer (a button).
 */
export function PermissionDock({ sessionId, reason, onReasonUsed, scope, note, onDenyQueued }: { sessionId: string; reason: string; onReasonUsed: () => void; scope: string; note?: string; onDenyQueued?: () => void }) {
  const o = useStore((s) => s.open[sessionId]);
  // the card's element as state (a callback ref): the leaving copy is taken from it by a child's cleanup, when a
  // plain ref is already detached
  const [dock, setDock] = useState<HTMLElement | null>(null);
  const p = o?.pending[0];
  if (!o || !p) return null;
  const agent = o.info?.agent && o.info.agent !== 'claude' ? o.info.agentName ?? o.info.agent : 'Claude';
  const props: CardProps = { p, agent, cwd: o.cwd, more: o.pending.length - 1, reason, onReasonUsed, scope, note, onDenyQueued };
  const kind = dockKind(p);
  const title = permissionTitle(p, agent);
  return (
    <div ref={setDock} className={clsx('pdock', kind)} role="region" aria-label={title} data-request={p.requestId} data-kind={kind}>
      <DockLive text={note ?? `${title}。${DOCK_STATUS[kind]}`} />
      {/* before the card: its cleanup must run first, while the card's own nodes are still there */}
      <CardLeave key={`leave:${p.requestId}`} dock={dock} />
      {kind === 'ask' ? <AskQuestion key={p.requestId} {...props} /> : kind === 'plan' ? <PlanApproval key={p.requestId} {...props} /> : kind === 'access' ? <AccessRequest key={p.requestId} {...props} /> : p.toolName === SITE_TOOL ? <SiteRequest key={p.requestId} {...props} /> : <ToolPermission key={p.requestId} {...props} />}
    </div>
  );
}
