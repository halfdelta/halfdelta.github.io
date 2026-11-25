# halfdelta.com

The placeholder website for Half Delta: one page, a 404 page, a small engineering blog and a team page.

## How it is served

GitHub Pages serves the files at the repository root as they are. There is no build step, no framework and no package manager. `.nojekyll` tells Pages to skip Jekyll and serve the files unchanged.

The custom domain is set by the `CNAME` file at the root (`halfdelta.com`). DNS is at Namecheap: four A records for the apex pointing at GitHub Pages, and `www` as a CNAME to `halfdelta.github.io`.

## Files

| File | Purpose |
|---|---|
| `index.html` | The page. Real text, with a static SVG sketch of the city (wireframe towers, the shore, a few traffic trails) that works without JavaScript. |
| `style.css` | Shared styles. Colours, type scale and spacing are CSS custom properties on `:root`, with a dark theme under `prefers-color-scheme`. |
| `main.js` | Optional animation on a canvas: an axonometric city, generated fresh on every visit, with towers drawn back to front, a calm bay under the name, and a spire whose tip is the fixed point. Blue traffic weaves between and behind the towers on lanes at several altitudes and lands on roof rings; in dark mode it is night and the windows glow. The camera drifts slowly. The design is described in the header comment. It does not run when the visitor prefers reduced motion (one still frame instead). |
| `blog/index.html` | The Engineering blog index at `/blog/`: author block, then one `<li>` per post, newest first. Linked from the home page. |
| `blog/blog.css` | Styles for the blog pages, loaded after `/style.css`. It reuses the shared custom properties and adds only the red, amber and green status colours (with dark variants). |
| `blog/<slug>/index.html` | One post per folder, so URLs are `/blog/<slug>/`. Posts use root-relative paths and the same head tags as the home page (`og:url` under `https://halfdelta.com/blog/`). Formulas are KaTeX, prerendered to static HTML (with MathML for screen readers); the TeX source sits next to each formula in an HTML comment, `<!-- tex: ... -->`. No KaTeX JavaScript is shipped. |
| `blog/lucky-or-good/dsr.js` | The post's optional DSR calculator (sliders, readout, SVG curve). Same-origin, no libraries. Without it the post's static tables carry the argument. |
| `blog/lucky-or-good/luck.py` | The post's companion script (standard-library Python): effective trades, luck bar and DSR. Shown inline in a `<details>` block and downloadable. |
| `team/index.html` | The Team page at `/team/`: one `<li>` per person (mark, name, title, short text, one aside line). Same head tags as the blog pages (`og:url` under `https://halfdelta.com/team/`) and root-relative paths. Each person's mark is an inline SVG line drawing in the ink and signal colours. Loads `/style.css`, `/blog/blog.css` (for the page column, top nav, `h1` and dek) and `/team/team.css`. |
| `team/team.css` | Styles for the Team page: the person rows, the marks and their theme colours, and a narrower layout under 480 px. |
| `team/team.js` | Optional small surprises on the Team page (described in its header comment). The page is linked from the home page and from every footer. Same-origin, no libraries, no storage, no requests. Without it the page is complete; with reduced motion nothing travels. |
| `assets/katex/` | Self-hosted KaTeX 0.16.11 (MIT, `LICENSE` included): `katex.min.css` edited to reference woff2 fonts only, and the 20 woff2 files in `fonts/` (about 300 KB; a page downloads only the faces it uses). Used for the post formulas. |
| Footer | Every page ends with a `<footer class="site-foot">` (copyright and Home / Engineering blog / Team / LinkedIn links). Styles are in `style.css`; the body is a flex column so the footer sits below the home page chart. |
| `404.html` | The not-found page, in the same style. It uses root-relative paths because Pages serves it at any URL. |
| `favicon.svg`, `apple-touch-icon.png` | Icons. |
| `og-image.svg`, `og-image.png` | The link preview image. The PNG is the one linked from the meta tags; the SVG is its source. |
| `robots.txt` | Allows all crawlers. |
| `CNAME` | The custom domain for GitHub Pages. |

## Rules for this site

- Self-contained: no third-party scripts, trackers, analytics or CDNs; fonts are self-hosted (KaTeX only). The page uses the platform's own serif and sans fonts.
- Works without JavaScript, respects reduced motion, reads well in light and dark mode, and fits a 360 px wide phone.
- Keep it small. Everything except the preview image and the KaTeX fonts is well under 100 KB.

## Adding a post

Create `blog/<slug>/index.html`, copying the head of an existing post and linking `/style.css`, `/assets/katex/katex.min.css` (if it has formulas) and `/blog/blog.css`. Add the post to `blog/index.html`. Keep the rules above: no third-party code, readable without JavaScript (script only enhances), one `h1`, and every number either sourced or labelled illustrative.

## Preview locally

Any static file server works, for example `python3 -m http.server` in this folder, then open http://localhost:8000/. Opening `index.html` directly from disk also works. `404.html` needs a server, because it uses root-relative paths.
