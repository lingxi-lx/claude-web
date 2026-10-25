// Runs INSIDE a page of the built-in browser (injected as text before each operation an Agent asks for — see ops.ts;
// imported with `?raw`, never bundled as code). Plain script, no imports, idempotent: it installs `window.__cwAgent`
// once per document.
//
// What it gives back is the page's own content — the server marks it as untrusted before a model sees it. Everything
// returned is plain JSON.
(() => {
  if (window.__cwAgent && window.__cwAgent.v === 5) return;
  // an older copy (a page that was open when the app updated): its pick layer goes with it
  if (window.__cwAgent && typeof window.__cwAgent.unpick === 'function') { try { window.__cwAgent.unpick(); } catch (e) { /* gone */ } }

  /** ref → element (weakly: a removed element's ref just stops resolving), element → ref (stable while it lives). */
  const byRef = new Map();
  const refOf = new WeakMap();
  let seq = 0;
  // Every document has its own three letters in front of its refs (`kqz12`): a ref the model kept from the page
  // before must not point at whatever happens to be number 12 on this one.
  const TAG = (() => {
    let n = Math.floor(Math.random() * 17576);
    let s = '';
    for (let i = 0; i < 3; i++) { s += String.fromCharCode(97 + (n % 26)); n = Math.floor(n / 26); }
    return s;
  })();

  const SEL = [
    'a[href]', 'button', 'input:not([type="hidden"])', 'textarea', 'select', 'summary',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]', '[role="option"]', '[role="checkbox"]',
    '[role="radio"]', '[role="switch"]', '[role="combobox"]', '[role="textbox"]', '[role="searchbox"]',
    '[contenteditable=""]', '[contenteditable="true"]', '[onclick]',
  ].join(',');
  const MAX_ELEMENTS = 600;
  const MAX_TEXT = 2000000;

  const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);

  function shown(el) {
    if (!el.isConnected) return false;
    if (typeof el.checkVisibility === 'function') {
      try { return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }); } catch (e) { /* older signature */ }
    }
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function roleOf(el) {
    const r = el.getAttribute('role');
    if (r) return r;
    const t = el.tagName.toLowerCase();
    if (t === 'a') return 'link';
    if (t === 'summary') return 'button';
    if (t === 'input') {
      const ty = (el.getAttribute('type') || 'text').toLowerCase();
      if (ty === 'submit' || ty === 'button' || ty === 'reset' || ty === 'image') return 'button';
      if (ty === 'checkbox' || ty === 'radio') return ty;
      return 'input';
    }
    if (t !== 'textarea' && t !== 'select' && t !== 'button' && el.isContentEditable) return 'textbox';
    return t;
  }

  function labelText(el) {
    try {
      if (el.labels && el.labels.length) return el.labels[0].innerText;
      const by = el.getAttribute('aria-labelledby');
      if (by) return by.split(/\s+/).map((id) => { const n = document.getElementById(id); return n ? n.innerText : ''; }).join(' ');
    } catch (e) { /* no label */ }
    return '';
  }

  function nameOf(el) {
    const t = el.tagName;
    const field = t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT';
    const img = el.querySelector ? el.querySelector('img[alt], svg[aria-label]') : null;
    return clean(
      el.getAttribute('aria-label') || labelText(el)
      || (field ? el.getAttribute('placeholder') || el.getAttribute('name') : el.innerText || el.textContent)
      || el.getAttribute('title') || (img ? img.getAttribute('alt') || img.getAttribute('aria-label') : '')
      || (t === 'INPUT' && roleOf(el) === 'button' ? el.value : '') || (t === 'A' ? el.getAttribute('href') : ''),
      160,
    );
  }

  function valueOf(el) {
    const t = el.tagName;
    if (t === 'INPUT') {
      const ty = (el.getAttribute('type') || 'text').toLowerCase();
      if (ty === 'checkbox' || ty === 'radio') return el.checked ? 'checked' : 'unchecked';
      if (ty === 'password') return el.value ? '(hidden)' : '';
      if (ty === 'submit' || ty === 'button' || ty === 'reset' || ty === 'image' || ty === 'file') return undefined;
      return clean(el.value, 120);
    }
    if (t === 'TEXTAREA') return clean(el.value, 120);
    if (t === 'SELECT') return clean(el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].text : el.value, 120);
    const ch = el.getAttribute('aria-checked') || el.getAttribute('aria-selected') || el.getAttribute('aria-expanded');
    if (ch === 'true') return el.hasAttribute('aria-expanded') ? 'expanded' : 'checked';
    return undefined;
  }

  function describe(el) {
    let ref = refOf.get(el);
    if (!ref) {
      ref = TAG + (++seq);
      refOf.set(el, ref);
      byRef.set(ref, new WeakRef(el));
    }
    const out = { ref, role: roleOf(el), name: nameOf(el) };
    const v = valueOf(el);
    if (v !== undefined && v !== '') out.value = v;
    if (el.tagName === 'A') {
      const h = el.href;
      if (typeof h === 'string' && /^https?:/i.test(h)) out.href = h.slice(0, 400);
    }
    return out;
  }

  function elements() {
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll(SEL)) {
      if (out.length >= MAX_ELEMENTS) break;
      if (seen.has(el) || el.disabled || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('aria-hidden') === 'true') continue;
      if (!shown(el)) continue;
      const d = describe(el);
      // a thing with no name says nothing to a reader — except a field, which is still somewhere to type
      if (!d.name && d.role !== 'input' && d.role !== 'textarea' && d.role !== 'textbox' && d.role !== 'select') continue;
      seen.add(el);
      out.push(d);
    }
    return out;
  }

  function fullText() {
    const raw = document.body ? document.body.innerText : (document.documentElement ? document.documentElement.textContent : '') || '';
    return String(raw).replace(/\r/g, '').replace(/[ \t\f\v\u00a0]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT);
  }

  const where = () => ({ url: location.href, title: clean(document.title, 300) });

  function get(ref) {
    const key = String(ref == null ? '' : ref).trim().replace(/^\[|\]$/g, '');
    const w = byRef.get(key) || byRef.get(TAG + key);
    const el = w ? w.deref() : null;
    if (!el || !el.isConnected) throw new Error('元素 [' + key + '] 不在页面上了（页面变过）。用 browser_read 或 browser_find 重新看一下现在有什么。');
    return el;
  }

  function fire(el, type, init) {
    const r = el.getBoundingClientRect();
    const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    const Ctor = type.indexOf('pointer') === 0 && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, Object.assign(base, init || {})));
  }

  function setValue(el, text) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (d && d.set) d.set.call(el, text); else el.value = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: text, inputType: 'insertText' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** The element that scrolls the page: the document, or — on app-like pages — the biggest scrolling box. */
  function scroller() {
    const doc = document.scrollingElement || document.documentElement;
    if (doc.scrollHeight > doc.clientHeight + 40) return doc;
    let best = null;
    let area = 0;
    for (const el of document.querySelectorAll('main, [role="main"], div, section, article')) {
      if (el.scrollHeight <= el.clientHeight + 40) continue;
      const oy = getComputedStyle(el).overflowY;
      if (oy !== 'auto' && oy !== 'scroll') continue;
      const a = el.clientWidth * el.clientHeight;
      if (a > area) { area = a; best = el; }
    }
    return best || doc;
  }

  // A search engine's result page, read generically: every engine lists its results as links that are headings
  // (or hold one). What an engine wraps its links in, which links are its own, what its challenge page looks like —
  // that is judged by the server (engines/pages.ts), which gets the list as the page had it.
  const HEAD_LINKS = 'h1 a[href], h2 a[href], h3 a[href], h4 a[href], a[href] h1, a[href] h2, a[href] h3, a[href] h4, [role="heading"] a[href], a[href] [role="heading"]';
  const MAX_CANDIDATES = 60;

  function candidates() {
    const out = [];
    const seen = new Set();
    for (const n of document.querySelectorAll(HEAD_LINKS)) {
      if (out.length >= MAX_CANDIDATES) break;
      const a = n.closest('a[href]');
      if (!a || seen.has(a)) continue;
      seen.add(a);
      if (!/^https?:/i.test(a.href || '') || !shown(a)) continue;
      const head = a.querySelector('h1,h2,h3,h4,[role="heading"]') || a.closest('h1,h2,h3,h4,[role="heading"]') || a;
      const title = clean(head.innerText || head.textContent, 300);
      if (!title) continue;
      // the result's block: as far up as the link is still the only heading link in it
      let box = a;
      for (let p = a.parentElement, i = 0; p && p !== document.body && i < 8; p = p.parentElement, i++) {
        if (p.querySelectorAll(HEAD_LINKS).length > 1) break;
        box = p;
      }
      const c = { title, href: a.href, snippet: clean(box.innerText, 900) };
      // an engine that wraps its links may keep the real address beside it (Baidu's `mu`)
      const kept = a.closest('[mu]');
      const alt = (kept && kept.getAttribute('mu')) || a.getAttribute('data-mdurl') || a.getAttribute('data-landurl') || '';
      if (alt) c.alt = alt.slice(0, 2000);
      out.push(c);
    }
    return out;
  }

  // ---- 标注 · 选元素 (Annotate.tsx): the user points at an element and clicks it ----
  // One layer of our own over the page, in a closed shadow root (the page's styles cannot reach it, its scripts cannot
  // read it): the box that follows the pointer, and a numbered box on each element picked so far — those are drawn by
  // the page, so the screenshot sent with them has them where the elements are.
  const ACCENT = '#d97757';
  const MAX_HTML_BYTES = 2048;
  let layer = null;
  let picking = null;

  function pickLayer() {
    if (layer && layer.host.isConnected) return layer;
    const host = document.createElement('cw-annotate');
    host.style.cssText = 'all:initial;position:absolute;left:0;top:0;width:0;height:0;overflow:visible;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'closed' });
    const hover = document.createElement('div');
    hover.style.cssText = 'position:fixed;display:none;box-sizing:border-box;pointer-events:none;border:2px solid ' + ACCENT + ';background:rgba(217,119,87,0.14);border-radius:2px;';
    root.appendChild(hover);
    document.documentElement.appendChild(host);
    layer = { host, root, hover };
    return layer;
  }

  function cssPath(el) {
    const parts = [];
    const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&'));
    for (let n = el; n && n.nodeType === 1 && parts.length < 6; n = n.parentElement) {
      const tag = n.tagName.toLowerCase();
      if (n.id) {
        const id = '#' + esc(n.id);
        let unique = false;
        try { unique = document.querySelectorAll(id).length === 1; } catch (e) { /* odd id */ }
        if (unique) { parts.unshift(id); break; }
      }
      if (tag === 'html' || tag === 'body') { parts.unshift(tag); break; }
      let part = tag;
      const cls = Array.from(n.classList || []).filter((c) => c.length <= 40).slice(0, 2);
      if (cls.length) part += '.' + cls.map(esc).join('.');
      const p = n.parentElement;
      if (p) {
        const same = Array.from(p.children).filter((c) => c.tagName === n.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(n) + 1) + ')';
      }
      parts.unshift(part);
    }
    return parts.join(' > ');
  }

  function clipBytes(s, max) {
    const enc = new TextEncoder();
    if (enc.encode(s).length <= max) return s;
    let used = 0;
    let out = '';
    for (const ch of s) {
      const b = enc.encode(ch).length;
      if (used + b > max - 3) break;
      used += b;
      out += ch;
    }
    return out + '…';
  }

  function pickedInfo(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const font = cs.font || [cs.fontStyle, cs.fontWeight, cs.fontSize, cs.fontFamily].filter(Boolean).join(' ');
    return {
      selector: cssPath(el),
      html: clipBytes(el.outerHTML || '', MAX_HTML_BYTES),
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      styles: { width: Math.round(r.width) + 'px', height: Math.round(r.height) + 'px', color: cs.color, background: cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundColor + ' ' + cs.backgroundImage.slice(0, 200) : cs.backgroundColor, font: font.slice(0, 200) },
    };
  }

  /** A numbered box on a picked element, in page coordinates (it scrolls with the page). */
  function markPicked(rect, n) {
    const L = pickLayer();
    const box = document.createElement('div');
    const x = rect.x + window.scrollX, y = rect.y + window.scrollY;
    box.style.cssText = 'position:absolute;box-sizing:border-box;pointer-events:none;border:2px solid ' + ACCENT + ';border-radius:2px;left:' + x + 'px;top:' + y + 'px;width:' + Math.max(rect.w, 4) + 'px;height:' + Math.max(rect.h, 4) + 'px;';
    const tag = document.createElement('span');
    tag.textContent = String(n);
    tag.style.cssText = 'position:absolute;left:-2px;top:-20px;min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;border-radius:9px;background:' + ACCENT + ';color:#fff;font:600 11px/18px system-ui,sans-serif;text-align:center;';
    if (y < 20) tag.style.top = '0px';
    box.appendChild(tag);
    L.root.appendChild(box);
  }

  function endPick(value) {
    const p = picking;
    if (!p) return;
    picking = null;
    for (const [type, fn] of p.listeners) window.removeEventListener(type, fn, true);
    if (layer) layer.hover.style.display = 'none';
    p.resolve(value);
  }

  /** The element under the pointer that is the page's (never our own layer). */
  const pageTarget = (e) => {
    const t = e.target;
    return t && t.nodeType === 1 && t !== document.documentElement && (!layer || t !== layer.host) ? t : null;
  };

  window.__cwAgent = {
    v: 5,

    /**
     * browser_wait: is the text on the page (case-insensitive), is the element shown — both, when both are asked.
     * `missing`: the ref is not on this page (any more), so waiting for it is pointless.
     */
    has(o) {
      const text = String((o && o.text) || '').trim().toLowerCase();
      const key = String((o && o.ref) || '').trim().replace(/^\[|\]$/g, '');
      let found = true;
      if (key) {
        const w = byRef.get(key) || byRef.get(TAG + key);
        const el = w ? w.deref() : null;
        if (!el || !el.isConnected) return { found: false, missing: true };
        found = shown(el);
      }
      if (found && text) found = fullText().toLowerCase().indexOf(text) >= 0;
      return { found };
    },

    /** browser_snapshot (the shell's accessibility outline asks for each element it lists): the element's ref, given one if it has none yet. */
    refFor(el) {
      return el && el.nodeType === 1 ? describe(el).ref : '';
    },

    /**
     * 选元素: the element under the pointer is outlined; a click picks it (the page never sees that click) and it
     * keeps a box numbered `n`. Resolves with the element's description, `{ cancel: 'esc' }` on Esc, or null when
     * `pickStop` ends it first. `still`: the page is not scrolled meanwhile (wheel, scroll keys).
     */
    pick(o) {
      endPick(null);
      const n = Math.max(1, Math.floor((o && o.n) || 1));
      const L = pickLayer();
      return new Promise((resolve) => {
        const swallow = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
        const move = (e) => {
          const t = pageTarget(e);
          if (!t) { L.hover.style.display = 'none'; return; }
          const r = t.getBoundingClientRect();
          Object.assign(L.hover.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
        };
        const click = (e) => {
          swallow(e);
          if (e.button !== 0) return;
          const t = pageTarget(e);
          if (!t) return;
          const info = pickedInfo(t);
          markPicked(info.rect, n);
          endPick(info);
        };
        const SCROLL_KEYS = [' ', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
        const key = (e) => {
          if (e.key === 'Escape' && !e.isComposing) { swallow(e); endPick({ cancel: 'esc' }); return; }
          if (o && o.still && SCROLL_KEYS.indexOf(e.key) >= 0) swallow(e);
        };
        const listeners = [['pointermove', move], ['mouseover', move], ['click', click], ['keydown', key]];
        // `still` (the user has drawn marks over the page): it does not scroll while picking — the marks would be left beside what they marked
        if (o && o.still) for (const t of ['wheel', 'touchmove']) listeners.push([t, swallow]);
        for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'auxclick', 'contextmenu', 'touchstart']) listeners.push([t, swallow]);
        for (const [type, fn] of listeners) window.addEventListener(type, fn, { capture: true, passive: false });
        picking = { resolve, listeners };
      });
    },

    /** 撤销 of a pick: its numbered box (the last one) comes off the page. */
    unpickLast() {
      if (!layer) return false;
      const boxes = [...layer.root.children].filter((c) => c !== layer.hover);
      const last = boxes[boxes.length - 1];
      if (last) last.remove();
      return !!last;
    },

    /** Stop picking (the picked boxes stay). */
    pickStop() { endPick(null); return true; },

    /** Stop picking and take every box of ours off the page. */
    unpick() {
      endPick(null);
      if (layer) { layer.host.remove(); layer = null; }
      return true;
    },

    /** A search engine's result page: where it is, how it starts, and the links it lists. */
    results() {
      return { url: location.href, title: clean(document.title, 300), text: clean(document.body ? document.body.innerText : '', 3000), candidates: candidates() };
    },

    /** The page's own size, in its own pixels: what a position in a picture of it is scaled to. */
    view() {
      return { width: window.innerWidth || document.documentElement.clientWidth || 0, height: window.innerHeight || document.documentElement.clientHeight || 0 };
    },

    /** The page as text from `offset`, at most `maxChars`; the things to act on go with the start of the page. */
    read(o) {
      const offset = Math.max(0, Math.floor((o && o.offset) || 0));
      const max = Math.max(200, Math.floor((o && o.maxChars) || 12000));
      const all = fullText();
      const from = Math.min(offset, all.length);
      const text = all.slice(from, from + max);
      const page = Object.assign(where(), { text });
      if (from + text.length < all.length) { page.truncated = true; page.nextOffset = from + text.length; }
      if (from === 0) page.elements = elements();
      return { page, length: all.length };
    },

    /** Things to act on whose name / value / address has the words, and where the words occur in the text. */
    find(o) {
      const q = clean(o && o.query, 200).toLowerCase();
      if (!q) throw new Error('browser_find 需要参数 query');
      const hits = elements().filter((e) => e.name.toLowerCase().includes(q) || (e.value || '').toLowerCase().includes(q) || (e.href || '').toLowerCase().includes(q)).slice(0, 40);
      const all = fullText();
      const lower = all.toLowerCase();
      const spots = [];
      for (let at = lower.indexOf(q); at >= 0 && spots.length < 8; at = lower.indexOf(q, at + q.length)) {
        const from = Math.max(0, at - 80);
        const to = Math.min(all.length, at + q.length + 120);
        spots.push('第 ' + at + ' 个字符附近：' + (from > 0 ? '…' : '') + all.slice(from, to).replace(/\s+/g, ' ') + (to < all.length ? '…' : ''));
      }
      const out = { page: Object.assign(where(), { text: '' }), elements: hits };
      if (spots.length) out.note = spots.join('\n') + '\n（读某一处的上下文：browser_read {"offset": 那个位置}）';
      return out;
    },

    click(o) {
      const el = get(o && o.ref);
      try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) { /* not scrollable into view */ }
      // a link that would open another window opens here instead: the Agent has this one tab
      const link = el.closest ? el.closest('a[target]') : null;
      if (link && link.target && link.target !== '_self') link.target = '_self';
      try { if (typeof el.focus === 'function') el.focus({ preventScroll: true }); } catch (e) { /* not focusable */ }
      fire(el, 'pointerover'); fire(el, 'pointerdown'); fire(el, 'mousedown'); fire(el, 'pointerup'); fire(el, 'mouseup');
      el.click();
      return {};
    },

    /** Put `text` into a field (replacing what is there). `submit`: send the form — `enter: true` when the caller should press Enter instead. */
    type(o) {
      const el = get(o && o.ref);
      const text = String(o && o.text != null ? o.text : '');
      const t = el.tagName;
      try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* fine */ }
      try { el.focus({ preventScroll: true }); } catch (e) { /* fine */ }
      if (t === 'SELECT') {
        const want = text.trim().toLowerCase();
        const opt = Array.from(el.options).find((x) => x.text.trim().toLowerCase() === want || x.value.toLowerCase() === want) || Array.from(el.options).find((x) => x.text.toLowerCase().includes(want));
        // (the options themselves are the page's words: they are read with browser_read, not put into an error)
        if (!opt) throw new Error('这个下拉框里没有这一项。先用 browser_click 点开它，或者用 browser_find 找到要选的那一项。');
        el.value = opt.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (t === 'INPUT' || t === 'TEXTAREA') {
        const ty = (el.getAttribute('type') || 'text').toLowerCase();
        if (ty === 'checkbox' || ty === 'radio' || ty === 'file' || ty === 'submit' || ty === 'button') throw new Error('[' + refOf.get(el) + '] 不是能输入文字的地方（' + ty + '）：用 browser_click。');
        setValue(el, text);
      } else if (el.isContentEditable) {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
        if (!document.execCommand('insertText', false, text)) el.textContent = text;
      } else {
        throw new Error('[' + refOf.get(el) + '] 不是能输入文字的地方：先用 browser_click 点开它，再找输入框。');
      }
      const out = {};
      if (o && o.submit) {
        const form = el.form || (el.closest ? el.closest('form') : null);
        if (form && t !== 'TEXTAREA') {
          if (typeof form.requestSubmit === 'function') form.requestSubmit(); else form.submit();
          out.submitted = true;
        } else {
          out.enter = true;
        }
      }
      return out;
    },

    scroll(o) {
      const el = scroller();
      const view = el === document.scrollingElement || el === document.documentElement ? (window.innerHeight || 700) : (el.clientHeight || 700);
      const by = Math.round(view * 0.85) * Math.max(1, Math.min(20, Math.floor((o && o.amount) || 1))) * (o && o.direction === 'up' ? -1 : 1);
      const before = el.scrollTop;
      el.scrollTop = before + by;
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      return { moved: Math.round(el.scrollTop - before), top: Math.round(el.scrollTop), max: Math.round(max), length: fullText().length };
    },

    /**
     * Where an element is on screen, for a real mouse (hover / drag) and the visible cursor: brought into view, then the
     * middle of its box (the part inside the window) in the page's own pixels, and the window's size.
     */
    point(o) {
      const el = get(o && o.ref);
      if (!(o && o.noScroll)) { try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) { /* fine */ } }
      const r = el.getBoundingClientRect();
      const w = window.innerWidth || document.documentElement.clientWidth || 0;
      const h = window.innerHeight || document.documentElement.clientHeight || 0;
      const left = Math.max(0, r.left), right = Math.min(w, r.right), top = Math.max(0, r.top), bottom = Math.min(h, r.bottom);
      if (right <= left || bottom <= top) throw new Error('[' + refOf.get(el) + '] 现在不在屏幕上（被藏起来了，或者没有大小）。');
      return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2), width: w, height: h };
    },

    /** browser_select: pick an option of a <select> by value or shown text (an exact match first), then input + change. */
    select(o) {
      const el = get(o && o.ref);
      if (el.tagName !== 'SELECT') throw new Error('[' + refOf.get(el) + '] 不是下拉框：用 browser_click 点开它，再点要选的那一项。');
      const want = String(o && o.value != null ? o.value : '').trim().toLowerCase();
      const opts = Array.from(el.options);
      const opt = opts.find((x) => x.value.toLowerCase() === want) || opts.find((x) => x.text.trim().toLowerCase() === want) || (want ? opts.find((x) => x.text.toLowerCase().includes(want)) : null);
      if (!opt) throw new Error('这个下拉框里没有这一项。用 browser_read 或 browser_snapshot 看它有哪些选项。');
      if (opt.disabled) throw new Error('这一项现在不能选（被禁用了）。');
      try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* fine */ }
      try { el.focus({ preventScroll: true }); } catch (e) { /* fine */ }
      const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
      if (d && d.set) d.set.call(el, opt.value); else el.value = opt.value;
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { index: el.selectedIndex };
    },

    /** Selected text, for 「发给对话」. */
    selection() {
      return clean(String(window.getSelection ? window.getSelection() : ''), 4000);
    },
  };
})();
