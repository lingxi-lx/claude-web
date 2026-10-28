// 任务中心: labels and the family / task matrix both the list and the editor use. The server enforces the same
// matrix (UpstreamService.familyTasks); this only keeps impossible choices out of the form.
import type { MaintenanceKind, MaintenanceTask, UpstreamAccountView, UpstreamGroup, UpstreamKind } from '@shared';
import { tr } from '@/i18n';

export const KIND_LABEL: Record<MaintenanceKind, string> = {
  checkin: tr('签到'),
  keepalive: tr('保活'),
  growth: tr('成长任务'),
  travel: tr('猫咪旅行'),
  lottery: tr('抽奖'),
  activity: tr('活动'),
  'quota-refresh': tr('刷新额度'),
  'account-check': tr('账号检查'),
};

export const FAMILY_TASKS: Record<UpstreamKind, MaintenanceKind[]> = {
  claude: ['account-check', 'quota-refresh'],
  gemini: ['keepalive', 'account-check'],
  workbuddy: ['checkin', 'keepalive', 'growth', 'travel', 'lottery', 'activity', 'quota-refresh', 'account-check'],
  provider: ['account-check', 'quota-refresh'],
};

export const FAMILY_LABEL: Record<UpstreamKind, string> = {
  claude: 'Claude',
  gemini: tr('Gemini 网页'),
  workbuddy: 'WorkBuddy',
  provider: tr('第三方登录'),
};

export const kindLabel = (k: MaintenanceKind): string => KIND_LABEL[k] ?? k;

export function scheduleText(t: MaintenanceTask): string {
  if (t.schedule.cron) return t.schedule.cron;
  return tr('每 {n} 分钟', { n: t.schedule.everyMinutes ?? 0 });
}

export function targetText(t: MaintenanceTask, accounts: UpstreamAccountView[], pools: UpstreamGroup[]): string {
  const target = t.target;
  if (target.kind === 'account') return accounts.find((a) => a.id === target.accountId)?.name ?? target.accountId;
  const g = pools.find((x) => x.id === target.groupId);
  return g ? tr('账号池「{name}」', { name: g.name }) : target.groupId;
}

/** The family behind a task's target, for choosing which kinds to offer. */
export function targetFamily(t: Pick<MaintenanceTask, 'target'>, accounts: UpstreamAccountView[], pools: UpstreamGroup[]): UpstreamKind | undefined {
  const target = t.target;
  if (target.kind === 'account') return accounts.find((a) => a.id === target.accountId)?.kind;
  return pools.find((x) => x.id === target.groupId)?.kind;
}
