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
