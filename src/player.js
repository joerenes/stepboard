// Player: turns cached slide layers into reveal.js slides with fragments.
// Layer at step 0 is plain; a later "in" becomes a fragment; an "out" nests a fade-out fragment inside.
import Reveal from 'reveal.js'
import { SLIDE_W, SLIDE_H } from './model.js'

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export function slideMarkup(layers) {
  const parts = layers.map((l) => {
    // SVGs go in <img> so their internal ids and styles can't collide between layers.
    let inner = `<div class="sb-layer"><img alt="" draggable="false" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(l.svg)}"></div>`
    if (l.out !== undefined) inner = `<div class="sb-layer fragment fade-out" data-fragment-index="${l.out}">${inner}</div>`
    if (l.in > 0) inner = `<div class="sb-layer fragment" data-fragment-index="${l.in}">${inner}</div>`
    return inner
  })
  return `<section><div class="sb-board">${parts.join('')}</div></section>`
}

export const PLAYER_CSS = `
.reveal .slides section { padding: 0; height: 100%; }
.sb-board { position: absolute; inset: 0; background: #fff; }
.sb-layer { position: absolute; inset: 0; }
.sb-layer > img { width: 100%; height: 100%; display: block; max-width: none; margin: 0; }
/* Builds pop in instantly, like Keynote's Appear. */
.reveal .slides section .fragment, .reveal .slides section .fragment.visible { transition: none !important; }
.reveal .slides section .fragment.fade-out.visible { opacity: 0; visibility: hidden; }
`

export const REVEAL_OPTIONS = {
  width: SLIDE_W, height: SLIDE_H, margin: 0.02, center: false, hash: false,
  transition: 'none', backgroundTransition: 'none', controls: true, progress: true, slideNumber: 'c/t',
}

/** Present inside the editor. Returns a function that closes the player. */
export function present(container, slides, startIndex, onClose) {
  container.innerHTML = `<div class="reveal"><div class="slides">${slides.map((s) => slideMarkup(s.layers)).join('')}</div></div>
    <button type="button" class="sb-close" aria-label="Close presentation">Close</button>`
  const el = container.querySelector('.reveal')
  const deck = new Reveal(el, { ...REVEAL_OPTIONS, embedded: true, keyboard: { 27: () => close(), 81: () => close() } })
  let closed = false
  function close() {
    if (closed) return
    closed = true
    try { deck.destroy() } catch {}
    container.innerHTML = ''
    onClose && onClose()
  }
  container.querySelector('.sb-close').addEventListener('click', close)
  // Tap on the board (Pencil or finger) advances, like a clicker.
  el.addEventListener('click', (e) => { if (!e.target.closest('.controls, .progress, button')) deck.next() })
  deck.initialize().then(() => { deck.slide(Math.max(0, startIndex)); el.focus?.() })
  return close
}

/** A standalone HTML file that loads reveal.js from a CDN. */
export function standaloneHtml(title, slides) {
  const v = '5.1.0'
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@${v}/dist/reveal.css">
<style>html,body{background:#222}${PLAYER_CSS}</style>
</head><body>
<div class="reveal"><div class="slides">
${slides.map((s) => slideMarkup(s.layers)).join('\n')}
</div></div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@${v}/dist/reveal.js"></script>
<script>Reveal.initialize(${JSON.stringify({ ...REVEAL_OPTIONS, hash: true })});</script>
</body></html>
`
}
