# halfdelta.com

The placeholder website for Half Delta: one page, a 404 page, and nothing else yet.

## How it is served

GitHub Pages serves the files at the repository root as they are. There is no build step, no framework and no package manager. `.nojekyll` tells Pages to skip Jekyll and serve the files unchanged.

The custom domain is set by the `CNAME` file at the root (`halfdelta.com`). DNS is at Namecheap: four A records for the apex pointing at GitHub Pages, and `www` as a CNAME to `halfdelta.github.io`.

## Files

| File | Purpose |
|---|---|
| `index.html` | The page. Real text, with a static SVG drawing (the curve fan and the infinity) that works without JavaScript. |
| `style.css` | Shared styles. Colours, type scale and spacing are CSS custom properties on `:root`, with a dark theme under `prefers-color-scheme`. |
| `main.js` | Optional animation on a canvas: a 32-second loop of three shapes through one fixed point (S-curve, Cornu spiral, infinity). Each new shape is drawn out of the point while the last one fades, and each phase leaves faint afterimages. The timeline is the `SEQUENCE` table at the top of the file. It does not run when the visitor prefers reduced motion. |
| `404.html` | The not-found page, in the same style. It uses root-relative paths because Pages serves it at any URL. |
| `favicon.svg`, `apple-touch-icon.png` | Icons. |
| `og-image.svg`, `og-image.png` | The link preview image. The PNG is the one linked from the meta tags; the SVG is its source. |
| `robots.txt` | Allows all crawlers. |
| `CNAME` | The custom domain for GitHub Pages. |

## Rules for this site

- Self-contained: no third-party scripts, trackers, analytics, CDNs or web fonts. The page uses the platform's own serif and sans fonts.
- Works without JavaScript, respects reduced motion, reads well in light and dark mode, and fits a 360 px wide phone.
- Keep it small. Everything except the preview image is well under 100 KB.

## Later

A `/notes/` section, a set of written posts, may be added later. New pages should link `/style.css` and reuse its custom properties rather than define their own colours or type sizes.

## Preview locally

Any static file server works, for example `python3 -m http.server` in this folder, then open http://localhost:8000/. Opening `index.html` directly from disk also works. `404.html` needs a server, because it uses root-relative paths.
