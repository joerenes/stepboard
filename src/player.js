// Player: turns cached slide layers into reveal.js slides with fragments.
// Layer at step 0 is plain; a later "in" becomes a fragment; an "out" nests a fade-out fragment inside.
import Reveal from 'reveal.js'
import { SLIDE_W, SLIDE_H } from './model.js'

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const svgUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

export function slideMarkup(layers) {
  const parts = layers.map((l) => {
    // SVGs go in <img> so their internal ids and styles can't collide between layers. They use data-src, so
    // reveal.js only decodes the slides near the current one (its lazy loading), which keeps big decks quick.
    let inner = `<div class="sb-layer"><img alt="" draggable="false" data-src="${svgUrl(l.svg)}"></div>`
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
.sb-top { position: absolute; z-index: 20; top: calc(10px + env(safe-area-inset-top, 0px)); right: calc(10px + env(safe-area-inset-right, 0px));
  display: flex; gap: 6px; opacity: 0; pointer-events: none; transition: opacity .2s; }
.sb-top button { font: 700 13px system-ui, -apple-system, sans-serif; color: #e3e9e1; background: #1b1e1fcc; border: 1px solid #4a5558;
  border-radius: 6px; padding: 6px 12px; cursor: pointer; }
.sb-top button:focus-visible { outline: 2px solid #7fb8d4; outline-offset: 2px; }
.sb-show-top .sb-top, .sb-top:focus-within { opacity: 1; pointer-events: auto; }
.sb-print-menu { position: absolute; z-index: 20; left: calc(10px + env(safe-area-inset-left, 0px)); bottom: calc(14px + env(safe-area-inset-bottom, 0px));
  display: flex; align-items: center; gap: 6px; opacity: 0; pointer-events: none; transition: opacity .2s;
  font: 13px system-ui, -apple-system, sans-serif; color: #93a39d; background: #1b1e1fd9; border-radius: 8px; padding: 5px 6px 5px 10px; }
.sb-print-menu button { font: 700 13px system-ui, -apple-system, sans-serif; color: #e3e9e1; background: transparent; border: 1px solid #4a5558;
  border-radius: 6px; padding: 5px 10px; cursor: pointer; }
.sb-print-menu button:focus-visible { outline: 2px solid #7fb8d4; outline-offset: 2px; }
.sb-show-print .sb-print-menu, .sb-print-menu:focus-within { opacity: 1; pointer-events: auto; }
/* Slide number only when the pointer is in the lower-right corner (or after a tap there). */
.reveal .slide-number { opacity: 0; transition: opacity .2s; }
.sb-show-number .reveal .slide-number { opacity: 1; }
.sb-overview { position: absolute; inset: 0; z-index: 40; overflow-y: auto; background: #1b1e1f; -webkit-overflow-scrolling: touch;
  padding-block: calc(24px + env(safe-area-inset-top, 0px)) 40px; }
.sb-ov-list { display: flex; flex-direction: column; align-items: center; gap: 22px; margin: 0; padding: 0 16px; list-style: none; }
.sb-ov-list > li { width: min(920px, 100%); }
.sb-ov-item { display: grid; grid-template-columns: 2.5em minmax(0, 1fr); align-items: start; gap: 10px; width: 100%;
  background: none; border: 0; padding: 0; cursor: pointer; color: #93a39d; font: 600 15px ui-monospace, Menlo, monospace; text-align: right; }
.sb-ov-board { position: relative; aspect-ratio: 16 / 9; background: #fff; border-radius: 3px; overflow: hidden; outline: 3px solid transparent; outline-offset: 3px; }
.sb-ov-board img { position: absolute; inset: 0; width: 100%; height: 100%; max-width: none; }
.sb-ov-item.current .sb-ov-board { outline-color: #7fb8d4; }
.sb-ov-item.current { color: #e3e9e1; }
.sb-ov-item:focus-visible .sb-ov-board { outline-color: #e3e9e1; }
.sb-ov-head { position: sticky; top: 0; display: flex; justify-content: space-between; align-items: center; width: min(920px, 100%);
  margin: 0 auto 14px; padding: 8px 16px; box-sizing: border-box; color: #93a39d; font: 13px system-ui, -apple-system, sans-serif;
  background: #1b1e1f; z-index: 1; }
.sb-ov-item:focus { outline: none; }
.sb-hint { position: absolute; z-index: 20; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
  font: 13px system-ui, -apple-system, sans-serif; color: #e3e9e1; background: #1b1e1fd9; border-radius: 6px; padding: 7px 12px;
  white-space: nowrap; pointer-events: none; transition: opacity .4s; }
.sb-hint.gone { opacity: 0; }
.sb-laser { position: absolute; z-index: 30; left: 0; top: 0; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%;
  background: radial-gradient(circle, #fff 0 18%, #ff2a1a 32%, rgb(255 42 26 / .55) 55%, rgb(255 42 26 / 0) 72%);
  box-shadow: 0 0 14px 4px rgb(255 42 26 / .45); pointer-events: none; opacity: 0; transition: opacity .25s; will-change: transform; }
.sb-laser.on { opacity: 1; transition: opacity .05s; }
.sb-laser-mode, .sb-laser-mode * { cursor: none !important; }
`

/**
 * Present slides in `container`.
 * Right / Space / Page Down / tap: next build (then next slide).  Left / Page Up / tap on the left edge: previous build.
 * Down / Up (or swipe up / down): next / previous slide, returning to the build state you left it in.
 * Returns a function that closes the player.
 */
export function present(container, slides, startIndex = 0, onClose) {
  container.innerHTML = `<div class="reveal"><div class="slides">${slides.map((s) => slideMarkup(s.layers)).join('')}</div></div>
    <div class="sb-top">
      <button type="button" class="sb-ov-btn" aria-label="Slide overview">Overview</button>
      ${onClose ? '<button type="button" class="sb-close" aria-label="Close presentation">Close</button>' : ''}
    </div>
    <div class="sb-print-menu" role="group" aria-label="Print or save as PDF">
      <span>Print / PDF</span>
      <button type="button" data-print="slides">One page per slide</button>
      <button type="button" data-print="builds">One page per build</button>
    </div>
    <div class="sb-hint" role="note">→ next build · ← back · ↓ ↑ change slide · O overview · Pencil or L = laser pointer</div>
    <div class="sb-laser" aria-hidden="true"></div>`
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

  // ----- corner controls: shown only while the pointer is in that corner -----
  const timers = {}
  const flash = (cls, ms) => {
    container.classList.add(cls)
    clearTimeout(timers[cls])
    timers[cls] = setTimeout(() => container.classList.remove(cls), ms)
  }
  const CORNER_CLASS = { top: 'sb-show-top', bottom: 'sb-show-number', left: 'sb-show-print' }
  const corner = (e) => {
    const r = container.getBoundingClientRect()
    const w = Math.min(260, r.width * 0.22)
    const right = e.clientX > r.right - w
    const left = e.clientX < r.left + w
    if (right && e.clientY < r.top + Math.min(140, r.height * 0.18)) return 'top'
    if (right && e.clientY > r.bottom - Math.min(120, r.height * 0.15)) return 'bottom'
    if (left && e.clientY > r.bottom - Math.min(120, r.height * 0.15)) return 'left'
    return null
  }
  const onHover = (e) => {
    if (e.pointerType !== 'mouse') return
    const c = corner(e)
    if (c) flash(CORNER_CLASS[c], 1500)
  }

  // ----- print / save as PDF: one page per slide (final build stage) or one page per build stage -----
  let printing = false
  const printDeck = async (mode) => {
    if (printing) return
    printing = true
    if (document.fullscreenElement) await document.exitFullscreen?.().catch(() => {})
    const pages = []
    for (const s of slides) {
      const last = s.layers.reduce((m, l) => Math.max(m, l.in, l.out ?? 0), 0)
      const steps = mode === 'builds' ? Array.from({ length: last + 1 }, (_, i) => i) : [last]
      for (const step of steps) {
        const vis = s.layers.filter((l) => l.in <= step && (l.out === undefined || step < l.out))
        pages.push(`<div class="sb-print-page">${vis.map((l) => `<img alt="" src="${svgUrl(l.svg)}">`).join('')}</div>`)
      }
    }
    const sheet = document.createElement('div')
    sheet.className = 'sb-print-sheet'
    sheet.innerHTML = pages.join('')
    const style = document.createElement('style')
    style.textContent = `
      @page { size: 16in 9in; margin: 0; }
      .sb-print-sheet { display: none; }
      @media print {
        html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
        body > *:not(.sb-print-sheet) { display: none !important; }
        .sb-print-sheet { display: block; }
        .sb-print-page { position: relative; width: 16in; height: 9in; overflow: hidden; background: #fff;
          break-after: page; page-break-after: always; }
        .sb-print-page:last-child { break-after: auto; page-break-after: auto; }
        .sb-print-page img { position: absolute; inset: 0; width: 100%; height: 100%; max-width: none; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }`
    document.body.append(style, sheet)
    // Wait until every page picture is decoded, or the print preview can come out blank.
    await Promise.all([...sheet.querySelectorAll('img')].map((img) => img.decode().catch(() => {})))
    const cleanup = () => { sheet.remove(); style.remove(); printing = false; window.removeEventListener('afterprint', cleanup) }
    window.addEventListener('afterprint', cleanup)
    window.print()
    setTimeout(() => { if (printing) cleanup() }, 60000) // in case a browser never fires afterprint
  }

  // ----- overview: every slide at its final build stage, in one scrolling column -----
  let overview = null
  const finalLayers = (layers) => layers.filter((l) => l.out === undefined)
  const openOverview = () => {
    if (overview) return
    const cur = deck.getIndices().h
    overview = document.createElement('div')
    overview.className = 'sb-overview'
    overview.setAttribute('role', 'dialog')
    overview.setAttribute('aria-label', 'Slide overview')
    overview.innerHTML = `<div class="sb-ov-head"><span>${slides.length} slides · tap one to go there · O to return</span></div>
      <ol class="sb-ov-list">${slides.map((s, i) => `<li><button type="button" class="sb-ov-item${i === cur ? ' current' : ''}" data-i="${i}">
        <span>${i + 1}</span><div class="sb-ov-board">${finalLayers(s.layers).map((l) => `<img alt="" loading="lazy" decoding="async" src="${svgUrl(l.svg)}">`).join('')}</div>
      </button></li>`).join('')}</ol>`
    overview.addEventListener('click', (e) => {
      const b = e.target.closest('.sb-ov-item')
      if (!b) return
      closeOverview()
      goSlide(Number(b.dataset.i))
    })
    container.append(overview)
    const curEl = overview.querySelector('.sb-ov-item.current')
    curEl?.scrollIntoView({ block: 'center' })
    curEl?.focus({ preventScroll: true })
  }
  const closeOverview = () => { overview?.remove(); overview = null }
  const toggleOverview = () => (overview ? closeOverview() : openOverview())

  const onOverviewKey = (e) => {
    const k = e.key
    const items = [...overview.querySelectorAll('.sb-ov-item')]
    const at = Math.max(0, items.indexOf(document.activeElement))
    if (k === 'Escape') return // left to the browser, which uses it to leave full screen
    if (k === 'o' || k === 'O') closeOverview()
    else if (k === 'ArrowDown' || k === 'ArrowRight') items[Math.min(items.length - 1, at + 1)].focus()
    else if (k === 'ArrowUp' || k === 'ArrowLeft') items[Math.max(0, at - 1)].focus()
    else if (k === 'Enter' || k === ' ') { closeOverview(); goSlide(at) }
    else return
    e.preventDefault(); e.stopPropagation()
  }

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (overview) { onOverviewKey(e); return }
    const k = e.key
    let handled = true
    if (k === 'o' || k === 'O') openOverview()
    else if (k === 'ArrowRight' || k === ' ' || k === 'PageDown' || k === 'n') nextBuild()
    else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'p') prevBuild()
    else if (k === 'ArrowDown') goSlide(deck.getIndices().h + 1)
    else if (k === 'ArrowUp') goSlide(deck.getIndices().h - 1)
    else if (k === 'Home') goSlide(0)
    else if (k === 'End') goSlide(total() - 1)
    else if (k === 'l' || k === 'L') toggleLaser()
    else if (k === 'f') { const d = document; d.fullscreenElement ? d.exitFullscreen?.() : container.requestFullscreen?.().catch(() => {}) }
    else if ((k === 'Escape' || k === 'q') && onClose) close()
    else handled = false
    if (handled) { e.preventDefault(); e.stopPropagation() }
  }

  // Laser pointer. The Pencil always points (touching, or hovering on iPads that support Pencil hover) and never
  // navigates. The mouse points when laser mode is on (L key), e.g. with an "air mouse" presenter remote.
  const laser = container.querySelector('.sb-laser')
  let laserMode = false
  let penDown = false
  let fadeTimer = null
  const laserAt = (e) => {
    const r = container.getBoundingClientRect()
    laser.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`
    laser.classList.add('on')
    clearTimeout(fadeTimer)
    if (!penDown) fadeTimer = setTimeout(() => laser.classList.remove('on'), e.pointerType === 'mouse' ? 2500 : 600)
  }
  const laserOff = () => { clearTimeout(fadeTimer); fadeTimer = setTimeout(() => laser.classList.remove('on'), 250) }
  const toggleLaser = () => {
    laserMode = !laserMode
    container.classList.toggle('sb-laser-mode', laserMode)
    if (!laserMode) laser.classList.remove('on')
  }
  const onMove = (e) => {
    if (e.pointerType === 'pen') laserAt(e)
    else if (e.pointerType === 'mouse' && laserMode) laserAt(e)
  }

  // Finger / mouse: tap = next build (left fifth = back), swipe left/right = builds, swipe up/down = slides.
  let down = null
  const onDown = (e) => {
    if (e.target.closest('button')) return
    if (e.pointerType === 'pen') { penDown = true; laserAt(e); return }
    down = { x: e.clientX, y: e.clientY }
  }
  const onUp = (e) => {
    if (e.pointerType === 'pen') { penDown = false; laserOff(); return }
    if (!down) return
    const dx = e.clientX - down.x, dy = e.clientY - down.y
    down = null
    const dist = Math.hypot(dx, dy)
    if (dist < 12) {
      // A tap in the upper- or lower-right corner shows the controls or the slide number instead of advancing.
      const c = corner(e)
      if (c === 'top') { flash('sb-show-top', 4000); return }
      if (c === 'bottom') { flash('sb-show-number', 3000); return }
      if (c === 'left') { flash('sb-show-print', 4000); return }
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
    Object.values(timers).forEach(clearTimeout)
    try { deck.destroy() } catch {}
    container.innerHTML = ''
    onClose && onClose()
  }

  window.addEventListener('keydown', onKey, true)
  el.addEventListener('pointerdown', onDown)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', (e) => { if (e.pointerType === 'pen') { penDown = false; laserOff() } down = null })
  container.addEventListener('pointermove', onMove)
  container.addEventListener('pointermove', onHover)
  container.querySelector('.sb-ov-btn').addEventListener('click', openOverview)
  container.querySelectorAll('[data-print]').forEach((b) => b.addEventListener('click', () => printDeck(b.dataset.print)))
  container.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'pen' || !penDown) laser.classList.remove('on') })
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
