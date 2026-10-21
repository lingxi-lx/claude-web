// The gateway section's parts. Ordinary use is 概览 / 账号 / 任务 / 分组: accounts join the default route, and
// users can combine account families in a route group. Keys, logs and LAN settings stay behind 高级.
import type { IconName } from '@/ui/icons';
import { tr } from '@/i18n';

export type GatewayTab = 'overview' | 'accounts' | 'tasks' | 'routes' | 'keys' | 'logs' | 'settings';

export const GATEWAY_TITLE = tr('网关');

export interface GatewayTabDef { id: GatewayTab; label: string; icon: IconName; title: string; advanced?: boolean }

export const GATEWAY_TABS: GatewayTabDef[] = [
  { id: 'overview', label: tr('概览'), icon: 'usage', title: tr('开关、地址和账号状态') },
  { id: 'accounts', label: tr('账号'), icon: 'agent', title: tr('Claude、Gemini 网页和 WorkBuddy 账号') },
  { id: 'tasks', label: tr('任务'), icon: 'tasks', title: tr('签到、保活和额度刷新') },
  { id: 'routes', label: tr('分组与路由'), icon: 'orchestra', title: tr('组合账号来源、模型映射和故障转移') },
  { id: 'keys', label: tr('密钥'), icon: 'shield', title: tr('密钥组、来源 IP、限速和预算（高级）'), advanced: true },
  { id: 'logs', label: tr('日志'), icon: 'config', title: tr('审计日志（高级）'), advanced: true },
  { id: 'settings', label: tr('设置'), icon: 'settings', title: tr('监听地址、局域网和审计保留（高级）'), advanced: true },
];

export const gatewayTabLabel = (id: GatewayTab): string => GATEWAY_TABS.find((t) => t.id === id)?.label ?? id;
export const isAdvancedTab = (id: GatewayTab): boolean => !!GATEWAY_TABS.find((t) => t.id === id)?.advanced;
export const gatewayTabsFor = (advanced: boolean): GatewayTabDef[] => GATEWAY_TABS.filter((t) => advanced || !t.advanced);
