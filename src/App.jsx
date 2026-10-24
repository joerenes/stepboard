// Stepboard editor: tldraw 3.15.6 + slides (pages) + build steps (shape.meta.in / meta.out).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Tldraw, atom, useValue, getSnapshot, loadSnapshot, PageRecordType, getIndexBetween,
  DefaultToolbar, DefaultToolbarContent, TldrawUiMenuItem, useTools, useIsToolSelected,
} from 'tldraw'
import { LassoTool, LassoOverlay, LassoIcon } from './lasso.jsx'
import { getAssetUrls } from '@tldraw/assets/selfHosted'
import 'tldraw/tldraw.css'
import 'reveal.js/dist/reveal.css'
import {
  SLIDE_W, SLIDE_H, inOf, outOf, visibleAt, rangeOf, lastStep, stepSummary,
  setIn, setOut, clearOut, mapSteps, insertAfter, removeStep, swapSteps,
} from './model.js'
import { renderPage, SLIDE_BOX } from './render.js'
import { present, layerPicture, PLAYER_CSS, PLAYER_UI_CSS } from './player.js'
import { standaloneHtml } from './export.js'
import { parseDeckText, DECK_FILE_ACCEPT } from './deckfile.js'
import { buildFromImport, IMPORT_FORMAT } from './importer.js'
import { loadDeck, saveDeck } from './storage.js'

const assetUrls = getAssetUrls({ baseUrl: './assets' })
const FORMAT = 'stepboard-deck'

// ---------- shared reactive state ----------
const stepsAtom = atom('steps', {})         // pageId -> current step
const viewAtom = atom('view', 'ghost')       // 'ghost' | 'audience' | 'all'

// Pen width: a multiplier on tldraw's stroke width for new pen strokes, stored per shape in props.scale
// (the same prop tldraw's "dynamic size" uses), so it survives saving, export and presenting.
const PEN_WIDTHS = [[0.3, 'Fine'], [0.45, 'Thin'], [0.65, 'Medium'], [1, 'tldraw']]
const readPenWidth = () => { try { const v = parseFloat(localStorage.getItem('stepboard.penWidth')); return PEN_WIDTHS.some(([w]) => w === v) ? v : 0.45 } catch { return 0.45 } }
const penWidthAtom = atom('pen width', readPenWidth())
const setPenWidth = (v) => { penWidthAtom.set(v); try { localStorage.setItem('stepboard.penWidth', String(v)) } catch {} }
const isFreshStroke = (shape) => (shape.type === 'draw' || shape.type === 'highlight') && !shape.props?.isComplete &&
  shape.props?.segments?.length === 1 && shape.props.segments[0].points?.length === 1

const stepOf = (editor, pageId = editor.getCurrentPageId()) => stepsAtom.get()[pageId] ?? 0
const setStep = (pageId, s) => stepsAtom.update((m) => ({ ...m, [pageId]: Math.max(0, s) }))

// Audience view hides what the audience would not see at the current step.
function getShapeVisibility(shape, editor) {
  if (viewAtom.get() !== 'audience') return 'inherit'
  if (shape.parentId !== editor.getCurrentPageId()) return 'inherit' // children follow their top-level shape
  return visibleAt({ in: inOf(shape), out: outOf(shape) }, stepOf(editor)) ? 'inherit' : 'hidden'
}

// ---------- on-canvas pieces ----------
function OnTheCanvas() {
  return (
    <div className="sb-slide-frame" style={{ width: SLIDE_W, height: SLIDE_H }} aria-hidden="true">
      <span>16 : 9 · {SLIDE_W} × {SLIDE_H}</span>
    </div>
  )
}

function OnTheCanvasAll() {
  return <><OnTheCanvas /><LassoOverlay /></>
}

// Toolbar: the lasso comes first, then tldraw's usual tools.
function Toolbar(props) {
  const tools = useTools()
  const lassoSelected = useIsToolSelected(tools.lasso)
  return (
    <DefaultToolbar {...props}>
      <TldrawUiMenuItem {...tools.lasso} isSelected={lassoSelected} />
      <DefaultToolbarContent />
    </DefaultToolbar>
  )
}

