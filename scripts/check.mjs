import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publications, news, projects, alumni } from './content.mjs';

// Dependency-free checks for the generated static site. This is not a substitute
// for browser layout, keyboard-navigation, and contrast testing.
const root = fileURLToPath(new URL('../docs/', import.meta.url));
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const decode = value => value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const pages = new Map();
for (const name of await readdir(root)) {
  if (!name.endsWith('.html')) continue;
  const html = await readFile(path.join(root, name), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]*)"/g)].map(match => match[1]);
  pages.set(name, { html, ids: new Set(ids) });
  check(ids.length === new Set(ids).size, `${name}: duplicate IDs`);
  check((html.match(/<h1(?:\s|>)/g) || []).length === 1, `${name}: must have exactly one h1`);
  check((html.match(/<html\s[^>]*lang="en"/g) || []).length === 1, `${name}: must declare English once`);
  check((html.match(/<title>/g) || []).length === 1, `${name}: must have exactly one title`);
  for (const meta of ['description', 'viewport']) {
    check((html.match(new RegExp(`<meta\\s[^>]*name="${meta}"`, 'g')) || []).length === 1, `${name}: expected one ${meta} meta tag`);
  }
  check((html.match(/<main(?:\s|>)/g) || []).length === 1, `${name}: must have exactly one main landmark`);
  check(html.includes('class="skip-link" href="#main"'), `${name}: missing skip link`);
  for (const tag of html.matchAll(/<img\b[^>]*>/g)) {
    check(/\balt="[^"]*"/.test(tag[0]), `${name}: image has no alt attribute`);
  }
}

let internalReferences = 0;
for (const [name, { html }] of pages) {
  for (const match of html.matchAll(/\b(?:href|src)="([^"]*)"/g)) {
    const reference = decode(match[1]);
    check(reference !== '' && reference !== '#', `${name}: empty/placeholder link`);
    check(!/^javascript:/i.test(reference), `${name}: javascript URL`);
    if (/^(?:https?:|mailto:|tel:|data:|\/\/)/i.test(reference)) continue;
    const url = new URL(reference, `https://local.test/${name}`);
    const relative = decodeURIComponent(url.pathname.slice(1)) || 'index.html';
    const target = path.resolve(root, relative);
    check(target.startsWith(root), `${name}: asset escapes site root: ${reference}`);
    try {
      const info = await stat(target);
      check(info.isFile(), `${name}: referenced target is not a file: ${reference}`);
    } catch {
      failures.push(`${name}: missing file ${reference}`);
    }
    if (url.hash && pages.has(relative)) {
      check(pages.get(relative).ids.has(decodeURIComponent(url.hash.slice(1))), `${name}: missing anchor ${reference}`);
    }
    internalReferences++;
  }
}

const pubs = pages.get('publications.html')?.html || '';
check((pubs.match(/class="publication"/g) || []).length === publications.length, 'Publication entry count differs from data');
for (const publication of publications) {
  check(pubs.includes(`id="${publication.id}"`), `Publication missing: ${publication.id}`);
  check(pubs.includes(escape(publication.title)), `Publication title missing: ${publication.id}`);
  check(pubs.includes(publication.authors), `Publication authors missing: ${publication.id}`);
  check(pubs.includes(escape(publication.status)), `Publication status missing: ${publication.id}`);
}
const updates = pages.get('news.html')?.html || '';
check((updates.match(/class="news-entry"/g) || []).length === news.length, 'News entry count differs from data');
for (const item of news) check(updates.includes(escape(item.text)), `News missing: ${item.id}`);
const research = pages.get('research.html')?.html || '';
for (const project of projects) check(research.includes(escape(project.title)), `Project missing: ${project.id}`);
const team = pages.get('team.html')?.html || '';
for (const member of alumni) check(team.includes(escape(member.name)), `Former member missing: ${member.name}`);
for (const name of ['Handong Yao', 'Tianle Zhu', 'Haohua Que', 'Qianyi Wu', 'Richard Alexander Booth Fritz']) {
  check(team.includes(name), `Current team member missing: ${name}`);
}
check(![...pages.values()].some(p => /via\.placeholder\.com|TODO|Lorem ipsum/.test(p.html)), 'Placeholder content detected');

const home = pages.get('index.html')?.html || '';
for (const scene of ['athens', 'rural', 'atlanta']) {
  check(home.includes(`data-scene="${scene}"`), `Homepage scene missing: ${scene}`);
  check(home.includes(`data-show-scene="${scene}"`), `Homepage scene control missing: ${scene}`);
}
check(home.includes('contact.html#phd-opportunities'), 'Homepage recruitment link missing');
check(pages.get('contact.html')?.ids.has('phd-opportunities'), 'Ph.D. opportunities section missing');
check(team.includes('src="assets/haohua-iros-2026-wide.jpg"'), 'Updated wide Haohua portrait missing');
const imageCredits = pages.get('credits.html')?.html || '';
check(home.indexOf('id="lab-in-action"') > home.indexOf('class="featured-grid"'), 'Lab photos must remain below the research spotlight, not in the hero');
for (const [asset, credit] of [['lab-travels-pulaski-visit-2026.png', 'travels-pulaski'], ['lab-capstone-award-2026.jpg', 'capstone-team'], ['lab-ev-field-experiment.png', 'ev-fleet']]) {
  check(home.includes(`assets/${asset}`), `Lab photo missing: ${asset}`);
  check(imageCredits.includes(`id="${credit}"`), `Lab photo credit missing: ${credit}`);
}
check(imageCredits.includes('ev-car-following-MIT-LICENSE.txt'), 'Research fleet MIT notice missing');
check(imageCredits.includes('alans1948') && imageCredits.includes('https://creativecommons.org/licenses/by/2.0/'), 'Athens image attribution missing');
check(imageCredits.includes('United States Department of Agriculture') && imageCredits.includes('Country_road_in_mitchell_co_ga.jpg'), 'Rural Georgia image attribution missing');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`PASS: ${pages.size} pages, ${internalReferences} internal links/assets, unique IDs, local fragments, metadata, alt attributes, and retained content.`);
  console.log(`Retained: ${publications.length} publications, ${news.length} news items, ${projects.length} projects, ${alumni.length} former members, and all 5 current team members.`);
}
