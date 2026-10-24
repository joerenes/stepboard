// Standalone HTML export: the whole deck + the Stepboard player + reveal.js, all inlined, so the file works offline.
// The embedded deck is the same data as a .stepboard.json file, so the editor (and the player page) can open the
// exported HTML again with Open file: one file to present and to keep editing.
// __PLAYER_RUNTIME__ and __REVEAL_CSS__ are injected at build time (see build.mjs).
import { PLAYER_CSS, PLAYER_UI_CSS } from './player.js'

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const scriptSafe = (s) => s.replace(/<\/script/gi, '<\\/script')

export function standaloneHtml(title, deck) {
  // \u003c keeps "</script>" (and any other markup) inside the JSON from ending the script element.
  const data = JSON.stringify(deck).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<style>${__REVEAL_CSS__}</style>
<style>html,body{margin:0;height:100%;background:#1b1e1f;overflow:hidden}#deck{position:fixed;inset:0}#deck .reveal{position:absolute;inset:0}${PLAYER_CSS}${PLAYER_UI_CSS}</style>
</head><body>
<div id="deck"></div>
<script type="application/json" id="sb-deck">${data}</script>
<script>${scriptSafe(__PLAYER_RUNTIME__)}</script>
<script>StepboardPlayer.present(document.getElementById('deck'), JSON.parse(document.getElementById('sb-deck').textContent).slides, 0)</script>
</body></html>
`
}
