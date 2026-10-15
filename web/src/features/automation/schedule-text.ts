// A scheduled task's times and period in words (redesign phase 7, review I6) — shared by the start page's
// 定时任务 list and the automation page. Pure.
import type { Schedule } from '@shared';
import { tr } from '@/i18n';

const WEEK = [tr('日'), tr('一'), tr('二'), tr('三'), tr('四'), tr('五'), tr('六')];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * When a schedule runs next: 5 分钟后 · 2 小时后 (under 3 hours, rounded down) · 今天 18:00 · 明天 09:00 · 周一 09:00
 * (within a week) · 10/6 09:00. A time already past (the server has not moved it yet) reads 1 分钟后.
 */
export function nextRunText(ts: number, now = Date.now()): string {
  const d = Math.max(0, ts - now);
  if (d < 3600_000) return tr('{Math} 分钟后', { Math: Math.max(1, Math.floor(d / 60_000)) });
  if (d < 3 * 3600_000) return tr('{d} 小时后', { d: Math.floor(d / 3600_000) });
  const t = new Date(ts);
  const days = Math.round((dayStart(t) - dayStart(new Date(now))) / 86400_000);
  if (days <= 0) return tr('今天 {hhmm}', { hhmm: hhmm(t) });
  if (days === 1) return tr('明天 {hhmm}', { hhmm: hhmm(t) });
  if (days < 7) return tr('周{v} {hhmm}', { v: WEEK[t.getDay()], hhmm: hhmm(t) });
  return `${t.getMonth() + 1}/${t.getDate()} ${hhmm(t)}`;
}

const ALIASES: Record<string, string> = { '@hourly': '0 * * * *', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@weekly': '0 0 * * 0', '@monthly': '0 0 1 * *', '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *' };

const int = (s: string, lo: number, hi: number): number | null => (/^\d+$/.test(s) && Number(s) >= lo && Number(s) <= hi ? Number(s) : null);
/** A day of the week (0–7 or a name) → 0–6. */
const dow = (s: string): number | null => {
  const i = DAY_NAMES.indexOf(s.toLowerCase());
  if (i >= 0) return i;
  const n = int(s, 0, 7);
  return n === null ? null : n % 7;
};
/** The day-of-week field as a list of days, or null when it is something else (steps, odd ranges). */
function dows(f: string): number[] | null {
  const out = new Set<number>();
  for (const part of f.split(',')) {
    const r = /^(\w+)-(\w+)$/.exec(part);
    if (r) {
      const a = dow(r[1]), b = r[2] === '7' ? 7 : dow(r[2]);
      if (a === null || b === null || a > b) return null;
      for (let x = a; x <= b; x++) out.add(x % 7);
    } else {
      const x = dow(part);
      if (x === null) return null;
      out.add(x);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * A cron expression in words: 每 30 分钟 · 每小时 · 每小时第 15 分 · 每 2 小时 · 每天 09:00 · 工作日 09:00 · 周末 10:00 ·
 * 每周一 09:00 · 每周一、三、五 09:00 · 每月 1 日 09:00. null = not one of these (the caller shows the expression).
 */
export function cronText(expr: string): string | null {
  const e = ALIASES[expr.trim().toLowerCase()] ?? expr.trim();
  const f = e.split(/\s+/);
  if (f.length !== 5) return null;
  const [mi, h, dom, mon, dw] = f;
  if (mon !== '*') return null;
  // minute / hour steps, every day
  if (dom === '*' && dw === '*') {
    if (mi === '*' && h === '*') return tr('每分钟');
    const step = /^\*\/(\d+)$/.exec(mi);
    if (step && h === '*') return tr('每 {v} 分钟', { v: Number(step[1]) });
    const m = int(mi, 0, 59);
    if (m !== null && h === '*') return m === 0 ? tr('每小时') : tr('每小时第 {m} 分', { m });
    const hs = /^\*\/(\d+)$/.exec(h);
    if (m !== null && hs) return m === 0 ? tr('每 {v} 小时', { v: Number(hs[1]) }) : tr('每 {v} 小时（第 {m} 分）', { v: Number(hs[1]), m });
  }
  const m = int(mi, 0, 59), hr = int(h, 0, 23);
  if (m === null || hr === null) return null;
  const at = `${pad(hr)}:${pad(m)}`;
  if (dom === '*' && dw === '*') return tr('每天 {at}', { at });
  if (dw === '*') {
    const d = int(dom, 1, 31);
    return d === null ? null : tr('每月 {d} 日 {at}', { d, at });
  }
  if (dom !== '*') return null;
  const days = dows(dw);
  if (!days || !days.length) return null;
  if (days.length === 7) return tr('每天 {at}', { at });
  if (days.join() === '1,2,3,4,5') return tr('工作日 {at}', { at });
  if (days.join() === '0,6') return tr('周末 {at}', { at });
  // Monday first, the way a week is read here
  const order = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  return tr('每周{map} {at}', { map: order.map((x) => WEEK[x]).join('、'), at });
}

/** A schedule's period in words, and the raw expression for a tooltip (none for an interval). */
export function scheduleText(s: Pick<Schedule, 'cron' | 'everyMinutes'>): { text: string; title?: string } {
  if (s.cron) return { text: cronText(s.cron) ?? s.cron, title: `cron：${s.cron}` };
  const m = s.everyMinutes;
  // an interval: whole hours / days read as such (每 4 小时, 每天), the rest in minutes
  if (m > 0 && m % 1440 === 0) return { text: m === 1440 ? tr('每天') : tr('每 {m} 天', { m: m / 1440 }) };
  if (m > 0 && m % 60 === 0) return { text: m === 60 ? tr('每小时') : tr('每 {m} 小时', { m: m / 60 }) };
  return { text: tr('每 {m} 分钟', { m }) };
}
