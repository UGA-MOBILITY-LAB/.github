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
        // The <picture> source (AVIF) is set first, so the browser chooses between the two formats.
        const source = image.previousElementSibling;
        if (source?.dataset.srcset) {
          source.sizes = source.dataset.sizes;
          source.srcset = source.dataset.srcset;
        }
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
// Publications: filter by research thread (?topic=, from the research page), author (?author=, from the
// team page), year, and search.
const controls = document.querySelector('.publication-controls');
if (controls) {
  const input = controls.querySelector('input');
  const yearButtons = [...controls.querySelectorAll('[data-filter]')];
  const topicButtons = [...controls.querySelectorAll('[data-topic]')];
  const entries = [...document.querySelectorAll('.publication')];
  const counter = document.querySelector('.result-count');
  let year = 'all';
  const params = new URLSearchParams(location.search);
  let topic = params.get('topic');
  if (!topicButtons.some(b => b.dataset.topic === topic)) topic = 'all';
  const people = JSON.parse(controls.dataset.people || '{}');
  const authorFilter = document.querySelector('.author-filter');
  const wrote = (entry, key) => entry.dataset.authors.split(' ').includes(key);
  let author = params.get('author');
  if (!entries.some(entry => wrote(entry, author))) author = null;
  const setParam = (name, value) => {
    const url = new URL(location.href);
    if (value) url.searchParams.set(name, value); else url.searchParams.delete(name);
    history.replaceState(history.state, '', url);
  };
  function filter() {
    const query = input.value.toLowerCase().trim();
    let shown = 0;
    entries.forEach(entry => {
      entry.hidden = !((year === 'all' || entry.dataset.year === year) && (topic === 'all' || entry.dataset.topics.split(' ').includes(topic)) && (!author || wrote(entry, author)) && entry.dataset.search.includes(query));
      if (!entry.hidden) shown++;
    });
    counter.textContent = `${shown} ${shown === 1 ? 'publication' : 'publications'}`;
    document.querySelector('.empty-state').hidden = shown !== 0;
    yearButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === year)));
    topicButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.topic === topic)));
    authorFilter.hidden = !author;
    if (author) authorFilter.querySelector('strong').textContent = people[author] || author;
  }
  authorFilter.querySelector('button').addEventListener('click', () => {
    author = null;
    setParam('author', null);
    filter();
  });
  yearButtons.forEach(button => button.addEventListener('click', () => {
    year = button.dataset.filter;
    filter();
  }));
  topicButtons.forEach(button => button.addEventListener('click', () => {
    topic = button.dataset.topic;
    setParam('topic', topic === 'all' ? null : topic);
    filter();
  }));
  input.addEventListener('input', filter);
  filter();
  // On phones the topic row scrolls sideways; bring a topic chosen by link into view without moving the page.
  const chosen = topicButtons.find(b => b.dataset.topic === topic);
  if (topic !== 'all') chosen.parentElement.scrollLeft += chosen.getBoundingClientRect().left - chosen.parentElement.getBoundingClientRect().left - 20;
}
// Copy a paper's BibTeX. Without clipboard access, show the entry selected so it can be copied by hand.
const citeStatus = document.querySelector('.pub-cite-status');
for (const button of document.querySelectorAll('.pub-cite')) {
  const entry = document.getElementById(button.getAttribute('aria-controls'));
  const label = button.querySelector('span');
  let timer;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(entry.textContent);
      label.textContent = 'Copied';
      button.classList.add('is-copied');
      citeStatus.textContent = 'BibTeX copied to the clipboard.';
    } catch {
      entry.hidden = false;
      getSelection().selectAllChildren(entry);
      label.textContent = 'Copy the selected text';
      citeStatus.textContent = 'BibTeX shown below the paper and selected.';
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      label.textContent = 'Copy BibTeX';
      button.classList.remove('is-copied');
    }, 2200);
  });
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
// The Hawkinsville route viewer loads about 70 MB of point-cloud data, so it opens only when asked.
// Without JavaScript, the button is a link to the viewer itself.
for (const launch of document.querySelectorAll('[data-map-src]')) {
  launch.querySelector('[data-map-launch]').addEventListener('click', event => {
    event.preventDefault();
    const frame = document.createElement('iframe');
    frame.title = launch.dataset.mapTitle;
    frame.src = launch.dataset.mapSrc;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allow = 'fullscreen';
    launch.replaceWith(frame);
    frame.focus();
  });
}
