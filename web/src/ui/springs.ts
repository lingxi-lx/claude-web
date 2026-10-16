// Spring curves for CSS (spec 2026-10-16 texture §2): a damped harmonic oscillator sampled into `linear()`.
// scripts/gen-springs.ts writes springTokens() into tokens.css between the springs markers; springs.test.ts checks they agree.
export type Spring = { k: number; c: number; m: number };

export const SPRINGS = {
  bouncy: { k: 600, c: 30, m: 1 }, // switches, the segmented thumb, the send icon
  snappy: { k: 320, c: 28, m: 1 }, // menus, cards, toasts, step pops
  gentle: { k: 300, c: 36, m: 1 }, // the right panel, sheets
} satisfies Record<string, Spring>;

/** Displacement 0 → 1 at t seconds. */
export function springAt({ k, c, m }: Spring, t: number): number {
  const w0 = Math.sqrt(k / m);
  const z = c / (2 * Math.sqrt(m * k));
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
  }
  if (z === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const r = Math.sqrt(z * z - 1);
  const s1 = -w0 * (z - r);
  const s2 = -w0 * (z + r);
  return 1 - (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s2 - s1);
}

/** The first ms (rounded up to 10) after which the spring stays within eps of 1. */
export function settleMs(p: Spring, eps = 0.01): number {
  let last = 0;
  for (let ms = 0; ms <= 3000; ms++) if (Math.abs(1 - springAt(p, ms / 1000)) >= eps) last = ms;
  return Math.ceil((last + 1) / 10) * 10;
}

export function springCurve(p: Spring, points = 40): { linear: string; ms: number; peak: number } {
  const ms = settleMs(p);
  const ys: string[] = [];
  for (let i = 0; i <= points; i++) {
    ys.push(i === 0 ? '0' : i === points ? '1' : String(Math.round(springAt(p, (ms / 1000) * (i / points)) * 1000) / 1000));
  }
  let peak = 0;
  for (let t = 0; t <= ms; t++) peak = Math.max(peak, springAt(p, t / 1000));
  return { linear: `linear(${ys.join(', ')})`, ms, peak };
}

const FALLBACK: Record<keyof typeof SPRINGS, string> = {
  bouncy: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
  snappy: 'cubic-bezier(0.23, 1, 0.32, 1)',
  gentle: 'cubic-bezier(0.32, 0.72, 0, 1)',
};

/** The block between the springs markers in tokens.css: cubic-bezier fallbacks, then linear() where supported. */
export function springTokens(): string {
  const names = Object.keys(SPRINGS) as (keyof typeof SPRINGS)[];
  const base = names.map((n) => `  --spring-${n}: ${FALLBACK[n]};\n  --spring-${n}-dur: ${springCurve(SPRINGS[n]).ms}ms;`).join('\n');
  const lin = names.map((n) => `    --spring-${n}: ${springCurve(SPRINGS[n]).linear};`).join('\n');
  return `\n:root {\n${base}\n}\n@supports (transition-timing-function: linear(0, 1)) {\n  :root {\n${lin}\n  }\n}\n`;
}
