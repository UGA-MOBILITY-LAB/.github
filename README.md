# UGA Mobility Lab website

The public site is served by GitHub Pages from `main:/docs`, at https://uga-mobility-lab.github.io/.github/.

## Update content

- `scripts/content.mjs`: publications, news, projects, open resources, the TRAVELS case study, and alumni.
- `scripts/build.mjs`: static page templates, current team, and the six research threads (`threads`). The threads drive the home-page research cards, the research page, and the publication topic filter; every publication must belong to at least one thread's `papers`, or the build stops with an error. The build also writes BibTeX for each publication and `docs/assets/mobility-lab-publications.bib`, the contact page's Join section, and `docs/404.html`, which GitHub Pages serves at any missing path, so its links start from `/.github/`.
- `docs/assets/site.css`: responsive visual design. Colours are custom properties on `:root` (`--ink`, `--paper`, `--surface`, `--card`, `--line`, `--accent`, …), redefined under `prefers-color-scheme: dark`, so the site follows the device's light or dark setting. Headings use one type scale (`--h2`, `--h2-item`, `--h3`, `--h4`).
- `docs/assets/site.js`: mobile navigation, the Travels page's route viewer (it loads about 70 MB of LiDAR data, so it opens only when a visitor asks), publication filters (research thread, year, and search; `publications.html?topic=<thread id>` opens one thread), Copy BibTeX buttons, and on-demand hero scene loading.
- `docs/assets/scan-viewer.js`: the Hawkinsville 3D view and quiz, opened from the research mosaic. It fetches `docs/assets/hawkinsville-scan.bin.gz` and `hawkinsville-spots.json` only when a visitor opens it. Rebuild both with `python3 scripts/prepare-scan.py RELEASE_DIR` (numpy) from the rav-demo data release.
- `scripts/prepare-map.py`: regenerate `scripts/data/georgia-outline.json` for the research page's field-site map from Natural Earth's states file.
- `docs/assets/traffic-wave.js`: the research page's ring-road traffic-wave simulation (Intelligent Driver Model with a reaction delay; automated vehicles that absorb stop-and-go waves). It runs only after Start.
- `docs/assets/drive-game.js`: the driving game at the foot of the home page (canvas, no dependencies). The road runs through town, farmland, a river bridge, downtown, and pine forest, with signalled intersections, pedestrians, cyclists, and cross traffic; all traffic follows the Intelligent Driver Model and obeys the signals. Like connected traffic lights, the next signal shows its colour, distance, and countdown at the top of the road before it comes into view, and lit lamps show through fog and darkness. It loads only on the home page, starts only when a visitor presses Start, pauses when scrolled away, and keeps the best distance in that browser's local storage.
- `scripts/prepare-senseexpo.py`: rebuild the SenseExpo exploration map (research thread 04) from the authors' preview GIF at three times its size, snapped to the figure's flat colours.
- `scripts/prepare-share-cards.mjs`: render the 1200×630 link-preview images in `docs/assets/share/` (one per page, used for `og:image`) with Playwright. Re-run it after changing a page heading.
- `scripts/prepare-images.py`: regenerate display-sized WebP copies (plus AVIF copies of the hero scenes, about half the size, and team portraits cropped to matching head-and-shoulders framing; the site shows portraits in black and white, in colour on hover) (hero scenes, figures, lab photos, portraits), the homepage figure details (a DriveDegrade crop and the GA-72 route redrawn in UGA red), and the favicons with Pillow. `build.mjs` adds every copy it finds to that image's `srcset`; originals stay in place for full-size links and attribution. Add new large photos or figures to its `VARIANTS` list — `check.mjs` rejects inline images over 700 KiB.
- Type: headings use Avenir Next where the device has it and the self-hosted Manrope variable font (`docs/assets/fonts/`, SIL Open Font License) elsewhere; body text uses the system UI font. The wordmark stays in Georgia.

Run `node scripts/build.mjs` and `node scripts/check.mjs`, then commit the updated source and generated HTML. The Site check workflow (`.github/workflows/site-check.yml`) runs both on every pull request and push to `main`, and fails if the committed `docs/` differs from a fresh build.

Search engines: the build writes `docs/sitemap.xml` and schema.org structured data (the lab as a research organization, its people, and its publications). Because the site lives under `/.github/`, a `robots.txt` here would be ignored, so submit the sitemap in Google Search Console instead. No package installation or build-time services are required for the site build. All substantive content is rendered as static HTML and readable without JavaScript. The ten pages include the Data & Demos directory (`resources.html`), the Georgia fieldwork case study (`travels.html`), and the 404 page.

To preview: `python -m http.server 8765 --bind 127.0.0.1 --directory docs`.

The organization profile in `profile/README.md` is separate from the website. Image sources are documented on `docs/credits.html`.
