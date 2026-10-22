# Stepboard (first version)

Blackboard-style slide editor: tldraw 3.15.6 as the drawing surface, slides as tldraw pages,
build steps stored on each top-level shape as `meta.in` (appears at step) and `meta.out` (disappears at step).

## Files
- `src/model.js`     step model (pure functions: visibility, layers, insert/merge/swap steps)
- `src/render.js`    renders a slide into stacked SVG layers (same 1600x900 bounds, so they line up)
- `src/player.js`    reveal.js player + standalone HTML export (layers become fragments)
- `src/storage.js`   IndexedDB storage of the deck (browser only, for now)
- `src/App.jsx`      editor UI
- `src/index.template.html`  page chrome and styles
- `LICENSES/tldraw-3.15.6-LICENSE.md`  verbatim tldraw license shipped with 3.15.6 (keep with any distribution)

## Deck file (`*.stepboard.json`)
```
{ format: "stepboard-deck", version: 1, name, savedAt, slide: {width, height},
  tldraw: <tldraw document snapshot>,                 // the editable source of truth
  slides: [{ pageId, name, layers: [{ in, out?, svg }] }] }  // cached render for the player
```

## Build
`npm install && node build.mjs` -> `dist/index.html` + `dist/assets/` (+ tldraw license).
The template has no <html>/<head>/<body>; wrap it in a minimal skeleton to serve it elsewhere.

Pinned: tldraw 3.15.6, @tldraw/assets 3.15.6, react 18.3.1, reveal.js 5.1.0. Do not upgrade tldraw past 3.x.
