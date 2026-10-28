import { useState } from 'react';
import { Icon } from '@/ui/icons';
import { clsx } from '@/util';
import { tr } from '@/i18n';
import { useStore } from '@/store';

type ControlMode = 'browser' | 'desktop';
type ControlStatus = 'running' | 'waiting' | 'paused' | 'taken' | 'error';
type StepState = 'done' | 'now' | 'wait';

interface ControlStep {
  id: string;
  text: string;
  target?: string;
  result?: string;
  ms?: number;
  state: StepState;
}

interface ControlSession {
  id: string;
  title: string;
  mode: ControlMode;
  target: string;
  status: ControlStatus;
  current: number;
  apps: string[];
  steps: ControlStep[];
}

/**
 * P6's computer-task runtime will hand this page its live sessions. Until then the list is intentionally empty: the
 * three columns and the takeover / stop affordances are here, but nothing is invented (spec §6.7 状态: 没有任务).
 */
const SESSIONS: ControlSession[] = [];

const statusText = (s: ControlStatus): string =>
  s === 'running' ? tr('运行中') : s === 'waiting' ? tr('等待授权') : s === 'paused' ? tr('已暂停') : s === 'taken' ? tr('已接管') : tr('出错');

const statusClass = (s: ControlStatus): string =>
  s === 'running' ? 'green' : s === 'waiting' ? 'warn' : s === 'error' ? 'danger' : '';

const modeText = (m: ControlMode): string => (m === 'browser' ? tr('浏览器') : tr('桌面'));

/**
 * 操控 (spec §6.7): which computer tasks are running, the live frame, the session's grants + step timeline, and the
 * takeover / stop controls. Browser and desktop are two views of the same page, not two pages.
 */
