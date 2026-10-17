import type { ReactNode } from 'react';

/**
 * The composer's one row under the text box (spec §5.4; structure round 2): `+` · project · branch on the left,
 * model · effort · permission · mic · send on the right. Never wraps: it is a size container, and below ~560 / 420px (a split pane, a phone) the
 * chips drop their text (`.opt`) and keep their icons; the model chip truncates last. The welcome page and a
 * conversation use the same row; which slots are filled is the caller's business.
 */
export function ComposerBar({ plus, project, branch, status, meter, model, subagent, effort, permission, mic, steer, send }: {
  plus?: ReactNode;
  project?: ReactNode;
  branch?: ReactNode;
  /** a conversation that is not running: 「发送后继续」 before its chips (what the send resumes it with) */
  status?: ReactNode;
  meter?: ReactNode;
  model?: ReactNode;
  /** 子代理 — the model the conversation's subagents run on (Claude only) */
  subagent?: ReactNode;
  /** 想多深 — its own chip next to the model's (none for an agent without levels) */
  effort?: ReactNode;
  permission?: ReactNode;
  mic?: ReactNode;
  steer?: ReactNode;
  send: ReactNode;
}) {
  return (
    <div className="composer-bar cb">
      <div className="cb-left">{plus}{project}{branch}</div>
      <span className="grow" />
      <div className="cb-right">{status}{meter}{model}{subagent}{effort}{permission}{mic}{steer}{send}</div>
    </div>
  );
}

/**
 * A conversation on a wide screen (phase 6 §3, the official app's layout): the box keeps `+`, the words, mic and
 * send; what the next turn runs with sits on a quiet line under it — permission on the left, model · effort and the
 * context ring on the right. Same chip classes as the bar (`.cb`), so every menu and chip behaves the same.
 */
export function ComposerUnder({ lead, permission, stats, status, model, subagent, effort, meter }: {
  /** the new-conversation page: 代码 / 聊天, the computer, the folder and the branch before the permission */
  lead?: ReactNode;
  permission?: ReactNode;
  /** the conversation so far (ConvStatsLine), in the free middle of the row */
  stats?: ReactNode;
  status?: ReactNode;
  model?: ReactNode;
  subagent?: ReactNode;
  effort?: ReactNode;
  meter?: ReactNode;
}) {
  return (
    <div className="composer-under cb">
      <div className="cb-left">{lead}{permission}</div>
      {/* the free middle of the row: the stats take what is left and drop whole items that do not fit */}
      <span className="grow cb-mid">{stats}</span>
      <div className="cb-right">{status}{model}{subagent}{effort}{meter}</div>
    </div>
  );
}
