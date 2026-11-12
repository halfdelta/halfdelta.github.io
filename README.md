# halfdelta.com

The placeholder website for Half Delta: one page, a 404 page, and a small notes section.

## How it is served

GitHub Pages serves the files at the repository root as they are. There is no build step, no framework and no package manager. `.nojekyll` tells Pages to skip Jekyll and serve the files unchanged.

The custom domain is set by the `CNAME` file at the root (`halfdelta.com`). DNS is at Namecheap: four A records for the apex pointing at GitHub Pages, and `www` as a CNAME to `halfdelta.github.io`.

## Files

| File | Purpose |
|---|---|
| `index.html` | The page. Real text, with a static SVG sketch of the city (wireframe towers, the shore, a few traffic trails) that works without JavaScript. |
| `style.css` | Shared styles. Colours, type scale and spacing are CSS custom properties on `:root`, with a dark theme under `prefers-color-scheme`. |
| `main.js` | Optional animation on a canvas: an axonometric city, generated fresh on every visit, with towers drawn back to front, a calm bay under the name, and a spire whose tip is the fixed point. Blue traffic weaves between and behind the towers on lanes at several altitudes and lands on roof rings; in dark mode it is night and the windows glow. The camera drifts slowly. The design is described in the header comment. It does not run when the visitor prefers reduced motion (one still frame instead). |
| `notes/index.html` | The notes index: one line per post, newest first. Linked quietly from the home page. |
| `notes/notes.css` | Styles for the notes pages, loaded after `/style.css`. It reuses the shared custom properties and adds only the red, amber and green status colours (with dark variants). |
| `notes/<slug>/index.html` | One post per folder, so URLs are `/notes/<slug>/`. Posts use root-relative paths and the same head tags as the home page (`og:url` under `https://halfdelta.com/notes/`). Formulas are MathML (platform math fonts). |
| `notes/lucky-or-good/dsr.js` | The post's optional DSR calculator (sliders, readout, SVG curve). Same-origin, no libraries. Without it the post's static tables carry the argument. |
| `404.html` | The not-found page, in the same style. It uses root-relative paths because Pages serves it at any URL. |
| `favicon.svg`, `apple-touch-icon.png` | Icons. |
| `og-image.svg`, `og-image.png` | The link preview image. The PNG is the one linked from the meta tags; the SVG is its source. |
| `robots.txt` | Allows all crawlers. |
| `CNAME` | The custom domain for GitHub Pages. |

## Rules for this site

- Self-contained: no third-party scripts, trackers, analytics, CDNs or web fonts. The page uses the platform's own serif and sans fonts.
- Works without JavaScript, respects reduced motion, reads well in light and dark mode, and fits a 360 px wide phone.
- Keep it small. Everything except the preview image is well under 100 KB.

## Adding a note

Create `notes/<slug>/index.html`, copying the head of an existing post and linking `/style.css` and `/notes/notes.css`. Add the post to `notes/index.html`. Keep the rules above: no third-party code, readable without JavaScript (script only enhances), one `h1`, and every number either sourced or labelled illustrative.

## Preview locally

Any static file server works, for example `python3 -m http.server` in this folder, then open http://localhost:8000/. Opening `index.html` directly from disk also works. `404.html` needs a server, because it uses root-relative paths.
