// A character theme's text contrast (WCAG 2.x), the same table web/src/ui/contrast.test.ts holds the default themes
// to: what the theme skill's draft check reports, and what the built-in themes' unit test asserts.

function rgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  h = h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}
function luminance(hex: string): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export const GROUNDS = ['bg', 'bg-1', 'bg-2', 'bg-elev'] as const;
export const TEXT_RULES: { ink: string; min: number }[] = [
  { ink: 'fg', min: 7 }, { ink: 'fg-1', min: 4.5 }, { ink: 'fg-2', min: 4.5 },
  { ink: 'green', min: 4.5 }, { ink: 'red', min: 4.5 }, { ink: 'yellow', min: 4.5 }, { ink: 'blue', min: 4.5 },
  { ink: 'accent-text', min: 4.5 }, { ink: 'fg-3', min: 3 },
];

/** Every contrast the theme misses, as a sentence for the skill (Chinese, like the other draft checks). Empty = fine. */
export function contrastProblems(c: Record<string, string>): string[] {
  const out: string[] = [];
  const need = (ink: string, ground: string, min: number, what = '') => {
    if (!c[ink] || !c[ground]) return;
    const r = contrast(c[ink], c[ground]);
    if (r < min) out.push(`${ink} 在 ${ground} 上对比度 ${r.toFixed(2)}，至少要 ${min}${what}`);
  };
  for (const r of TEXT_RULES) for (const g of GROUNDS) need(r.ink, g, r.min);
  need('fg', 'user-bg', 7, '（用户消息气泡）');
  need('accent-fg', 'accent', 4.5, '（标志色色块上的字）');
  need('primary-fg', 'primary', 4.5, '（主按钮上的字）');
  if (c.bg && c['fg-1'] && c['fg-2'] && c['fg-3']) {
    if (!(contrast(c['fg-1'], c.bg) > contrast(c['fg-2'], c.bg))) out.push('fg-1 要比 fg-2 醒目');
    if (!(contrast(c['fg-2'], c.bg) > contrast(c['fg-3'], c.bg))) out.push('fg-2 要比 fg-3 醒目');
  }
  for (let i = 1; i <= 10; i++) for (const g of ['bg', 'bg-1']) need(`agent-${i}`, g, 3, '（子代理颜色）');
  const agents = Array.from({ length: 10 }, (_, i) => c[`agent-${i + 1}`]?.toLowerCase()).filter(Boolean);
  if (agents.length === 10 && new Set(agents).size !== 10) out.push('agent-1 … agent-10 要十个不同的颜色');
  return out;
}
