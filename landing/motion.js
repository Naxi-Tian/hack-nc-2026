// Shared motion: page-turn navigation, hero text reveal, one-time scroll reveals.
(() => {
  const root = document.documentElement;
  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');

  /* ── page turn between pages ── */
  const PT_MS = 420;
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a || a.target || a.hasAttribute('download') || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const url = new URL(a.href, location.href);
    if (url.protocol !== location.protocol || url.host !== location.host) return;
    if (url.pathname === location.pathname) return; // same-page anchors scroll normally
    e.preventDefault();
    try { sessionStorage.setItem('pt', '1'); } catch (err) {}
    if (reduceMQ.matches) { location.href = url.href; return; }
    root.classList.remove('pt-in');
    root.classList.add('pt-out');
    setTimeout(() => { location.href = url.href; }, PT_MS);
  });
  addEventListener('pageshow', e => { if (e.persisted) root.classList.remove('pt-out', 'pt-in'); });

  /* ── hero text reveal ── */
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, {granularity: 'grapheme'}) : null;
  document.querySelectorAll('[data-hero-reveal]').forEach(el => {
    if (reduceMQ.matches || !seg || el.dataset.heroDone) return;
    el.dataset.heroDone = '1';
    let i = 0;
    const visual = document.createElement('span');
    visual.setAttribute('aria-hidden', 'true');
    const build = (src, dst) => src.childNodes.forEach(n => {
      if (n.nodeType === 3) {
        n.textContent.split(/(\s+)/).forEach(part => {
          if (!part) return;
          if (/^\s+$/.test(part)) { dst.appendChild(document.createTextNode(part)); return; }
          const w = document.createElement('span'); w.className = 'hero-word';
          for (const {segment} of seg.segment(part)) {
            const u = document.createElement('span');
            u.dataset.heroUnit = ''; u.style.setProperty('--hero-index', i++); u.textContent = segment;
            w.appendChild(u);
          }
          dst.appendChild(w);
        });
      } else if (n.nodeType === 1) {
        const c = n.cloneNode(false); build(n, c); dst.appendChild(c);
      }
    });
    build(el, visual);
    const sr = document.createElement('span'); sr.className = 'hero-sr'; sr.textContent = el.textContent;
    el.replaceChildren(sr, visual);
  });

  /* ── scroll reveal ── */
  const targets = [...document.querySelectorAll('[data-scroll-reveal]')];
  if (!targets.length || reduceMQ.matches || !('IntersectionObserver' in window)) return;
  const show = el => el.setAttribute('data-reveal-visible', 'true');
  targets.forEach(el => {
    if (el.dataset.scrollReveal === 'stagger') [...el.children].forEach((c, i) => c.style.setProperty('--reveal-i', Math.min(i, 3)));
    el.setAttribute('data-reveal-ready', 'true');
  });
  const io = new IntersectionObserver(entries => entries.forEach(en => {
    if (en.isIntersecting) { show(en.target); io.unobserve(en.target); }
  }), {threshold: .16, rootMargin: '0px 0px -6% 0px'});
  targets.forEach(el => io.observe(el));
  reduceMQ.addEventListener?.('change', () => { if (reduceMQ.matches) { targets.forEach(show); io.disconnect(); } });
})();
