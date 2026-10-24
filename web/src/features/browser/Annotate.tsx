// 标注 (the official desktop app's toolbar at the foot of its browser): pick elements on the page, draw over it with a
// pen, boxes and words, then 「发给 Claude」 — one attachment 「页面标注 · N 处」 in the conversation's input box: a
// picture of the page with the marks on it, and words that say what was picked (annotate-model.ts).
//
// The drawing is a transparent canvas laid exactly over the page as it is shown (a device's page is scaled down —
// the canvas takes the page element's box as drawn). Marks are kept as fractions of that box, so they stay put when
// the panel is resized and land on the same spot in the picture, whatever its size. Picked elements are boxed by the
// page itself (page-agent.js `pick`), so the picture has them where they are.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '@/store';
import { desktop } from '@/desktop';
import { clsx } from '@/util';
import { Icon } from '@/ui/icons';
import { imeComposing } from '@/ui/ime';
import { dlg } from '@/ui/dialog';
import { tr } from '@/i18n';
import { annotationCount, annotationName, annotationNote, keepMark, rectBetween, type Mark, type PickedEl } from './annotate-model';
import { pickIn, stopPicking } from './guest';
import { guestElOf, guestOf, hasWebview, type BrowserTab } from './state';

export type AnnotateTool = 'pick' | 'pen' | 'rect' | 'text';

const INK = '#e5484d';