const uiOverrides = {
  tools(editor, tools) {
    tools.lasso = { id: 'lasso', label: 'tool.lasso', icon: LassoIcon, onSelect: () => editor.setCurrentTool('lasso') }
    return tools
  },
  translations: { en: { 'tool.lasso': 'Lasso select' } },
}
const tldrawTools = [LassoTool]
const tldrawComponents = { PageMenu: null, OnTheCanvas: OnTheCanvasAll, Toolbar }

function GhostStyle({ editor }) {
  const css = useValue('ghost-css', () => {
    if (!editor || viewAtom.get() !== 'ghost') return ''
    const step = stepOf(editor)
    const shapes = editor.getCurrentPageShapes()
    const byId = new Map(shapes.map((s) => [s.id, s]))
    const sel = []
    for (const s of shapes) if (!visibleAt(rangeOf(s, byId), step)) sel.push(`.tl-shape[data-shape-id="${s.id}"]`)
    return sel.length ? `${sel.join(',')}{filter:opacity(0.18) grayscale(1)}` : ''
  }, [editor])
  return <style>{css}</style>
}

// ---------- helpers ----------
function topShapes(editor, pageId = editor.getCurrentPageId()) {
  return editor.getSortedChildIdsForParent(pageId).map((id) => editor.getShape(id)).filter(Boolean)
}

function updateMeta(editor, shapes, fn) {
  const partials = []
  for (const s of shapes) {
    const meta = fn(s.meta || {})
    if (meta) partials.push({ id: s.id, type: s.type, meta })
  }
  if (partials.length) editor.updateShapes(partials)
  return partials.length
}

function fmtTime(d) { return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }

