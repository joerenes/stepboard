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
  transition: 'none', backgroundTransition: 'none', controls: false, progress: true, slideNumber: 'c/t',
  keyboard: false, touch: false, // navigation is handled below
}

export const PLAYER_UI_CSS = `
.sb-close { position: absolute; z-index: 20; top: calc(10px + env(safe-area-inset-top, 0px)); right: calc(10px + env(safe-area-inset-right, 0px));
  font: 700 13px system-ui, -apple-system, sans-serif; color: #e3e9e1; background: #1b1e1fcc; border: 1px solid #4a5558; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
.sb-hint { position: absolute; z-index: 20; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
  font: 13px system-ui, -apple-system, sans-serif; color: #e3e9e1; background: #1b1e1fd9; border-radius: 6px; padding: 7px 12px;
  white-space: nowrap; pointer-events: none; transition: opacity .4s; }
.sb-hint.gone { opacity: 0; }
`

/**
 * Present slides in `container`.
 * Right / Space / Page Down / tap: next build (then next slide).  Left / Page Up / tap on the left edge: previous build.
 * Down / Up (or swipe up / down): next / previous slide, returning to the build state you left it in.
 * Returns a function that closes the player.
 */
export function present(container, slides, startIndex = 0, onClose) {
  container.innerHTML = `<div class="reveal"><div class="slides">${slides.map((s) => slideMarkup(s.layers)).join('')}</div></div>
    ${onClose ? '<button type="button" class="sb-close" aria-label="Close presentation">Close</button>' : ''}
    <div class="sb-hint" role="note">→ next build · ← back · ↓ ↑ change slide</div>`
  const el = container.querySelector('.reveal')
  const deck = new Reveal(el, { ...REVEAL_OPTIONS, embedded: true })
  const memory = new Map() // slide index -> last shown build (-1 = none)
  let closed = false

  const remember = () => { const { h, f } = deck.getIndices(); memory.set(h, f ?? -1) }
  const total = () => deck.getTotalSlides()
  const goSlide = (i) => {
    if (i < 0 || i >= total()) return
    deck.slide(i, 0, memory.has(i) ? memory.get(i) : -1)
  }
  const nextBuild = () => { if (deck.availableFragments().next) deck.nextFragment(); else goSlide(deck.getIndices().h + 1) }
  const prevBuild = () => { if (deck.availableFragments().prev) deck.prevFragment(); else goSlide(deck.getIndices().h - 1) }

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key
    let handled = true
    if (k === 'ArrowRight' || k === ' ' || k === 'PageDown' || k === 'n') nextBuild()
    else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'p') prevBuild()
    else if (k === 'ArrowDown') goSlide(deck.getIndices().h + 1)
    else if (k === 'ArrowUp') goSlide(deck.getIndices().h - 1)
    else if (k === 'Home') goSlide(0)
    else if (k === 'End') goSlide(total() - 1)
    else if (k === 'f') { const d = document; d.fullscreenElement ? d.exitFullscreen?.() : container.requestFullscreen?.().catch(() => {}) }
    else if ((k === 'Escape' || k === 'q') && onClose) close()
    else handled = false
    if (handled) { e.preventDefault(); e.stopPropagation() }
  }

  // Touch / Pencil: tap = next build (left fifth = back), swipe left/right = builds, swipe up/down = slides.
  let down = null
  const onDown = (e) => { if (!e.target.closest('button')) down = { x: e.clientX, y: e.clientY } }
  const onUp = (e) => {
    if (!down) return
    const dx = e.clientX - down.x, dy = e.clientY - down.y
    down = null
    const dist = Math.hypot(dx, dy)
    if (dist < 12) {
      const r = el.getBoundingClientRect()
      if (e.clientX - r.left < r.width / 5) prevBuild(); else nextBuild()
    } else if (dist > 40) {
      if (Math.abs(dx) > Math.abs(dy)) (dx < 0 ? nextBuild : prevBuild)()
      else goSlide(deck.getIndices().h + (dy < 0 ? 1 : -1))
    }
  }

  function close() {
    if (closed) return
    closed = true
    window.removeEventListener('keydown', onKey, true)
    try { deck.destroy() } catch {}
    container.innerHTML = ''
    onClose && onClose()
  }

  window.addEventListener('keydown', onKey, true)
  el.addEventListener('pointerdown', onDown)
  el.addEventListener('pointerup', onUp)
  el.style.touchAction = 'none'
  container.querySelector('.sb-close')?.addEventListener('click', close)
  setTimeout(() => container.querySelector('.sb-hint')?.classList.add('gone'), 3500)

  deck.initialize().then(() => {
    for (const ev of ['slidechanged', 'fragmentshown', 'fragmenthidden']) deck.on(ev, remember)
    deck.slide(Math.min(Math.max(0, startIndex), total() - 1), 0, -1)
    remember()
  })
  return close
}
