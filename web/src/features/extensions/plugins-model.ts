// 插件 → 已安装: what the state filter shows. Pure (plugins.test.ts).

export type Show = 'all' | 'on' | 'off';

/** The installed list as the filter shows it: on ones first, then by name. */
export function shownPlugins<P extends { id: string; enabled?: boolean; manifest?: { name?: string } }>(list: P[], show: Show): P[] {
  const name = (p: P) => (p.manifest?.name ?? p.id).toLowerCase();
  return list
    .filter((p) => show === 'all' || (show === 'on') === !!p.enabled)
    .sort((a, b) => Number(!!b.enabled) - Number(!!a.enabled) || name(a).localeCompare(name(b)));
}
