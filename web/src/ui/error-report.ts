import { tr } from '@/i18n';
// Pure helpers of ui/ErrorBoundary.tsx (kept DOM-free so they are unit-testable in node).

export interface ErrorReport { area: string; message: string; stack?: string; componentStack?: string }

/** The text 复制错误信息 puts on the clipboard (and the gist the server logs). */
export function formatErrorReport(r: ErrorReport, extra: { version?: string; url?: string; userAgent?: string } = {}): string {
  return [
    tr('区域：{area}', { area: r.area }),
    tr('错误：{message}', { message: r.message }),
    extra.version ? tr('运行内核：{version}', { version: extra.version }) : '',
    extra.url ? tr('页面：{url}', { url: extra.url }) : '',
    extra.userAgent ? `UA：${extra.userAgent}` : '',
    r.stack ? tr("\n堆栈：\n{stack}", { stack: r.stack }) : '',
    r.componentStack ? tr("\n组件栈：{componentStack}", { componentStack: r.componentStack }) : '',
  ].filter(Boolean).join('\n');
}

/** Error → report fields. Anything can be thrown (strings, objects without a message). */
export function toReport(area: string, error: unknown, componentStack?: string | null): ErrorReport {
  const e = error as { message?: unknown; stack?: unknown; name?: unknown } | null;
  const message = e && typeof e === 'object' && e.message !== undefined ? `${e.name && e.name !== 'Error' ? `${String(e.name)}: ` : ''}${String(e.message)}` : String(error);
  const stack = e && typeof e === 'object' && typeof e.stack === 'string' ? e.stack : undefined;
  return { area, message: message || tr('（没有错误信息）'), stack, componentStack: componentStack || undefined };
}

/** Did a `__cwCrash(filter)` call target this area? */
export function crashTargets(filter: string, area: string): boolean {
  return area.includes(filter);
}
