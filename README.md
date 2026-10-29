# UGA Mobility Lab website

The public site is served by GitHub Pages from `main:/docs`, at https://uga-mobility-lab.github.io/.github/.

## Update content

- `scripts/content.mjs`: publications, news, projects, open resources, the TRAVELS case study, and alumni.
- `scripts/build.mjs`: static page templates, current team, and research descriptions.
- `docs/assets/site.css`: responsive visual design.
- `docs/assets/site.js`: mobile navigation, publication search/year filters, and on-demand hero scene loading.
- `scripts/prepare-images.py`: regenerate display-sized WebP copies (hero scenes, figures, lab photos, portraits) and the favicons with Pillow. `build.mjs` adds every copy it finds to that image's `srcset`; originals stay in place for full-size links and attribution. Add new large photos or figures to its `VARIANTS` list — `check.mjs` rejects inline images over 700 KiB.

Run `node scripts/build.mjs` and `node scripts/check.mjs`, then commit the updated source and generated HTML. No package installation or build-time services are required for the site build. All substantive content is rendered as static HTML and readable without JavaScript. The nine pages include the Data & Demos directory (`resources.html`) and the Georgia fieldwork case study (`travels.html`).

To preview: `python -m http.server 8765 --bind 127.0.0.1 --directory docs`.

The organization profile in `profile/README.md` is separate from the website. Image sources are documented on `docs/credits.html`.
