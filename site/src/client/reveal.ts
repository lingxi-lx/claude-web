// Scroll reveals for browsers without animation-timeline (neon.css): mark the page, then show each box once it is in view.
export function installReveal(): void {
  if (typeof CSS !== 'undefined' && CSS.supports('animation-timeline: view()')) return;
  if (!('IntersectionObserver' in window)) return;
  document.documentElement.classList.add('js-reveal');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -10% 0px' });
  for (const el of document.querySelectorAll('.chapter-card, .stats > div, .install > *')) io.observe(el);
}
