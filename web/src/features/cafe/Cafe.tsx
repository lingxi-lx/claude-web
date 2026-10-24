// 网吧 (spec docs/superpowers/specs/2026-10-13-cafe-design.md): the canvas, the step-and-draw loop, and the layer of
// see-through buttons over the people (keyboard and screen readers reach every guest and the admin through it).
// Used by the 后台 page and, compact, by the right panel's 网吧.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BgSession } from '@shared';
import { resolveCharacter } from '@characters';
import { useStore } from '@/store';
import { Icon } from '@/ui/icons';
import { wheelZoom } from '@/ui/wheel-zoom';
import { clsx } from '@/util';
import { createWorld, step, type Actor, type World } from './sim';
import { fitView, hitTest, onPage, render, sceneSize, type View } from './render';
import { DEFAULT_RATE, estimateUsd, fee, usd, yuan } from './money';
import { AGENT_NIGHT, openLibrary, setReceipts, useCafe } from './state';
import { tokensText } from '@/features/background/model';
import { tr } from '@/i18n';

/** Frames a second at most. */
const FPS = 30;

function reducedMotion(): boolean {
  return document.documentElement.dataset.reduceMotion === '1' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

const doingText = (x: Actor): string => {
  switch (x.doing) {
    case 'work': return tr('在干活');
    case 'game': return tr('在打游戏');
    case 'activity': case 'toActivity':
      return x.activity === 'eat' ? tr('在吃泡面') : x.activity === 'drink' ? tr('在喝饮料') : x.activity === 'toilet' ? tr('上厕所') : x.activity === 'smoke' ? tr('在吸烟区') : x.activity === 'power' ? tr('在借充电宝') : x.activity === 'chat' ? tr('在聊天') : tr('在闲逛');
    case 'toDesk': case 'checkin': return tr('在开机');
    case 'toCheckout': case 'checkout': return tr('在结账');
    case 'leave': return tr('下机了');
    case 'bsod': return tr('蓝屏了');
    case 'wait': return tr('断线了，等一下');
    default: return tr('在路上');
  }
};

export function Cafe({ session, compact, onPick, onAdmin }: { session: BgSession | undefined; compact?: boolean; onPick: (agentKey: string, taskId: string) => void; onAdmin: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const can = useRef<HTMLCanvasElement>(null);
  const sid = session?.sessionId ?? '';
  const world = useRef<World | null>(null);
  const snap = useRef(session);
  snap.current = session;
  const chars = useCafe((s) => s.byId);
  const assign = useCafe((s) => s.assign);
  const rate = useStore((s) => (typeof s.settings['cafe.rate'] === 'number' ? (s.settings['cafe.rate'] as number) : DEFAULT_RATE));
  const sound = useStore((s) => s.settings['cafe.sound'] === true);
  const mainBusy = useStore((s) => !!sid && (s.open[sid]?.state === 'running' || s.open[sid]?.state === 'waiting'));
  const title = useStore((s) => s.sessions.find((x) => x.sessionId === sid)?.title ?? '');
  const look = useRef({ chars, assign, rate, mainBusy, title, sound });
  look.current = { chars, assign, rate, mainBusy, title, sound };
  /** null: fit the room; set when the user pans / zooms */
  const user = useRef<View | null>(null);
  const hover = useRef<string | undefined>(undefined);
  const [people, setPeople] = useState<{ key: string; label: string; x: number; y: number; kind: 'actor' | 'admin' }[]>([]);
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => { world.current = null; user.current = null; }, [sid]);

  useEffect(() => {
    const el = can.current, box = wrap.current;
    if (!el || !box) return;
    const ctx = el.getContext('2d');
    if (!ctx) { setBroken(true); return; }
    let raf = 0, last = 0, visible = true, lastPeople = 0, lastReceipts: unknown = null;
    let audio: AudioContext | null = null;
    let dinged = 0;
    const size = () => {
      const r = box.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (el.width !== w || el.height !== h) { el.width = w; el.height = h; }
      return { w, h, dpr };
    };
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden || t - last < 1000 / FPS) return;
      last = t;
      const now = Date.now();
      const L = look.current;
      const still = reducedMotion();
      world.current = step(world.current ?? createWorld(Math.floor(Math.random() * 1e9), now), snap.current, now, { rate: L.rate, mainBusy: L.mainBusy, reduced: still });
      const w = world.current;
      const { w: cw, h: ch, dpr } = size();
      const fit = fitView(w, cw, ch);
      const view = user.current ?? fit;
      render(ctx, cw, ch, w, view, {
        now, agentColors: AGENT_NIGHT, chars: L.chars, rate: L.rate, session: snap.current, hover: hover.current, still, mainBusy: L.mainBusy, title: L.title,
        who: (x) => resolveCharacter(L.assign, x.key === 'admin' ? { admin: true } : { type: x.type, name: x.name }, (id) => L.chars.has(id)),
      });
      if (w.receipts !== lastReceipts) { lastReceipts = w.receipts; if (sid) setReceipts(sid, w.receipts); }
      if (L.sound && w.dings.length && w.dings.at(-1)! > dinged) {
        dinged = w.dings.at(-1)!;
        try {
          audio ??= new AudioContext();
          const o = audio.createOscillator(), g = audio.createGain();
          o.frequency.value = 1568;
          g.gain.setValueAtTime(0.08, audio.currentTime);
          g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35);
          o.connect(g).connect(audio.destination);
          o.start();
          o.stop(audio.currentTime + 0.36);
        } catch { /* no audio */ }
      }
      // the see-through buttons follow the people a few times a second
      if (t - lastPeople > 200) {
        lastPeople = t;
        const sz = sceneSize(w.map);
        const list = [...w.actors.filter((x) => !x.hidden).map((x) => ({ x, kind: 'actor' as const })), { x: w.admin, kind: 'admin' as const }].map(({ x, kind }) => {
          const p = onPage(view, sz, x.u + 0.5, x.v + 0.5, 12);
          return { key: x.key, kind, x: p.x / dpr, y: p.y / dpr, label: kind === 'admin' ? tr('网管 · {v}', { v: L.mainBusy ? tr('主对话在回答') : tr('主对话空闲') }) : `${x.name} · ${doingText(x)}${x.seat ? tr(' · {padStart} 号机', { padStart: String(x.seat).padStart(2, '0') }) : ''}` };
        });
        setPeople((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
      }
    };
    raf = requestAnimationFrame(frame);
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); }) : null;
    io?.observe(box);
    return () => { cancelAnimationFrame(raf); io?.disconnect(); void audio?.close().catch(() => {}); };
  }, [sid]);

  // pan, zoom, double click to fit, hover, click
  const drag = useRef<{ x: number; y: number; v: View; moved: boolean } | null>(null);
  const dpr = () => window.devicePixelRatio || 1;
  const viewNow = (): View | null => {
    const w = world.current, el = can.current;
    return w && el ? (user.current ?? fitView(w, el.width, el.height)) : null;
  };
  const at = (e: { clientX: number; clientY: number }) => {
    const r = can.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) * dpr(), y: (e.clientY - r.top) * dpr() };
  };
  const tipFor = (key: string, kind: string): string[] => {
    const w = world.current, s = snap.current;
    if (kind === 'admin') return [tr('网管 · 主对话'), look.current.mainBusy ? tr('正在回答') : tr('空闲'), tr('点一下回到对话')];
    if (kind === 'machine') { const t = s?.tasks.find((x) => x.id === key); return [tr('包间 · 后台命令'), t?.description ?? '', t?.status === 'running' ? tr('在跑') : tr('结束了')]; }
    const x = w?.actors.find((a) => a.key === key);
    const t = s?.tasks.find((y) => y.id === x?.taskId);
    const a = t?.agents.find((y) => y.key === x?.agentKey);
    if (!x) return [];
    const ms = Math.max(0, (a?.endedAt ?? Date.now()) - (a?.startedAt ?? t?.startedAt ?? Date.now()));
    return [
      `${x.name}${x.seat ? tr(' · {padStart} 号机', { padStart: String(x.seat).padStart(2, '0') }) : ''}`,
      tr('{doingText} · 上机 {ms}:{padStart}', { doingText: doingText(x), ms: Math.floor(ms / 60000), padStart: String(Math.floor(ms / 1000) % 60).padStart(2, '0') }),
      tr('网费 {yuan}', { yuan: yuan(fee(ms, look.current.rate)) }),
      `${a?.tokens ? `${tokensText(a.tokens)} token · ` : ''}${usd(estimateUsd(a?.tokens, a?.model))}`,
      ...(a?.lastSummary ? [tr('最近：{lastSummary}', { lastSummary: a.lastSummary.length > 40 ? `${a.lastSummary.slice(0, 39)}…` : a.lastSummary })] : []),
      tr('只按输入单价估，实际会更高'),
    ];
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d) {
      const dx = (e.clientX - d.x) * dpr(), dy = (e.clientY - d.y) * dpr();
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      if (d.moved) user.current = { ...d.v, x: d.v.x + dx, y: d.v.y + dy };
      return;
    }
    const v = viewNow();
    if (!v || !world.current) return;
    const p = at(e);
    const h = hitTest(world.current, v, p.x, p.y);
    hover.current = h?.key;
    can.current!.style.cursor = h ? 'pointer' : 'grab';
    setTip(h ? { x: e.clientX, y: e.clientY, lines: tipFor(h.key, h.kind) } : null);
  };
  const choose = (key: string, kind: 'actor' | 'admin' | 'machine') => {
    if (kind === 'admin') return onAdmin();
    if (kind === 'machine') return; // a command: its card is the place to stop it
    const x = world.current?.actors.find((a) => a.key === key);
    if (x) onPick(x.agentKey, x.taskId);
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) return;
    const v = viewNow();
    if (!v || !world.current) return;
    const h = hitTest(world.current, v, at(e).x, at(e).y);
    if (h) choose(h.key, h.kind);
  };
  // the wheel zooms and the page stays put (a native non-passive listener: React's onWheel is passive, so its
  // preventDefault did nothing and the page scrolled too); at a zoom limit or with Shift the page scrolls
  const wheel = useRef<(e: WheelEvent) => void>(() => {});
  wheel.current = (e: WheelEvent) => {
    const v = viewNow();
    if (!v) return;
    const scale = wheelZoom(v.scale, e, { min: 0.25, max: 8, step: 1.25 });
    if (scale === null) return;
    e.preventDefault();
    const p = at(e);
    const f = scale / v.scale;
    user.current = { scale, x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f };
  };
  useEffect(() => {
    const c = can.current;
    if (!c) return;
    const on = (e: WheelEvent) => wheel.current(e);
    c.addEventListener('wheel', on, { passive: false });
    return () => c.removeEventListener('wheel', on);
  }, [broken]);
  const style = useMemo(() => ({}), []);
  if (broken) return null;
  return (
    <div className={clsx('cafe', compact && 'compact')} ref={wrap} style={style}>
      <canvas
        ref={can}
        className="cafe-canvas"
        aria-hidden
        onPointerDown={(e) => { const v = viewNow(); if (v) { drag.current = { x: e.clientX, y: e.clientY, v, moved: false }; (e.target as Element).setPointerCapture?.(e.pointerId); } }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => { hover.current = undefined; setTip(null); }}
        onDoubleClick={() => { user.current = null; }}
      />
      <div className="cafe-people">
        {people.map((p) => (
          <button key={p.key} className="cafe-person" style={{ left: p.x, top: p.y }} aria-label={p.label} title={p.label} tabIndex={0} onClick={() => choose(p.key, p.kind)} />
        ))}
      </div>
      <div className="cafe-tools">
        <button className="icon-btn sm" title={sound ? tr('关掉声音') : tr('打开结账的声音')} aria-label={sound ? tr('关掉声音') : tr('打开结账的声音')} onClick={() => useStore.getState().setSetting('cafe.sound', !sound)}><Icon name={sound ? 'volume' : 'volumeOff'} size={14} /></button>
        <button className="btn sm" onClick={openLibrary}><Icon name="user" size={13} /><span className="l">{tr('角色库')}</span></button>
        {!compact && <button className="icon-btn sm" title={tr('看全景（双击画面也行）')} aria-label={tr('看全景')} onClick={() => { user.current = null; }}><Icon name="zoomOut" size={14} /></button>}
      </div>
      {tip && tip.lines.length > 0 && (
        <div className="cafe-tip" style={{ left: tip.x + 14, top: tip.y + 14 }} role="tooltip">
          {tip.lines.map((l, i) => <div key={i} className={clsx(i === 0 && 'h', i === tip.lines.length - 1 && tip.lines.length > 3 && 'note')}>{l}</div>)}
        </div>
      )}
    </div>
  );
}
