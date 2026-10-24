// Stepboard Player page: open a .stepboard.json deck and present it. No editor involved.
// A deck can also be opened from the same server with ?deck=lecture-1.stepboard.json
import 'reveal.js/dist/reveal.css'
import { present, PLAYER_CSS, PLAYER_UI_CSS } from './player.js'
import { parseDeckText, DECK_FILE_ACCEPT } from './deckfile.js'

const style = document.createElement('style')
style.textContent = PLAYER_CSS + PLAYER_UI_CSS
document.head.append(style)

const $ = (id) => document.getElementById(id)
$('file').accept = DECK_FILE_ACCEPT
let slides = null
let title = ''

function show(deck, source) {
  if (deck?.format === 'stepboard-import') {
    setError('This is a converted Keynote file, which the editor still has to turn into slides. Open it in the editor (Open file), then use Save file there, and open the saved .stepboard.json here.')
    $('open-editor').hidden = false
    return
  }
  if (deck?.format !== 'stepboard-deck' || !Array.isArray(deck.slides)) {
    setError('That file is not a Stepboard deck.')
    return
  }
  slides = deck.slides.map((s) => ({ layers: s.layers || [] }))
  title = deck.name || 'Untitled deck'
  const builds = slides.reduce((n, s) => n + new Set(s.layers.filter((l) => l.in > 0).map((l) => l.in)).size, 0)
  const missing = slides.filter((s) => !s.layers.length).length
  $('deck-name').textContent = title
  $('deck-meta').textContent = `${slides.length} slide${slides.length === 1 ? '' : 's'} · ${builds} build${builds === 1 ? '' : 's'}${source ? ` · ${source}` : ''}`
  $('deck-warn').hidden = missing === 0
  $('deck-warn').textContent = missing ? `${missing} slide${missing === 1 ? ' is' : 's are'} blank. Open the deck in the editor and save it again to refresh the slide pictures.` : ''
  $('loaded').hidden = false
  $('error').hidden = true
  $('open-editor').hidden = true
  document.title = `${title} · Stepboard Player`
}

function setError(msg) { $('error').textContent = msg; $('error').hidden = false }

async function readFile(file) {
  let deck
  try { deck = parseDeckText(await file.text()) } catch (e) { setError(e.message); return }
  show(deck, file.name)
}

$('file').addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) readFile(f) })
const drop = $('drop')
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over') })
drop.addEventListener('dragleave', () => drop.classList.remove('over'))
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files?.[0]; if (f) readFile(f) })

$('present').addEventListener('click', () => {
  if (!slides) return
  const stage = $('stage')
  stage.hidden = false
  stage.requestFullscreen?.().catch(() => {})
  present(stage, slides, 0, () => {
    stage.hidden = true
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  })
})

const param = new URLSearchParams(location.search).get('deck')
if (param) {
  fetch(param).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((t) => show(parseDeckText(t), param))
    .catch((e) => setError(`Could not load ${param} (${e.message}). Check the file name and that it sits on this server.`))
}