// A normal browser download. On the iPad, Safari asks to download and the file lands in Files > Downloads.
// If the browser refuses, the contents are shown for copying instead.
async function offerFile(filename, data, fallback) {
  try {
    const blob = new Blob([data], { type: filename.endsWith('.html') ? 'text/html' : 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.style.display = 'none'
    document.body.append(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
    return 'saved'
  } catch {}
  fallback(filename, data)
  return 'fallback'
}

// ---------- step bar ----------
function StepBar({ editor }) {
  const pageId = useValue('page', () => editor.getCurrentPageId(), [editor])
  const step = useValue('step', () => stepOf(editor), [editor])
  const view = useValue('view', () => viewAtom.get(), [])
  const last = useValue('last', () => lastStep(topShapes(editor)), [editor])
  const selected = useValue('sel', () => editor.getSelectedShapes().filter((s) => s.parentId === editor.getCurrentPageId()), [editor])
  const [msg, setMsg] = useState('')
  const max = Math.max(last, step)

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 2600); return () => clearTimeout(t) }, [msg])

  const go = (s) => setStep(pageId, Math.min(Math.max(0, s), max))
  const newStep = () => {
    if (step < last) updateMeta(editor, topShapes(editor), (m) => mapSteps(m, insertAfter(step)))
    setStep(pageId, step + 1)
    editor.setCurrentTool('draw')
  }
  const appearHere = () => { updateMeta(editor, selected, (m) => setIn(m, step)); setMsg(`Appears at step ${step}`) }
  const hideHere = () => {
    if (step === 0) { setMsg('Go to a later step first, then hide from there.'); return }
    const n = updateMeta(editor, selected, (m) => setOut(m, step))
    setMsg(n ? `Disappears at step ${step}` : 'These appear at this step or later. Hide them from a later step.')
  }
  const showAgain = () => { updateMeta(editor, selected, clearOut); setMsg('Stays visible to the end') }

  const selRange = selected.length
    ? (() => {
        const ins = new Set(selected.map(inOf)), outs = new Set(selected.map(outOf))
        if (ins.size > 1 || outs.size > 1) return 'mixed steps'
        const [i] = ins, [o] = outs
        return o === undefined ? `from step ${i}` : `steps ${i}–${o - 1}`
      })()
    : ''
  const hasOut = selected.some((s) => outOf(s) !== undefined)
  const penWidth = useValue('pen width', () => penWidthAtom.get(), [])
  const strokes = useValue('sel strokes', () => editor.getSelectedShapes().flatMap((s) =>
    s.type === 'group' ? editor.getSortedChildIdsForParent(s.id).map((id) => editor.getShape(id)) : [s]
  ).filter((s) => s && (s.type === 'draw' || s.type === 'highlight')), [editor])
  const reweight = (f) => editor.updateShapes(strokes.map((s) => ({ id: s.id, type: s.type, props: { scale: Math.max(0.05, s.props.scale * f) } })))
  const selectStep = () => {
    const ids = topShapes(editor).filter((s) => inOf(s) === step).map((s) => s.id)
    editor.setCurrentTool('select')
    editor.setSelectedShapes(ids)
    if (!ids.length) setMsg(`Nothing appears at step ${step}`)
  }

  return (
    <div className="sb-stepbar">
      <div className="sb-stepper" role="group" aria-label="Build step">
        <button type="button" onClick={() => go(step - 1)} disabled={step === 0} aria-label="Previous step">‹</button>
        <span className="sb-step-label">Step <b>{step}</b><small> of {max}</small></span>
        <button type="button" onClick={() => go(step + 1)} disabled={step >= max} aria-label="Next step">›</button>
        <button type="button" className="primary" onClick={newStep}>New step</button>
        {selected.length === 0 && <button type="button" onClick={selectStep}>Select step</button>}
      </div>

      <div className="sb-seg" role="radiogroup" aria-label="Board view">
        {[['ghost', 'Ghost'], ['audience', 'Audience'], ['all', 'All']].map(([v, label]) => (
          <button key={v} type="button" role="radio" aria-checked={view === v} className={view === v ? 'on' : ''} onClick={() => viewAtom.set(v)}>{label}</button>
        ))}
      </div>

      {selected.length > 0 && (
        <div className="sb-selection">
          <span className="sb-sel-info">{selected.length} selected · {selRange}</span>
          <button type="button" onClick={appearHere}>Appear here</button>
          <button type="button" onClick={hideHere}>Hide from here</button>
          {hasOut && <button type="button" onClick={showAgain}>Keep visible</button>}
          {strokes.length > 0 && <>
            <span className="sb-sel-info">Width</span>
            <button type="button" className="sb-icon" onClick={() => reweight(0.8)} aria-label="Make selected strokes thinner">−</button>
            <button type="button" className="sb-icon" onClick={() => reweight(1.25)} aria-label="Make selected strokes thicker">+</button>
          </>}
        </div>
      )}
      <label className="sb-pen">Pen
        <select id="pen-width" value={penWidth} onChange={(e) => setPenWidth(parseFloat(e.target.value))}>
          {PEN_WIDTHS.map(([w, label]) => <option key={w} value={w}>{label}</option>)}
        </select>
      </label>
      <button type="button" className="sb-fit" onClick={() => editor.zoomToBounds(SLIDE_BOX, { inset: 24, animation: { duration: 200 } })} aria-label="Fit slide">Fit</button>
      {msg && <span className="sb-toast" role="status">{msg}</span>}
    </div>
  )
}

// ---------- sidebar ----------
// Image sources by asset id, straight from the editor's store.
const editorAssets = (editor) => Object.fromEntries(editor.getAssets().filter((a) => a.props?.src).map((a) => [a.id, a.props.src]))

function Thumb({ layers, assets }) {
  const html = (layers || []).map((l) => `<div class="sb-layer">${layerPicture(l, assets, false)}</div>`).join('')
  return <div className="sb-thumb" dangerouslySetInnerHTML={{ __html: html }} />
}

