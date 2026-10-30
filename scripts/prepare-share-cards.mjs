// Render the 1200×630 link-preview images (Open Graph / social cards) in docs/assets/share/.
// Usage: node scripts/prepare-share-cards.mjs   (needs Playwright with Chromium; not part of the site build)
// Each card pairs the page's own heading with an image from that page. Re-run after changing a heading.
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const docs = fileURLToPath(new URL('../docs/', import.meta.url));
const asset = file => pathToFileURL(path.join(docs, 'assets', file)).href;

// fit: 'cover' for photographs, 'contain' for figures shown whole on a light background; scale enlarges a cutout.
// A list of images is stacked as figure cards (the publications page).
const cards = {
  index: { kicker: 'University of Georgia · Mobility Lab', title: 'Intelligent mobility.<br><em>Built for the real world.</em>', text: 'Autonomous vehicles, intelligent infrastructure, and the people who depend on them.', image: 'athens-downtown-1280.webp', fit: 'cover' },
  research: { kicker: 'Research & projects', title: 'Autonomy in context.<br><em>Impact in the world.</em>', text: 'Six research threads, from how vehicles see to how communities move.', image: 'hawkinsville-lidar-hdmap-1280.webp', fit: 'cover' },
  publications: { kicker: 'Publications', title: 'Ideas, experiments,<br><em>and evidence.</em>', text: 'Papers on autonomous driving, robotics, V2X perception, and transportation systems.', image: ['drivedegrade-detail-960.webp', 'falcon-overview-960.webp', 'dinolink-overview-960.webp'], fit: 'contain' },
  team: { kicker: 'Our people', title: 'Different perspectives.<br><em>Shared direction.</em>', text: 'The researchers of the UGA Mobility Lab.', image: 'lab-team-2026.jpg', fit: 'cover' },
  resources: { kicker: 'Data & demos', title: 'Explore the evidence.<br><em>Build what comes next.</em>', text: 'Maps, experiment data, and research synthesis you can reuse.', image: 'ev-car-following-route-red-1280.webp', fit: 'cover' },
  news: { kicker: 'Lab news', title: 'Progress worth<br><em>sharing.</em>', text: 'Fieldwork, papers, awards, and stories from the lab.', image: 'nhtsa-visit-2026-demonstration.jpg', fit: 'cover' },
  travels: { kicker: 'TRAVELS · Georgia', title: 'From community needs<br><em>to a mapped rural route.</em>', text: 'Hawkinsville and Pulaski County: local priorities, route planning, and infrastructure evidence.', image: 'lab-travels-pulaski-visit-2026-1280.webp', fit: 'cover' },
  contact: { kicker: 'Contact', title: 'A conversation can<br><em>start something new.</em>', text: 'Ph.D. opportunities, research inquiries, and collaborations.', image: 'research-vehicle-719.webp', fit: 'contain', scale: 1.5 },
  credits: { kicker: 'Image credits', title: 'The images behind<br><em>the research.</em>', text: 'Sources and licenses for the imagery on this website.', image: 'atlanta-mobility-1280.webp', fit: 'cover' },
};

const html = card => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Manrope;font-weight:200 800;src:url(${asset('fonts/manrope-latin-wght-normal.woff2')}) format('woff2')}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;font-family:Manrope,sans-serif;color:#1d1d1f;background:#fff}
.card{display:grid;grid-template-columns:720px 480px;height:630px}
.text{display:flex;flex-direction:column;justify-content:space-between;padding:56px 52px 50px 62px;border-left:10px solid #ba0c2f}
.brand{font:700 34px/1 'Bitstream Charter',Georgia,serif;letter-spacing:-.03em;color:#ba0c2f}
.brand i{font-weight:400}
.kicker{font-size:17px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#ba0c2f;margin-bottom:22px}
h1{font-size:52px;font-weight:650;line-height:1.1;letter-spacing:-.035em}
h1 em{font-style:normal;color:#ba0c2f}
.desc{font-size:21px;line-height:1.45;color:#5d6168;margin-top:20px;max-width:560px}
.url{font-size:18px;font-weight:600;color:#5d6168}
.media{position:relative;background:${card.fit === 'contain' ? '#f4f5f7' : '#0b0e12'};overflow:hidden}
.stack{display:grid;gap:16px;align-content:center;height:100%;padding:30px 28px}
.stack img{display:block;width:100%;height:auto;max-height:170px;object-fit:contain;background:#fff;border:1px solid #e2e5e9;padding:10px}
.media>img{width:100%;height:100%;object-fit:${card.fit};${card.fit === 'contain' ? 'padding:26px 22px' : ''}${card.scale ? `;transform:scale(${card.scale})` : ''}}
</style></head><body><div class="card"><div class="text"><div class="brand">UGA <i>Mobility Lab</i></div><div><p class="kicker">${card.kicker}</p><h1>${card.title}</h1><p class="desc">${card.text}</p></div><p class="url">uga-mobility-lab.github.io/.github</p></div><div class="media">${Array.isArray(card.image) ? `<div class="stack">${card.image.map(file => `<img src="${asset(file)}" alt="">`).join('')}</div>` : `<img src="${asset(card.image)}" alt="">`}</div></div></body></html>`;

const out = path.join(docs, 'assets', 'share');
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
const scratch = path.join(tmpdir(), 'mobility-lab-share-card.html');
for (const [name, card] of Object.entries(cards)) {
  await writeFile(scratch, html(card));
  await page.goto(pathToFileURL(scratch).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 86 });
  console.log(`share/${name}.jpg`);
}
await rm(scratch);
await browser.close();
