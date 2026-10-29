// Progressive enhancement: all page content and navigation work without JavaScript.
// Each page's <head> sets the js class before first paint, so menus do not collapse after load.
const toggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('#main-nav');
toggle?.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  nav.classList.toggle('is-open', open);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && toggle?.getAttribute('aria-expanded') === 'true') {
    toggle.setAttribute('aria-expanded', 'false');
    nav.classList.remove('is-open');
    toggle.focus();
  }
});
// Manual scene selection keeps the photographs still while people read.
const sceneControls = document.querySelector('.scene-controls');
if (sceneControls) {
  const images = [...document.querySelectorAll('[data-scene]')];
  const buttons = [...sceneControls.querySelectorAll('[data-show-scene]')];
  const caption = document.querySelector('.scene-caption');
  const credit = document.querySelector('.scene-credit');
  const status = document.querySelector('.scene-load-status');
  const loads = new WeakMap();
  let selection = 0;
  function loadScene(image) {
    if (image.complete && image.naturalWidth > 0) return Promise.resolve();
    if (loads.has(image)) return loads.get(image);
    const pending = new Promise((resolve, reject) => {
      function cleanup() {
        image.removeEventListener('load', loaded);
        image.removeEventListener('error', failed);
      }
      async function loaded() {
        cleanup();
        try {
          if (image.decode) await image.decode();
          resolve();
        } catch (error) {
          reject(error);
        }
      }
      function failed() {
        cleanup();
        reject(new Error('Scene image could not be loaded.'));
      }
      image.addEventListener('load', loaded);
      image.addEventListener('error', failed);
      // The initial scene is already in HTML. Other photographs are only
      // requested after a visitor chooses them, including their responsive set.
      if (image.dataset.src) {
        if (image.dataset.sizes) image.sizes = image.dataset.sizes;
        if (image.dataset.srcset) image.srcset = image.dataset.srcset;
        image.src = image.dataset.src;
      }
    });
    loads.set(image, pending);
    pending.catch(() => {
      loads.delete(image);
      // Leave deferred URLs available for another attempt after a network error.
      if (image.dataset.src) {
        image.removeAttribute('srcset');
        image.removeAttribute('src');
      }
    });
    return pending;
  }
  buttons.forEach(button => button.addEventListener('click', async () => {
    const requested = ++selection;
    const next = images.find(image => image.dataset.scene === button.dataset.showScene);
    if (!next) return;
    if (next.classList.contains('is-active')) {
      sceneControls.removeAttribute('aria-busy');
      if (status) status.textContent = '';
      return;
    }
    sceneControls.setAttribute('aria-busy', 'true');
    if (status) status.textContent = `Loading ${button.textContent.trim()} photograph.`;
    try {
      await loadScene(next);
    } catch {
      if (requested !== selection) return;
      sceneControls.removeAttribute('aria-busy');
      if (status) status.textContent = 'The photograph could not be loaded. Please try again.';
      return;
    }
    // A later click wins even if a previous image finishes loading afterwards.
    if (requested !== selection) return;
    images.forEach(image => {
      const active = image === next;
      image.classList.toggle('is-active', active);
      image.setAttribute('aria-hidden', String(!active));
    });
    buttons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    caption.textContent = button.dataset.caption;
    credit.href = `credits.html#${button.dataset.credit}`;
    sceneControls.removeAttribute('aria-busy');
    if (status) status.textContent = `${button.textContent.trim()} photograph displayed.`;
  }));
}
const controls = document.querySelector('.publication-controls');
if (controls) {
  const input = controls.querySelector('input');
  const buttons = [...controls.querySelectorAll('[data-filter]')];
  const entries = [...document.querySelectorAll('.publication')];
  const counter = document.querySelector('.result-count');
  let year = 'all';
  function filter() {
    const query = input.value.toLowerCase().trim();
    let shown = 0;
    entries.forEach(entry => {
      entry.hidden = !((year === 'all' || entry.dataset.year === year) && entry.dataset.search.includes(query));
      if (!entry.hidden) shown++;
    });
    counter.textContent = `${shown} ${shown === 1 ? 'publication' : 'publications'}`;
    document.querySelector('.empty-state').hidden = shown !== 0;
  }
  buttons.forEach(button => button.addEventListener('click', () => {
    year = button.dataset.filter;
    buttons.forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    filter();
  }));
  input.addEventListener('input', filter);
  filter();
}
// Field-site map: markers and cards highlight each other. A marker selects its card without jumping the page.
const fieldMap = document.querySelector('.field-map');
if (fieldMap) {
  const sites = [...fieldMap.querySelectorAll('[data-site]')];
  let chosen = null;
  const mark = id => sites.forEach(site => site.classList.toggle('is-active', site.dataset.site === id));
  for (const type of ['pointerover', 'focusin']) {
    fieldMap.addEventListener(type, event => {
      const site = event.target.closest('[data-site]');
      if (site) mark(site.dataset.site);
    });
  }
  fieldMap.addEventListener('pointerleave', () => mark(chosen));
  fieldMap.addEventListener('focusout', event => { if (!fieldMap.contains(event.relatedTarget)) mark(chosen); });
  for (const link of fieldMap.querySelectorAll('.ga-site')) {
    link.addEventListener('click', event => {
      event.preventDefault();
      chosen = link.dataset.site;
      mark(chosen);
      const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.getElementById(`site-${chosen}`)?.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
    });
  }
}
// Easter egg: typing "go dawgs" outside a form field sends a small car across the screen.
// It is decorative only: it never takes focus or blocks clicks, and it only fades with reduced motion.
let typed = '';
document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.closest?.('input, textarea, select, [contenteditable]')) return;
  // The physical key still names the letter while a Chinese or other input method is active.
  const letter = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : event.key.length === 1 ? event.key.toLowerCase() : '';
  if (!letter) return;
  typed = (typed + letter).replace(/[^a-z]/g, '').slice(-7);
  if (typed !== 'godawgs' || document.querySelector('.dawg-run')) return;
  typed = '';
  const run = document.createElement('div');
  run.className = 'dawg-run';
  run.setAttribute('aria-hidden', 'true');
  run.innerHTML = '<span class="dawg-cheer">Go Dawgs!</span><svg viewBox="0 0 120 50"><path d="M6 36c0-5 3-8 8-9l20-3 14-12c3-2 6-3 10-3h22c4 0 7 1 10 4l11 11 9 1c5 1 8 4 8 9v4c0 2-2 4-4 4H10c-2 0-4-2-4-4z" fill="#ba0c2f"/><path d="M50 15c2-2 4-3 7-3h9v12H40zM70 12h10c3 0 5 1 7 3l8 9H70z" fill="#16181b"/><rect x="61" y="5" width="12" height="5" rx="2" fill="#16181b"/><circle cx="30" cy="42" r="8" fill="#16181b"/><circle cx="30" cy="42" r="3" fill="#d4d7db"/><circle cx="92" cy="42" r="8" fill="#16181b"/><circle cx="92" cy="42" r="3" fill="#d4d7db"/><rect x="108" y="30" width="6" height="4" rx="1" fill="#fff4cc"/></svg>';
  document.body.append(run);
  const animation = matchMedia('(prefers-reduced-motion: reduce)').matches
    ? run.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: 1800 })
    : run.animate([{ transform: 'translateX(-160px)' }, { transform: `translateX(${innerWidth + 40}px)` }], { duration: 2600, easing: 'cubic-bezier(.45,0,.25,1)' });
  animation.onfinish = () => run.remove();
});
