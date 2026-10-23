# Stepboard (first version)

Blackboard-style slide editor: tldraw 3.15.6 as the drawing surface, slides as tldraw pages,
build steps stored on each top-level shape as `meta.in` (appears at step) and `meta.out` (disappears at step).

## Files
- `src/model.js`     step model (pure functions: visibility, layers, insert/merge/swap steps)
- `src/render.js`    renders a slide into stacked SVG layers (same 1600x900 bounds, so they line up)
- `src/player.js`    reveal.js player: builds on left/right, slides on up/down, remembers each slide's build state
- `src/export.js`    standalone HTML export with the player and reveal.js inlined (works offline)
- `src/runtime.js`   player bundle that gets inlined into exported HTML
- `src/present.js` + `src/present.template.html`  Stepboard Player page (present.html): open a deck file and present
- `src/importer.js`  builds a deck from a converted Keynote file (see below)
- `tools/key2stepboard.py`  Keynote → Stepboard converter (Python, runs on your computer)
- `src/storage.js`   IndexedDB storage of the deck (browser only, for now)
- `src/App.jsx`      editor UI
- `src/lasso.jsx`    lasso select tool (custom tldraw tool via public API)
- `static/`          web app manifest and home-screen icons for the hosted site
- `src/index.template.html`  page chrome and styles
- `LICENSES/tldraw-3.15.6-LICENSE.md`  verbatim tldraw license shipped with 3.15.6 (keep with any distribution)

## Deck file (`*.stepboard.json`)
```
{ format: "stepboard-deck", version: 1, name, savedAt, slide: {width, height},
  tldraw: <tldraw document snapshot>,                 // the editable source of truth
  slides: [{ pageId, name, layers: [{ in, out?, svg }] }] }  // cached render for the player
```

## Build
`npm install && node build.mjs` -> `dist/`, a complete static website: the editor at `index.html`, the player at
`present.html`, tldraw's assets, the home-screen manifest and icons, and the tldraw license.
The player can open a deck from the same server: `present.html?deck=lecture-1.stepboard.json`.

GitHub Pages: `.github/workflows/pages.yml` builds and publishes `dist/` on every push to `master`
(one-time: Settings > Pages > Source: GitHub Actions). The site is then at https://joerenes.github.io/stepboard/.

Or host `dist/` on any static host (ETH public_html, GitLab Pages, Netlify, ...). On the iPad open it in Safari and use
Share > Add to Home Screen: the manifest makes it open full screen as its own app.
Test locally: `cd dist && python3 -m http.server 8000`, then `http://localhost:8000/` (or `http://<computer-IP>:8000/`
from the iPad; over plain HTTP the clipboard may be refused).
Browser storage is per address: use Save file / Open file to move a deck between addresses.

Pinned: tldraw 3.15.6, @tldraw/assets 3.15.6, react 18.3.1, reveal.js 5.1.0. Do not upgrade tldraw past 3.x.

## Presenting
Right / Space / Page Down / tap: next build, then next slide. Left / Page Up / tap the left fifth: previous build.
Down / Up or swipe up / down: next / previous slide, returning to the build state you left it in. F: full screen. Esc: stop.
Laser pointer: the Pencil always shows a red dot (touching, or hovering on iPads with Pencil hover) and never navigates;
L toggles the dot for the mouse (air-mouse presenter remotes).
O (or the Overview button): every slide at its final build stage in one scrolling column; tap or Enter to go there.
Overview and Close appear while the pointer is in the upper-right corner (or after a tap there); the slide number
appears in the lower-right corner the same way. Slide pictures are decoded lazily (reveal.js data-src), so big decks
open quickly; the editor re-renders only slides changed since the last save before presenting or exporting.

## Pen width
tldraw 3 has no setting for pressure response or stroke width beyond S/M/L/XL. Stepboard adds a Pen width multiplier
(Fine 0.3x, Thin 0.45x, Medium 0.65x, tldraw 1x) that is written into each new stroke's `props.scale`, the same prop tldraw's
"dynamic size" mode uses, so it is saved with the stroke and exported correctly. Width - / + rescales selected strokes.
The pressure curve itself (thinning, smoothing) is fixed inside tldraw's draw shape and would need a custom shape util to change.

## Converting Keynote decks
With [uv](https://docs.astral.sh/uv/) (nothing goes into your system Python; uv reads the dependencies from
the top of the script and keeps them in its own cached environment):
```
uv run tools/key2stepboard.py lecture.key       # writes lecture.stepboard-import.json
```
Without uv: `pip install -r tools/requirements.txt`, then `python3 tools/key2stepboard.py lecture.key`.
Then in Stepboard: Open file, choose `lecture.stepboard-import.json`. This replaces the deck in the browser.

Converted: slides in order (skipped slides only with `--include-skipped`); pencil drawings as editable strokes with
their width (colours go to the nearest tldraw colour, the exact one is kept in each shape's `meta.sourceColor`);
each Keynote drawing becomes a tldraw group; text boxes and visible titles as text (approximate font and size);
images (PNG/JPEG/GIF/WebP/SVG as they are, PDF images such as pasted equations rendered to sharp PNGs, TIFF/BMP
converted); slide background colours and filled boxes in their exact colour (as single-colour images, since
tldraw's named colours can't express them; backgrounds are locked); builds: In = appears at that step,
Out = disappears; builds that start automatically join the previous step.
Not converted yet: image cropping (the whole image is shown), other shapes, tables, charts, movies, background
images and gradients, transitions, presenter notes. Crayon/brush texture comes out as a solid stroke.
