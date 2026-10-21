export function nextSelection(current: string | string[], value: string, multiple: boolean): string | string[] {
  if (!multiple) return value;
  const next = new Set(Array.isArray(current) ? current : [current]);
  if (next.has(value)) next.delete(value); else next.add(value);
  return [...next];
}

export function filterOptions<T extends { label: string; description?: string }>(options: T[], query: string): T[] {
  const q = query.trim().toLocaleLowerCase();
  return q ? options.filter((o) => `${o.label} ${o.description ?? ''}`.toLocaleLowerCase().includes(q)) : options;
}
