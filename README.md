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
`npm install && node build.mjs` -> `dist/index.html` (for claude.ai), `dist/local.html` (standalone), `dist/assets/`, tldraw license.

Outputs: `dist/index.html`, `dist/present.html` + `dist/assets/` are the claude.ai artifact builds; `dist/site/` is a complete
static website with the editor at `index.html` and the player at `present.html`.
The player can open a deck from the same server: `present.html?deck=lecture-1.stepboard.json`.

Host `dist/site/` on any static host (GitHub/GitLab Pages, Netlify, Cloudflare Pages). On the iPad open it in Safari and use
Share > Add to Home Screen: the manifest makes it open full screen as its own app.
Test locally: `cd dist/site && python3 -m http.server 8000`, then `http://localhost:8000/` (or `http://<computer-IP>:8000/`
from the iPad; over plain HTTP the clipboard may be refused, and Save file / Export HTML then show the text to copy).
Browser storage is per address: use Save file / Open file to move a deck between addresses.

Pinned: tldraw 3.15.6, @tldraw/assets 3.15.6, react 18.3.1, reveal.js 5.1.0. Do not upgrade tldraw past 3.x.

## Presenting
Right / Space / Page Down / tap: next build, then next slide. Left / Page Up / tap the left fifth: previous build.
Down / Up or swipe up / down: next / previous slide, returning to the build state you left it in. F: full screen. Esc: stop.
