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
    check(!/\bsrcset="/.test(tag[0]) || /\bsizes="/.test(tag[0]), `${name}: responsive image has no sizes attribute`);
  }
}
const candidates = value => decode(value).split(',').map(candidate => candidate.trim().split(/\s+/)[0]);
// 404.html is served at any missing path, so it links from the site root (/.github/) instead of relatively.
const siteRoot = '/.github/';
const fromRoot = reference => (reference.startsWith(siteRoot) ? reference.slice(siteRoot.length) : reference);

let internalReferences = 0;
for (const [name, { html }] of pages) {
  const references = [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map(match => decode(match[1]));
  for (const match of html.matchAll(/\bsrcset="([^"]*)"/g)) references.push(...candidates(match[1]));
  for (const reference of references) {
    check(reference !== '' && reference !== '#', `${name}: empty/placeholder link`);
    check(!/^javascript:/i.test(reference), `${name}: javascript URL`);
    if (/^(?:https?:|mailto:|tel:|data:|\/\/)/i.test(reference)) continue;
    if (name === '404.html') check(reference.startsWith(siteRoot) || reference.startsWith('#'), `404.html: link must start at the site root: ${reference}`);
    const url = new URL(fromRoot(reference), `https://local.test/${name}`);
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

// Inline images must use display-sized copies; full-size originals may only be linked.
const imageBudget = 700 * 1024;
for (const [name, { html }] of pages) {
  for (const tag of html.matchAll(/<img\b[^>]*>/g)) {
    for (const match of tag[0].matchAll(/\b(?:src|srcset)="([^"]*)"/g)) {
      for (const file of candidates(match[1])) {
        if (/^(?:https?:|data:|\/\/)/i.test(file)) continue;
        const { size } = await stat(path.resolve(root, fromRoot(file))).catch(() => ({ size: 0 }));
        check(size <= imageBudget, `${name}: inline image over ${imageBudget / 1024} KiB: ${file}`);
      }
    }
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
const bib = await readFile(path.join(root, 'assets', 'mobility-lab-publications.bib'), 'utf8').catch(() => '');
check((bib.match(/^@\w+\{/gm) || []).length === publications.length, 'BibTeX file entry count differs from data');
for (const entry of pubs.matchAll(/<article class="publication"[^>]*>/g)) {
  check(/data-topics="[^"]+"/.test(entry[0]), `Publication has no research thread: ${/id="([^"]*)"/.exec(entry[0])?.[1]}`);
}
check((pubs.match(/class="pub-bibtex"/g) || []).length === publications.length, 'Every publication needs a BibTeX entry');
// Link previews, structured data, and the sitemap.
for (const [name, { html }] of pages) {
  const image = /<meta property="og:image" content="https:\/\/uga-mobility-lab\.github\.io\/\.github\/([^"]+)"/.exec(html)?.[1];
  const exists = image && await stat(path.join(root, image)).then(info => info.isFile(), () => false);
  check(exists, `${name}: og:image must point to a file in docs/`);
  for (const block of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
    try { JSON.parse(block[1]); } catch { failures.push(`${name}: structured data is not valid JSON`); }
  }
}
const scholarly = (pubs.match(/"@type":"ScholarlyArticle"/g) || []).length;
check(scholarly === publications.length, 'Every publication needs a ScholarlyArticle in the structured data');
check((pages.get('index.html')?.html || '').includes('"@type":"ResearchOrganization"'), 'Home page organization structured data missing');
const sitemap = await readFile(path.join(root, 'sitemap.xml'), 'utf8').catch(() => '');
for (const name of pages.keys()) {
  if (name === '404.html') continue;
  check(sitemap.includes(`<loc>https://uga-mobility-lab.github.io/.github/${name === 'index.html' ? '' : name}</loc>`), `Sitemap missing ${name}`);
}
const lost = pages.get('404.html')?.html || '';
check(lost.includes('<meta name="robots" content="noindex">') && !lost.includes('rel="canonical"'), '404.html must be noindex without a canonical URL');
const updates = pages.get('news.html')?.html || '';
check((updates.match(/class="news-entry"/g) || []).length === news.length, 'News entry count differs from data');
for (const item of news) {
  check(updates.includes(escape(item.text)), `News missing: ${item.id}`);
  if (item.dateLabel) {
    check(Number.isFinite(Date.parse(item.sortDate || item.dateLabel)), `Invalid news date: ${item.id}`);
    check(updates.includes(escape(item.dateLabel)), `News date missing: ${item.id}`);
    check(item.links?.some(link => /^https:\/\//.test(link.url)), `Dated news needs an external source: ${item.id}`);
  }
}
const research = pages.get('research.html')?.html || '';
for (const project of projects) check(research.includes(escape(project.title)), `Project missing: ${project.id}`);
check((research.match(/class="research-detail"/g) || []).length === 6, 'Research page must show the six research threads');
for (const legacy of ['autonomy', 'cooperation', 'robotics', 'infrastructure']) check(pages.get('research.html')?.ids.has(legacy), `Old research anchor missing: #${legacy}`);
const team = pages.get('team.html')?.html || '';
for (const member of alumni) check(team.includes(escape(member.name)), `Former member missing: ${member.name}`);
for (const name of ['Handong Yao', 'Tianle Zhu', 'Haohua Que', 'Qianyi Wu', 'Richard Alexander Booth Fritz']) {
  check(team.includes(name), `Current team member missing: ${name}`);
}
check(![...pages.values()].some(p => /via\.placeholder\.com|TODO|Lorem ipsum/.test(p.html)), 'Placeholder content detected');

const home = pages.get('index.html')?.html || '';
check(updates.includes('<em>$15M</em>'), 'news.html: TRAVELS funding highlight missing');
// The home page leads with the newest dated story.
const newest = news.filter(n => n.dateLabel).sort((a, b) => Date.parse(b.sortDate || b.dateLabel) - Date.parse(a.sortDate || a.dateLabel))[0];
const lead = home.indexOf(`href="news.html#${newest.id}"`);
check(lead > -1 && lead < home.indexOf('class="research-mosaic"'), `Home page should lead with the newest story: ${newest.id}`);
for (const scene of ['athens', 'rural', 'atlanta']) {
  check(home.includes(`data-scene="${scene}"`), `Homepage scene missing: ${scene}`);
  check(home.includes(`data-show-scene="${scene}"`), `Homepage scene control missing: ${scene}`);
}
check(home.includes('contact.html#phd-opportunities'), 'Homepage recruitment link missing');
check(home.includes('id="drive-game"') && home.includes('src="assets/drive-game.js?v='), 'Homepage driving game missing');
check(home.includes('data-scan-open') && home.includes('id="scan-dialog"'), 'Homepage 3D scan view missing');
for (const file of ['hawkinsville-scan.bin.gz', 'hawkinsville-spots.json']) {
  const { size } = await stat(path.join(root, 'assets', file)).catch(() => ({ size: 0 }));
  check(size > 0, `3D scan data missing: ${file}`);
}
check(research.includes('id="field-sites"') && research.includes('class="ga-map"'), 'Research field-site map missing');
check(research.includes('id="traffic-wave"') && research.includes('src="assets/traffic-wave.js?v='), 'Research traffic-wave simulation missing');
check(pages.get('contact.html')?.ids.has('phd-opportunities'), 'Ph.D. opportunities section missing');
check(/src="assets\/haohua-iros-2026-wide[-.]/.test(team), 'Updated wide Haohua portrait missing');
const imageCredits = pages.get('credits.html')?.html || '';
check(home.indexOf('id="lab-in-action"') > home.indexOf('class="research-mosaic"'), 'Lab photos must remain below the research spotlight, not in the hero');
check(home.includes('id="research-vehicle"') && /src="assets\/research-vehicle[-.]/.test(home), 'Original research vehicle showcase missing');
check(home.indexOf('id="research-vehicle"') < home.indexOf('id="lab-in-action"'), 'Real lab photos must remain separate and below the vehicle showcase');
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
