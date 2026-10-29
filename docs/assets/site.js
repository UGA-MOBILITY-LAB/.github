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