function Sidebar({ editor, cache }) {
  const pages = useValue('pages', () => editor.getPages(), [editor])
  const currentId = useValue('page', () => editor.getCurrentPageId(), [editor])
  const step = useValue('step', () => stepOf(editor), [editor])
  const tops = useValue('tops', () => topShapes(editor), [editor])
  const assets = useMemo(() => editorAssets(editor), [editor, cache])
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => setConfirmDelete(false), [currentId])

  const max = Math.max(lastStep(tops), step)
  const rows = stepSummary(tops, max)
  const idx = pages.findIndex((p) => p.id === currentId)

  const addSlide = () => {
    const id = PageRecordType.createId()
    const above = pages[idx + 1]?.index
    editor.createPage({ id, name: `Slide ${pages.length + 1}`, index: getIndexBetween(pages[idx].index, above) })
    editor.setCurrentPage(id)
  }
  const duplicate = () => {
    const id = PageRecordType.createId()
    editor.duplicatePage(currentId, id)
    editor.setCurrentPage(id)
  }
  const move = (dir) => {
    const j = idx + dir
    if (j < 0 || j >= pages.length) return
    const [a, b] = dir < 0 ? [pages[j - 1]?.index, pages[j].index] : [pages[j].index, pages[j + 1]?.index]
    editor.updatePage({ id: currentId, index: getIndexBetween(a, b) })
  }
  const remove = () => {
    if (pages.length < 2) return
    if (!confirmDelete) { setConfirmDelete(true); return }
    const next = pages[idx + 1] || pages[idx - 1]
    editor.setCurrentPage(next.id)
    editor.deletePage(currentId)
  }

  const stepOp = (fn, nextStep) => { updateMeta(editor, tops, (m) => mapSteps(m, fn)); setStep(currentId, nextStep) }

  return (
    <aside className="sb-sidebar">
      <section className="sb-slides" aria-label="Slides">
        <h2>Slides</h2>
        <ol>
          {pages.map((p, i) => (
            <li key={p.id}>
              <button type="button" className={p.id === currentId ? 'sb-slide on' : 'sb-slide'} onClick={() => editor.setCurrentPage(p.id)} aria-current={p.id === currentId}>
                <span className="sb-num">{i + 1}</span>
                <Thumb layers={cache[p.id]} assets={assets} />
              </button>
            </li>
          ))}
        </ol>
        <div className="sb-row">
          <button type="button" onClick={addSlide}>Add</button>
          <button type="button" onClick={duplicate}>Duplicate</button>
          <button type="button" onClick={() => move(-1)} disabled={idx === 0} aria-label="Move slide up">↑</button>
          <button type="button" onClick={() => move(1)} disabled={idx === pages.length - 1} aria-label="Move slide down">↓</button>
          <button type="button" className={confirmDelete ? 'danger' : ''} onClick={remove} disabled={pages.length < 2}>{confirmDelete ? 'Confirm' : 'Delete'}</button>
        </div>
      </section>

      <section className="sb-steps" aria-label="Build steps">
        <h2>Builds on this slide</h2>
        <ol>
          {rows.map((r) => (
            <li key={r.step}>
              <button type="button" className={r.step === step ? 'sb-steprow on' : 'sb-steprow'} onClick={() => setStep(currentId, r.step)}>
                <span>{r.step === 0 ? 'Start' : `Step ${r.step}`}</span>
                <span className="sb-counts">
                  {r.appear > 0 && <span className="plus">+{r.appear}</span>}
                  {r.disappear > 0 && <span className="minus">−{r.disappear}</span>}
                  {r.appear === 0 && r.disappear === 0 && <span className="empty">empty</span>}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="sb-row">
          <button type="button" onClick={() => stepOp(swapSteps(step - 1, step), step - 1)} disabled={step < 2} aria-label="Move this step earlier">Earlier</button>
          <button type="button" onClick={() => stepOp(swapSteps(step, step + 1), step + 1)} disabled={step < 1 || step >= max} aria-label="Move this step later">Later</button>
          <button type="button" onClick={() => stepOp(removeStep(step), step - 1)} disabled={step < 1}>Merge into previous</button>
        </div>
      </section>
    </aside>
  )
}

// ---------- dialogs ----------
function TextDialog({ data, onClose }) {
  const ref = useRef(null)
  const [label, setLabel] = useState('Copy')
  useEffect(() => { ref.current?.showModal() }, [])
  const copy = async () => {
    try { await navigator.clipboard.writeText(data.text); setLabel('Copied') }
    catch { const ta = ref.current.querySelector('textarea'); ta.focus(); ta.select(); setLabel('Selected, copy manually') }
  }
  return (
    <dialog ref={ref} className="sb-dialog" onClose={onClose}>
      <h2>{data.filename}</h2>
      <p>This browser didn't allow the download. Copy the text and save it as <b>{data.filename}</b>.</p>
      <textarea readOnly value={data.text} spellCheck="false" aria-label="File contents" />
      <div className="sb-row end"><button type="button" className="primary" onClick={copy}>{label}</button><button type="button" onClick={() => ref.current.close()}>Close</button></div>
    </dialog>
  )
}

function ImportDialog({ onFile, onClose }) {
  const ref = useRef(null)
  const [err, setErr] = useState('')
  useEffect(() => { ref.current?.showModal() }, [])
  return (
    <dialog ref={ref} className="sb-dialog" onClose={onClose}>
      <h2>Open a deck file</h2>
      <p>Choose a Stepboard deck (.stepboard.json), a presentation made with Export HTML (.html), or a converted Keynote file (.stepboard-import.json). Opening a file replaces the deck stored in this browser, so save a copy of the current deck first if you want to keep it.</p>
      <input id="import-file" type="file" accept={DECK_FILE_ACCEPT} onChange={async (e) => {
        const f = e.target.files?.[0]
        if (!f) return
        const msg = await onFile(f)
        if (msg) setErr(msg); else ref.current.close()
      }} />
      {err && <p className="sb-error" role="alert">{err}</p>}
      <div className="sb-row end"><button type="button" onClick={() => ref.current.close()}>Cancel</button></div>
    </dialog>
  )
}

// ---------- app ----------
function App() {
  const [editor, setEditor] = useState(null)
  const [name, setName] = useState('Untitled deck')
  const [status, setStatus] = useState('Loading…')
  const [cache, setCache] = useState({})
  const [presenting, setPresenting] = useState(false)
  const [textFile, setTextFile] = useState(null)
  const [importing, setImporting] = useState(false)
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 820)
  // Refit the slide when the panel opens or closes, so the board uses the freed space.
  useEffect(() => {
    if (!editor || !loaded.current) return
    const t = setTimeout(() => editor.zoomToBounds(SLIDE_BOX, { inset: 24, animation: { duration: 150 } }), 60)
    return () => clearTimeout(t)
  }, [sidebar, editor])
  const cacheRef = useRef({})
  const nameRef = useRef(name)
  const saveTimer = useRef(null)
  const playerRef = useRef(null)
  const loaded = useRef(false)

  nameRef.current = name

  const putCache = (pageId, layers) => {
    cacheRef.current = { ...cacheRef.current, [pageId]: layers }
    setCache(cacheRef.current)
  }

  const deckObject = useCallback((ed) => {
    const pages = ed.getPages()
    return {
      format: FORMAT, version: 1, name: nameRef.current, savedAt: new Date().toISOString(),
      slide: { width: SLIDE_W, height: SLIDE_H },
      tldraw: getSnapshot(ed.store).document,
      slides: pages.map((p) => ({ pageId: p.id, name: p.name, layers: cacheRef.current[p.id] || [] })),
    }
  }, [])

  const flush = useCallback(async (ed, pageIds) => {
    for (const id of pageIds) putCache(id, await renderPage(ed, id))
    const ok = await saveDeck(deckObject(ed))
    setStatus(ok ? `Saved in this browser · ${fmtTime(new Date())}` : 'Browser storage unavailable. Save a deck file to keep your work.')
  }, [deckObject])

  const dirty = useRef(new Set())
  // Slides whose pictures are out of date: edited since the last save, or never rendered.
  // Rendering only these keeps Present / Save file / Export quick on big decks.
  const pendingPages = (ed) => {
    const ids = new Set(dirty.current)
    dirty.current.clear()
    for (const p of ed.getPages()) if (!cacheRef.current[p.id]) ids.add(p.id)
    return [...ids].filter((id) => ed.getPage(id))
  }
  const scheduleSave = useCallback((ed, pageId) => {
    if (pageId) dirty.current.add(pageId)
    setStatus('Saving…')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const ids = [...dirty.current]; dirty.current.clear()
      flush(ed, ids)
    }, 700)
  }, [flush])

  const onMount = useCallback((ed) => {
    setEditor(ed)
    window.__stepboardEditor = ed // for debugging from the browser console
    ed.user.updateUserPreferences({ colorScheme: 'system' })

    // Blackboard mode: anything new belongs to the current step.
    ed.sideEffects.registerBeforeCreateHandler('shape', (shape) => {
      // A stroke that is just starting gets the chosen pen width (pasted or duplicated strokes keep theirs).
      if (isFreshStroke(shape)) shape = { ...shape, props: { ...shape.props, scale: (shape.props.scale ?? 1) * penWidthAtom.get() } }
      if (Number.isInteger(shape.meta?.in)) return shape
      return { ...shape, meta: { ...shape.meta, in: stepOf(ed, shape.parentId?.startsWith('page:') ? shape.parentId : ed.getCurrentPageId()) } }
    })
    // A group or frame takes the earliest step of what goes into it.
    ed.sideEffects.registerAfterChangeHandler('shape', (prev, next) => {
      if (prev.parentId === next.parentId) return
      const parent = ed.getShape(next.parentId)
      if (parent && inOf(next) < inOf(parent)) ed.updateShape({ id: parent.id, type: parent.type, meta: { ...parent.meta, in: inOf(next) } })
    })

    // Save after every document change, re-rendering the pages that changed.
    ed.store.listen((entry) => {
      if (!loaded.current) return
      const pages = new Set()
      const collect = (r) => { if (r?.typeName === 'shape') { let p = r; while (p && !String(p.parentId).startsWith('page:')) p = ed.getShape(p.parentId) || null; pages.add(p ? p.parentId : ed.getCurrentPageId()) } }
      Object.values(entry.changes.added).forEach(collect)
      Object.values(entry.changes.updated).forEach(([, r]) => collect(r))
      Object.values(entry.changes.removed).forEach(collect)
      if (Object.values(entry.changes.added).some((r) => r.typeName === 'page') || Object.values(entry.changes.removed).some((r) => r.typeName === 'page') || Object.values(entry.changes.updated).some(([, r]) => r.typeName === 'page')) pages.add(ed.getCurrentPageId())
      scheduleSave(ed, [...pages][0])
      for (const p of [...pages].slice(1)) dirty.current.add(p)
    }, { scope: 'document' })

    ;(async () => {
      const deck = await loadDeck()
      if (deck?.format === FORMAT && deck.tldraw) {
        try {
          loadSnapshot(ed.store, { document: deck.tldraw })
          cacheRef.current = Object.fromEntries((deck.slides || []).map((s) => [s.pageId, s.layers]))
          setCache(cacheRef.current)
          setName(deck.name || 'Untitled deck')
          setStatus(`Opened from this browser · saved ${fmtTime(new Date(deck.savedAt))}`)
        } catch {
          setStatus('The stored deck could not be opened. Started a new one.')
        }
      } else {
        ed.renamePage(ed.getCurrentPageId(), 'Slide 1')
        setStatus('New deck. It saves in this browser as you work.')
      }
      loaded.current = true
      ed.setCurrentTool('draw')
      ed.zoomToBounds(SLIDE_BOX, { inset: 24, immediate: true })
      // Render any slide missing a cached picture (e.g. first run).
      const missing = ed.getPages().map((p) => p.id).filter((id) => !cacheRef.current[id])
      for (const id of missing) putCache(id, await renderPage(ed, id))
    })()
  }, [scheduleSave])

  // Fit the slide whenever the current slide changes.
  const pageId = useValue('page', () => editor?.getCurrentPageId(), [editor])
  useEffect(() => { if (editor && loaded.current) editor.zoomToBounds(SLIDE_BOX, { inset: 24, immediate: true }) }, [editor, pageId])

  // Renaming the deck counts as a change.
  useEffect(() => { if (editor && loaded.current) scheduleSave(editor) }, [name]) // eslint-disable-line

  const startPresenting = async () => {
    if (!editor) return
    clearTimeout(saveTimer.current)
    await flush(editor, pendingPages(editor))
    editor.selectNone()
    editor.blur() // keep tldraw's shortcuts (arrow keys nudge shapes) out of the presentation
    setPresenting(true)
  }
  useEffect(() => {
    if (!presenting || !playerRef.current || !editor) return
    const pages = editor.getPages()
    const slides = pages.map((p) => ({ layers: cacheRef.current[p.id] || [] }))
    const start = pages.findIndex((p) => p.id === editor.getCurrentPageId())
    const close = present(playerRef.current, slides, start, () => setPresenting(false), editorAssets(editor))
    playerRef.current.requestFullscreen?.().catch(() => {})
    return () => { close(); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}) }
  }, [presenting, editor])

  const fileBase = (name.trim() || 'deck').replace(/[^\w\- ]+/g, '').trim() || 'deck'

  const saveFile = async () => {
    clearTimeout(saveTimer.current)
    await flush(editor, pendingPages(editor))
    const r = await offerFile(`${fileBase}.stepboard.json`, JSON.stringify(deckObject(editor)), (filename, text) => setTextFile({ filename, text }))
    if (r === 'saved') setStatus(`Deck file saved · ${fmtTime(new Date())}`)
  }
  const exportHtml = async () => {
    clearTimeout(saveTimer.current)
    await flush(editor, pendingPages(editor))
    const r = await offerFile(`${fileBase}.html`, standaloneHtml(name, deckObject(editor)), (filename, text) => setTextFile({ filename, text }))
    if (r === 'saved') setStatus(`Slides exported · ${fmtTime(new Date())}`)
  }
  const importFile = async (file) => {
    let deck
    try { deck = parseDeckText(await file.text()) } catch (e) { return e.message }
    if (deck?.format === IMPORT_FORMAT) {
      // A converted Keynote file: build the slides with the editor.
      try {
        loaded.current = false
        const r = buildFromImport(editor, deck)
        cacheRef.current = {}
        setCache({})
        stepsAtom.set({})
        setName(deck.name || 'Imported deck')
        loaded.current = true
        editor.zoomToBounds(SLIDE_BOX, { inset: 24, immediate: true })
        await flush(editor, editor.getPages().map((p) => p.id))
        const summary = `Imported ${r.slides} slides, ${r.strokes} strokes, ${r.texts} text items, ${r.images} images${r.warnings.length ? ` (not converted: ${r.warnings.join(', ')})` : ''}`
        setTimeout(() => setStatus(summary), 1500) // after the save that renaming the deck triggers
        return ''
      } catch (e) {
        loaded.current = true
        return `The converted file could not be imported (${e?.message || 'unknown error'}).`
      }
    }
    if (deck?.format !== FORMAT || !deck.tldraw) return 'That file is not a Stepboard deck or a converted Keynote file.'
    try {
      loaded.current = false
      loadSnapshot(editor.store, { document: deck.tldraw })
      cacheRef.current = Object.fromEntries((deck.slides || []).map((s) => [s.pageId, s.layers]))
      setCache(cacheRef.current)
      stepsAtom.set({})
      setName(deck.name || 'Untitled deck')
      loaded.current = true
      editor.zoomToBounds(SLIDE_BOX, { inset: 24, immediate: true })
      await flush(editor, pendingPages(editor))
      return ''
    } catch (e) {
      loaded.current = true
      return `The deck could not be opened (${e?.message || 'unknown error'}).`
    }
  }

  return (
    <div className={sidebar ? 'sb-app with-sidebar' : 'sb-app'}>
      <header className="sb-header">
        <button type="button" className="sb-toggle" onClick={() => setSidebar((v) => !v)} aria-expanded={sidebar} aria-controls="sb-sidebar">{sidebar ? 'Hide panel' : 'Show panel'}</button>
        <input id="deck-name" className="sb-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Deck name" />
        <span className="sb-status" role="status">{status}</span>
        <div className="sb-actions">
          <button type="button" onClick={() => setImporting(true)} disabled={!editor}>Open file</button>
          <button type="button" onClick={saveFile} disabled={!editor}>Save file</button>
          <button type="button" onClick={exportHtml} disabled={!editor}>Export HTML</button>
          <button type="button" className="primary" onClick={startPresenting} disabled={!editor}>Present</button>
        </div>
      </header>
      {editor && <StepBar editor={editor} />}
      <div className="sb-body">
        {editor && sidebar && <div id="sb-sidebar"><Sidebar editor={editor} cache={cache} /></div>}
        <div className="sb-canvas">
          <Tldraw
            assetUrls={assetUrls}
            onMount={onMount}
            getShapeVisibility={getShapeVisibility}
            components={tldrawComponents}
            tools={tldrawTools}
            overrides={uiOverrides}
          />
          <GhostStyle editor={editor} />
        </div>
      </div>
      {presenting && <div className="sb-player" ref={playerRef} />}
      {textFile && <TextDialog data={textFile} onClose={() => setTextFile(null)} />}
      {importing && <ImportDialog onFile={importFile} onClose={() => setImporting(false)} />}
      <style>{PLAYER_CSS + PLAYER_UI_CSS}</style>
    </div>
  )
}

createRoot(document.getElementById('app')).render(<App />)
