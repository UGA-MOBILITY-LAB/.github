# UGA Mobility Lab website

The public site is served by GitHub Pages from `main:/docs`, at https://uga-mobility-lab.github.io/.github/.

## Update content

- `scripts/content.mjs`: publications, news, projects, open resources, the TRAVELS case study, and alumni.
- `scripts/build.mjs`: static page templates, current team, and the six research threads (`threads`). The threads drive the home-page research cards, the research page, and the publication topic filter; every publication must belong to at least one thread's `papers`, or the build stops with an error. The build also writes BibTeX for each publication and `docs/assets/mobility-lab-publications.bib`, the contact page's Join section, and `docs/404.html`, which GitHub Pages serves at any missing path, so its links start from `/.github/`.
- `docs/assets/site.css`: responsive visual design.
- `docs/assets/site.js`: mobile navigation, publication filters (research thread, year, and search; `publications.html?topic=<thread id>` opens one thread), Copy BibTeX buttons, and on-demand hero scene loading.
- `docs/assets/scan-viewer.js`: the Hawkinsville 3D view and quiz, opened from the research mosaic. It fetches `docs/assets/hawkinsville-scan.bin.gz` and `hawkinsville-spots.json` only when a visitor opens it. Rebuild both with `python3 scripts/prepare-scan.py RELEASE_DIR` (numpy) from the rav-demo data release.
- `scripts/prepare-map.py`: regenerate `scripts/data/georgia-outline.json` for the research page's field-site map from Natural Earth's states file.
- `docs/assets/traffic-wave.js`: the research page's ring-road traffic-wave simulation (Intelligent Driver Model with a reaction delay; automated vehicles that absorb stop-and-go waves). It runs only after Start.
- `docs/assets/drive-game.js`: the driving game at the foot of the home page (canvas, no dependencies). The road runs through town, farmland, a river bridge, downtown, and pine forest, with signalled intersections, pedestrians, cyclists, and cross traffic; all traffic follows the Intelligent Driver Model and obeys the signals. Like connected traffic lights, the next signal shows its colour, distance, and countdown at the top of the road before it comes into view, and lit lamps show through fog and darkness. It loads only on the home page, starts only when a visitor presses Start, pauses when scrolled away, and keeps the best distance in that browser's local storage.
- `scripts/prepare-images.py`: regenerate display-sized WebP copies (hero scenes, figures, lab photos, portraits), the homepage figure details (a DriveDegrade crop and the GA-72 route redrawn in UGA red), and the favicons with Pillow. `build.mjs` adds every copy it finds to that image's `srcset`; originals stay in place for full-size links and attribution. Add new large photos or figures to its `VARIANTS` list — `check.mjs` rejects inline images over 700 KiB.
- Type: headings use Avenir Next where the device has it and the self-hosted Manrope variable font (`docs/assets/fonts/`, SIL Open Font License) elsewhere; body text uses the system UI font. The wordmark stays in Georgia.

Run `node scripts/build.mjs` and `node scripts/check.mjs`, then commit the updated source and generated HTML. No package installation or build-time services are required for the site build. All substantive content is rendered as static HTML and readable without JavaScript. The ten pages include the Data & Demos directory (`resources.html`), the Georgia fieldwork case study (`travels.html`), and the 404 page.

To preview: `python -m http.server 8765 --bind 127.0.0.1 --directory docs`.

The organization profile in `profile/README.md` is separate from the website. Image sources are documented on `docs/credits.html`.
