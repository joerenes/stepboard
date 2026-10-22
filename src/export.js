// Standalone HTML export: slides + the Stepboard player + reveal.js, all inlined, so the file works offline.
// __PLAYER_RUNTIME__ and __REVEAL_CSS__ are injected at build time (see build.mjs).
import { PLAYER_CSS, PLAYER_UI_CSS } from './player.js'

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const scriptSafe = (s) => s.replace(/<\/script/gi, '<\\/script')

export function standaloneHtml(title, slides) {
  const data = JSON.stringify(slides.map((s) => ({ layers: s.layers }))).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<style>${__REVEAL_CSS__}</style>
<style>html,body{margin:0;height:100%;background:#1b1e1f;overflow:hidden}#deck{position:fixed;inset:0}#deck .reveal{position:absolute;inset:0}${PLAYER_CSS}${PLAYER_UI_CSS}</style>
</head><body>
<div id="deck"></div>
<script type="application/json" id="sb-slides">${data}</script>
<script>${scriptSafe(__PLAYER_RUNTIME__)}</script>
<script>StepboardPlayer.present(document.getElementById('deck'), JSON.parse(document.getElementById('sb-slides').textContent), 0)</script>
</body></html>
`
}
