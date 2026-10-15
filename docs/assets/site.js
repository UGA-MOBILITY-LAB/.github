// Progressive enhancement: all page content and navigation work without JavaScript.
document.documentElement.classList.add('js');
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
  sceneControls.hidden = false;
  buttons.forEach(button => button.addEventListener('click', () => {
    images.forEach(image => {
      const active = image.dataset.scene === button.dataset.showScene;
      image.classList.toggle('is-active', active);
      image.setAttribute('aria-hidden', String(!active));
    });
    buttons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    caption.textContent = button.dataset.caption;
    credit.href = `credits.html#${button.dataset.credit}`;
  }));
}
const controls = document.querySelector('.publication-controls');
if (controls) {
  controls.hidden = false;
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
    counter.hidden = false;
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