/** Draw the marks on a canvas of `w` × `h` pixels; `k`: how many of its pixels one pixel on screen is. */
function drawMarks(ctx: CanvasRenderingContext2D, marks: readonly Mark[], w: number, h: number, k: number) {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 3 * k;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const m of marks) {
    if (m.kind === 'pen') {
      ctx.beginPath();
      m.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
      if (m.points.length === 1) ctx.lineTo(m.points[0][0] * w + 0.1, m.points[0][1] * h);
      ctx.stroke();
    } else if (m.kind === 'rect') {
      ctx.strokeRect(m.x * w, m.y * h, m.w * w, m.h * h);
    } else {
      ctx.font = `600 ${Math.round(15 * k)}px system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.lineWidth = 4 * k;
      ctx.strokeStyle = '#fff';
      ctx.strokeText(m.text, m.x * w, m.y * h);
      ctx.fillText(m.text, m.x * w, m.y * h);
      ctx.lineWidth = 3 * k;
      ctx.strokeStyle = INK;
    }
  }
  ctx.restore();
}

/** The picture of the page with the marks drawn on it, as a data URL (PNG; JPEG if the PNG would be too big to send). */
async function composite(shot: { mime: string; data: string }, marks: readonly Mark[], shownWidth: number): Promise<string> {
  const img = new Image();
  img.src = `data:${shot.mime};base64,${shot.data}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(img, 0, 0);
  drawMarks(ctx, marks, c.width, c.height, c.width / Math.max(1, shownWidth));
  const png = c.toDataURL('image/png');
  // a model takes images up to 5 MB: base64 of ~3.7 MB
  return png.length < 5_000_000 ? png : c.toDataURL('image/jpeg', 0.9);
}

/** The page element of a tab (its <webview>, or the web app's <iframe>). */
function pageEl(layer: HTMLElement | null, tabId: string): HTMLElement | null {
  return guestElOf(tabId) ?? layer?.parentElement?.querySelector<HTMLElement>(`.bw-view[data-tab="${CSS.escape(tabId)}"] iframe`) ?? null;
}

const NO_BOX = { x: 0, y: 0, w: 0, h: 0 };

/**
 * The toolbar and the canvas for one tab's page. Stays mounted while the user looks at another tab (`front` false:
 * hidden) — the marks are kept; closing asks first when there are any.
 */
export function Annotate({ tab, front, start, startKey, onCount, onClose }: { tab: BrowserTab; front: boolean; start: AnnotateTool; startKey: number; onCount: (n: number) => void; onClose: () => void }) {
  const live = hasWebview() && !!tab.src;
  const [tool, setTool] = useState<AnnotateTool | null>(live || start !== 'pick' ? start : 'pen');
  const [marks, setMarks] = useState<Mark[]>([]);
  const [picked, setPicked] = useState<PickedEl[]>([]);
  const [draft, setDraft] = useState<Mark | null>(null);
  const [typing, setTyping] = useState<{ x: number; y: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [box, setBox] = useState(NO_BOX);
  const layer = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const origin = useRef<[number, number] | null>(null);
  const pickedN = useRef(0);
  pickedN.current = picked.length;
  const count = annotationCount(picked, marks);
  useEffect(() => onCount(count), [count]); // eslint-disable-line react-hooks/exhaustive-deps

  // the address bar's button pressed again: its tool
  const firstKey = useRef(startKey);
  useEffect(() => {
    if (startKey === firstKey.current) return;
    setTool(live || start !== 'pick' ? start : 'pen');
  }, [startKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // where the page is drawn inside the panel's body (a device's page: centred and scaled)
  const measure = useCallback(() => {
    const host = layer.current, el = pageEl(layer.current, tab.id);
    if (!host || !el) return;
    const a = host.getBoundingClientRect(), b = el.getBoundingClientRect();
    const next = { x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height };
    setBox((cur) => (Math.abs(cur.x - next.x) < 0.5 && Math.abs(cur.y - next.y) < 0.5 && Math.abs(cur.w - next.w) < 0.5 && Math.abs(cur.h - next.h) < 0.5 ? cur : next));
  }, [tab.id]);
  useLayoutEffect(() => {
    if (!front) return;
    measure();
    const host = layer.current, el = pageEl(layer.current, tab.id);
    const ro = new ResizeObserver(measure);
    if (host) ro.observe(host);
    if (el) ro.observe(el);
    // a device's scale is a style change, which no observer sees: once more after it is laid out
    const raf = requestAnimationFrame(measure);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [front, measure, tab.id, tab.viewport, tab.src]);

  // the canvas follows its box and the marks
  useEffect(() => {
    const c = canvas.current;
    if (!c || !box.w || !box.h) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(box.w * dpr), H = Math.round(box.h * dpr);
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    drawMarks(ctx, draft ? [...marks, draft] : marks, W, H, dpr);
  }, [box, marks, draft]);

  // 选元素: one pick after another in the page until another tool (or Esc); a new page starts over (its boxes are gone)
  const [pageGen, setPageGen] = useState(0);
  useEffect(() => {
    const el = guestElOf(tab.id);
    if (!el || !live) return;
    const onNav = () => { setPicked([]); setPageGen((g) => g + 1); };
    el.addEventListener('did-navigate', onNav);
    return () => el.removeEventListener('did-navigate', onNav);
  }, [tab.id, live]);
  useEffect(() => {
    if (tool !== 'pick' || !live || !front) return;
    let alive = true;
    void (async () => {
      while (alive) {
        const r = await pickIn(tab.id, pickedN.current + 1);
        if (!alive || !r) return;
        if ('cancel' in r) { setTool(null); return; }
        pickedN.current += 1;
        setPicked((p) => [...p, r]);
      }
    })();
    return () => { alive = false; void stopPicking(tab.id, false); };
  }, [tool, live, front, tab.id, pageGen]);

  // the page's boxes go when this does (sent, closed, the tab closed)
  useEffect(() => () => { void stopPicking(tab.id, true); }, [tab.id]);

  const at = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))), Math.min(1, Math.max(0, (e.clientY - r.top) / Math.max(1, r.height)))];
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || !tool || tool === 'pick') return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    const p = at(e);
    if (tool === 'text') { commitText(); const t = { x: p[0], y: p[1], text: '' }; typingRef.current = t; setTyping(t); return; }
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a pointer that is not down any more */ }
    origin.current = p;
    setDraft(tool === 'pen' ? { kind: 'pen', points: [p] } : rectBetween(p, p));
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const o = origin.current;
    if (!o || !draft) return;
    const p = at(e);
    if (draft.kind === 'pen') {
      const last = draft.points[draft.points.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.002) setDraft({ kind: 'pen', points: [...draft.points, p] });
    } else if (draft.kind === 'rect') setDraft(rectBetween(o, p));
  };
  const onUp = () => {
    if (!origin.current) return;
    origin.current = null;
    if (draft && keepMark(draft)) setMarks((m) => [...m, draft]);
    setDraft(null);
  };
  // the words being typed: Enter, a click elsewhere, another tool or the field losing the focus puts them on the page
  // (once — the blur that follows an Enter finds nothing left)
  const typingRef = useRef(typing);
  typingRef.current = typing;
  const commitText = () => {
    const t = typingRef.current;
    if (!t) return;
    typingRef.current = null;
    setTyping(null);
    if (t.text.trim()) setMarks((m) => [...m, { kind: 'text', x: t.x, y: t.y, text: t.text.trim().slice(0, 300) }]);
  };

  const close = async () => {
    if (count && !(await dlg.confirm(tr('丢掉标注？'), { message: tr('选中的元素和画的标注都会清掉。'), okLabel: tr('丢掉'), danger: true, focusCancel: true }))) return;
    void stopPicking(tab.id, true);
    onClose();
  };

  const undo = () => {
    if (marks.length) setMarks((m) => m.slice(0, -1));
  };

  /** 发给 Claude: the picture with the marks, and the words, as one attachment in the conversation's input box. */
  const send = async () => {
    const st = useStore.getState();
    if (!count) return st.toast(tr('还没有标注：选一个元素，或者在页面上画一下'));
    // the conversation whose Agent works in this tab, else the one in front
    const target = tab.agent && st.open[tab.agent] ? tab.agent : st.activeId;
    if (!target || !st.open[target]) return st.toast(tr('先打开一个对话，再把页面发给它'));
    const el = guestOf(tab.id);
    if (!el || !desktop?.captureGuest) return st.toast(tr('截图需要桌面版'));
    setBusy(true);
    try {
      // the box that follows the pointer is not part of the picture (the numbered ones are)
      await stopPicking(tab.id, false);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const shot = await desktop.captureGuest(el.getWebContentsId()).catch(() => null);
      if (!shot?.data) { st.toast(tr('这个页面现在截不了图。')); return; }
      const url = await composite(shot, marks, box.w || shot.width || 1);
      const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
      if (!m) { st.toast(tr('这个页面现在截不了图。')); return; }
      const name = annotationName(count);
      st.addComposerAttachment(target, { id: `pa${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, image: { mediaType: m[1], data: m[2], url, name }, text: annotationNote(tab.url, picked, marks) });
      // the conversation's box shows it: bring that conversation to the front if it is not (as 看对话 does)
      if (target !== st.activeId) void st.loadHistory(target);
      st.toast(tr('「{name}」已放进输入框', { name }), true);
      void stopPicking(tab.id, true);
      onClose();
    } catch {
      st.toast(tr('这个页面现在截不了图。'));
    } finally {
      setBusy(false);
    }
  };

  const drawing = !!tool && tool !== 'pick';
  const toolBtn = (id: AnnotateTool, icon: Parameters<typeof Icon>[0]['name'], label: string, disabled = false) => (
    <button type="button" className={clsx('icon-btn xs', tool === id && 'on')} data-act={`ann-${id}`} aria-pressed={tool === id} disabled={disabled || busy} title={label} aria-label={label}
      onClick={() => { commitText(); setTool(tool === id ? null : id); }}>
      <Icon name={icon} size={15} />
    </button>
  );
  return (
    <div ref={layer} className={clsx('bw-ann', drawing && 'drawing')} data-id="annotate" data-tool={tool ?? undefined} hidden={!front}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || imeComposing(e.nativeEvent)) return;
        e.stopPropagation();
        if (tool) setTool(null);
        else void close();
      }}>
      <canvas ref={canvas} tabIndex={-1} aria-label={tr('标注画布')} style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      {typing && (
        <input className="bw-ann-text" autoFocus value={typing.text} placeholder={tr('写点什么')} aria-label={tr('标注文字')} data-id="annotate-text"
          style={{ left: box.x + typing.x * box.w, top: box.y + typing.y * box.h }}
          onChange={(e) => { const text = e.target.value; setTyping((t) => (t ? { ...t, text } : t)); }}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (imeComposing(e.nativeEvent)) return;
            if (e.key === 'Enter') { e.preventDefault(); commitText(); canvas.current?.focus({ preventScroll: true }); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); typingRef.current = null; setTyping(null); canvas.current?.focus({ preventScroll: true }); }
          }} />
      )}
      <div className="bw-ann-bar" role="toolbar" aria-label={tr('标注')}>
        {toolBtn('pick', 'pick', live ? tr('选元素：点页面上的一个元素') : tr('选元素需要桌面版'), !live)}
        {toolBtn('pen', 'pen', tr('画笔'))}
        {toolBtn('rect', 'frame', tr('框'))}
        {toolBtn('text', 'text', tr('文字'))}
        <button type="button" className="icon-btn xs" data-act="ann-undo" disabled={!marks.length || busy} title={tr('撤销上一笔')} aria-label={tr('撤销上一笔')} onClick={undo}><Icon name="undo" size={15} /></button>
        <span className="sep" aria-hidden />
        <span className="cnt" data-id="annotate-count">{tr('{n} 处', { n: count })}</span>
        <button type="button" className="btn sm primary" data-act="ann-send" disabled={!count || busy} onClick={() => void send()}>
          {busy ? <span className="spinner" /> : <Icon name="send" size={13} />} {tr('发给 Claude')}
        </button>
        <button type="button" className="icon-btn xs" data-act="ann-close" disabled={busy} title={tr('关闭标注')} aria-label={tr('关闭标注')} onClick={() => void close()}><Icon name="close" size={15} /></button>
      </div>
    </div>
  );
}