export function ControlPage() {
  const toast = useStore((s) => s.toast);
  const [mode, setMode] = useState<ControlMode>('browser');
  const [picked, setPicked] = useState<string | null>(SESSIONS[0]?.id ?? null);
  const [taken, setTaken] = useState(false);
  const session = SESSIONS.find((s) => s.id === picked) ?? null;
  const steps = session?.steps ?? [];
  const currentStep = session ? session.steps[session.current - 1] : undefined;

  const stop = () => {
    setTaken(false);
    toast(tr('已停止操控任务'), true);
  };

  return (
    <div className="hub-body">
      <div className="hub-row" style={{ marginBottom: 12 }}>
        <div className="hub-seg" role="tablist" aria-label={tr('操控模式')}>
          <button role="tab" aria-selected={mode === 'browser'} className={mode === 'browser' ? 'on' : ''} onClick={() => setMode('browser')}>
            {tr('浏览器')}
          </button>
          <button role="tab" aria-selected={mode === 'desktop'} className={mode === 'desktop' ? 'on' : ''} onClick={() => setMode('desktop')}>
            {tr('桌面')}
          </button>
        </div>
        <span className="hub-grow" />
        <button className="btn sm ghost" disabled={!session} onClick={stop}>
          <Icon name="stop" size={13} /> {tr('停止')}
        </button>
        <button className="btn sm" disabled={!session} onClick={() => toast(tr('在对话里打开这一轮'))}>
          <Icon name="chat" size={13} /> {tr('打开对话')}
        </button>
      </div>

      <div className="hub-control">
        <section className="hub-card hub-sessions" aria-label={tr('操控对话')}>
          {SESSIONS.length ? (
            SESSIONS.map((s) => (
              <button key={s.id} className={clsx('hub-session', s.id === session?.id && 'on')} onClick={() => { setPicked(s.id); setMode(s.mode); setTaken(s.status === 'taken'); }}>
                <div className="nm">{s.title}</div>
                <div className="sub">{modeText(s.mode)} · {s.target}</div>
                <div className="sub">
                  <span className={clsx('hub-chip', statusClass(s.status))}>{statusText(s.status)}</span>
                </div>
              </button>
            ))
          ) : (
            <div className="hub-empty" style={{ minHeight: 210, border: 0 }}>
              <b>{tr('还没有正在跑的操控任务')}</b>
              <span>{tr('在对话里打开操控电脑，或让 Agent 使用浏览器。')}</span>
            </div>
          )}
        </section>

        <section className="hub-card hub-live" aria-label={tr('实时画面')}>
          <div className="hd">
            <h3>{tr('实时画面')}</h3>
            <span className="hub-grow" />
            <span className="hub-chip">{modeText(mode)}</span>
            {session && <span className="hub-muted hub-sml">{tr('第 {n} / {total} 步', { n: session.current, total: session.steps.length })}</span>}
            {taken && <span className="hub-chip warn">{tr('已接管')}</span>}
          </div>
          <div className="bd" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div className="frame">
              {session ? (
                <div style={{ textAlign: 'center', maxWidth: 360 }}>
                  <Icon name={mode === 'desktop' ? 'monitor' : 'browser'} size={30} />
                  <div style={{ marginTop: 8 }}>
                    {taken
                      ? tr('现在由你操作画面；Agent 的输入会被拒绝。')
                      : currentStep
                        ? tr('第 {n} 步：{text}', { n: session.current, text: currentStep.text })
                        : tr('任务正在准备画面')}
                  </div>
                  <div className="hub-sml">{tr('Agent 光标和点击涟漪会叠在画面上')}</div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', maxWidth: 360 }}>
                  <Icon name={mode === 'desktop' ? 'monitor' : 'browser'} size={30} />
                  <div style={{ marginTop: 8, color: 'var(--hub-text)', fontWeight: 600 }}>{tr('还没有正在跑的操控任务')}</div>
                  <div className="hub-sml">{tr('在对话里打开操控电脑，或让 Agent 使用浏览器。')}</div>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="hub-card" aria-label={tr('授权与步骤')}>
          <div className="hd">
            <h3>{tr('授权与步骤')}</h3>
          </div>
          <div className="bd">
            <div className="hub-muted hub-sml">{tr('已授权')}</div>
            <div className="hub-row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {session?.apps.length
                ? session.apps.map((app) => <span className="hub-chip" key={app}>{app}</span>)
                : <span className="hub-muted hub-sml">{tr('还没有授权任何应用')}</span>}
            </div>

            <div className="hub-muted hub-sml" style={{ marginTop: 14 }}>
              {session ? tr('步骤 {n} / {total}', { n: session.current, total: session.steps.length }) : tr('步骤')}
            </div>
            <div className="hub-timeline" style={{ marginTop: 4 }}>
              {steps.length ? steps.map((step, i) => (
                <div key={step.id} className={clsx('hub-step', step.state === 'done' && 'done', step.state === 'now' && 'now')}>
                  <span className="n">{step.state === 'done' ? <Icon name="check" size={11} /> : i + 1}</span>
                  <span className="tx">
                    {step.text}
                    {step.result && <span className="hub-muted hub-sml"> · {step.result}</span>}
                  </span>
                </div>
              )) : (
                <div className="hub-step">
                  <span className="n">·</span>
                  <span className="tx hub-muted hub-sml">{tr('任务开始后，每一步会出现在这里')}</span>
                </div>
              )}
            </div>

            <div className="hub-row" style={{ marginTop: 14 }}>
              <button className="btn sm" disabled={!session} onClick={() => { if (!taken) toast(tr('已接管，正在跑的任务立刻停下'), true); else toast(tr('已交还，Agent 可以继续'), true); setTaken(!taken); }}>
                {taken ? tr('交还') : tr('接管')}
              </button>
              <button className="btn sm ghost" disabled={!session} onClick={stop}>
                <Icon name="stop" size={12} /> {tr('停止')}
              </button>
            </div>
          </div>
        </section>
      </div>

      <section className="hub-card" style={{ marginTop: 12 }}>
        <div className="hd">
          <h3>{tr('最近动作')}</h3>
          <span className="hub-grow" />
          <span className="hub-muted hub-sml">{tr('点一行看详情')}</span>
        </div>
        <div className="bd">
          <div className="hub-table-wrap">
            <table className="hub-table">
              <thead>
                <tr>
                  <th>{tr('时间')}</th>
                  <th>{tr('动作')}</th>
                  <th>{tr('目标')}</th>
                  <th>{tr('结果')}</th>
                  <th>{tr('耗时')}</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((step, i) => (
                  <tr key={step.id}>
                    <td className="hub-mono">{String(i + 1).padStart(2, '0')}</td>
                    <td>{step.text}</td>
                    <td>{step.target ?? '—'}</td>
                    <td>{step.result ?? '—'}</td>
                    <td className="hub-mono">{step.ms != null ? `${step.ms}ms` : '—'}</td>
                  </tr>
                ))}
                {!steps.length && <tr><td colSpan={5} className="hub-empty-cell">{tr('还没有动作')}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
