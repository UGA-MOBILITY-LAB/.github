# UGA Mobility Lab website

The public site is served by GitHub Pages from `main:/docs`, at https://uga-mobility-lab.github.io/.github/.

## Update content

- `scripts/content.mjs`: publications, news, projects, and alumni.
- `scripts/build.mjs`: static page templates, current team, and research descriptions.
- `docs/assets/site.css`: responsive visual design.
- `docs/assets/site.js`: mobile navigation and publication search/year filters.

Run `node scripts/build.mjs`, then commit the updated source and generated HTML. No package installation or build-time services are required. All substantive content is rendered as static HTML and readable without JavaScript.

To preview: `python -m http.server 8765 --bind 127.0.0.1 --directory docs`.

The organization profile in `profile/README.md` is separate from the website. Image sources are documented on `docs/credits.html`.
