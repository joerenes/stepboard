// Formula shape: LaTeX source typeset by MathJax (Computer Modern) into SVG. The shape stores the source and the
// typeset SVG, so slides, the player and exported files show formulas without MathJax; only editing needs it.
// Colour comes from tldraw's palette (style panel); the size follows the shape (resize keeps the proportions).
import { useEffect, useRef, useState } from 'react'
import {
  ShapeUtil, HTMLContainer, Rectangle2d, T, DefaultColorStyle, atom, useValue, resizeBox,
  getDefaultColorTheme, useDefaultColorTheme, createShapeId,
} from 'tldraw'
import { SLIDE_W, SLIDE_H } from './model.js'

/** Font size of a new formula, in slide pixels per em. */
export const FORMULA_EM = 40

/** Which formula the editing dialog is open for: null (closed), { id: null } (a new one) or { id }. */
export const formulaEditAtom = atom('formula edit', null)

const vbOf = (shape) => shape.props.viewBox.split(/\s+/).map(Number)

export class FormulaShapeUtil extends ShapeUtil {
  static type = 'formula'
  static props = {
    w: T.positiveNumber,
    h: T.positiveNumber,
    tex: T.string,
    viewBox: T.string,
    body: T.string,
    color: DefaultColorStyle,
  }

  getDefaultProps() {
    return { w: 1, h: 1, tex: '', viewBox: '0 0 1 1', body: '', color: 'black' }
  }

  isAspectRatioLocked() { return true }
  // "Editing" (double-click, or Enter on a selected formula) opens the formula dialog; see watchFormulaEditing.
  canEdit() { return true }
  hideRotateHandle() { return false }

  getGeometry(shape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  onResize(shape, info) { return resizeBox(shape, info) }

  component(shape) {
    const theme = useDefaultColorTheme()
    return (
      <HTMLContainer style={{ color: theme[shape.props.color].solid, pointerEvents: 'all' }}>
        <svg viewBox={shape.props.viewBox} width={shape.props.w} height={shape.props.h} style={{ display: 'block', overflow: 'visible' }}
          dangerouslySetInnerHTML={{ __html: shape.props.body }} />
      </HTMLContainer>
    )
  }

  toSvg(shape, ctx) {
    const theme = getDefaultColorTheme({ isDarkMode: ctx.isDarkMode })
    return (
      <svg viewBox={shape.props.viewBox} width={shape.props.w} height={shape.props.h} overflow="visible"
        color={theme[shape.props.color].solid} dangerouslySetInnerHTML={{ __html: shape.props.body }} />
    )
  }

  indicator(shape) {
    return <rect width={shape.props.w} height={shape.props.h} />
  }
}

/** When tldraw starts editing a formula, open the dialog instead of tldraw's in-place editing. */
export function watchFormulaEditing(editor) {
  return editor.sideEffects.registerAfterChangeHandler('instance_page_state', (prev, next) => {
    const id = next.editingShapeId
    if (!id || id === prev.editingShapeId || editor.getShape(id)?.type !== 'formula') return
    queueMicrotask(() => { editor.setEditingShape(null); editor.setCurrentTool('select'); formulaEditAtom.set({ id }) })
  })
}

// ---------- MathJax, loaded on first use ----------
let texPromise = null
function loadTex() {
  if (globalThis.StepboardTeX) return Promise.resolve(globalThis.StepboardTeX)
  texPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = './assets/mathjax.js'
    s.onload = () => (globalThis.StepboardTeX ? resolve(globalThis.StepboardTeX) : reject(new Error('MathJax did not start')))
    s.onerror = () => { texPromise = null; reject(new Error('MathJax could not be loaded')) }
    document.head.appendChild(s)
  })
  return texPromise
}

/** Typeset `tex`; returns { viewBox, body } or throws with TeX's error message. */
async function typeset(tex) {
  const mj = await loadTex()
  return mj.tex2svg(tex)
}

// ---------- editing dialog ----------
export function FormulaDialog({ editor }) {
  const edit = useValue('formula edit', () => formulaEditAtom.get(), [])
  if (!edit) return null
  return <FormulaDialogInner key={edit.id ?? 'new'} editor={editor} id={edit.id} />
}

function FormulaDialogInner({ editor, id }) {
  const ref = useRef(null)
  const shape = id ? editor.getShape(id) : null
  const [tex, setTex] = useState(shape?.props.tex ?? '')
  const [result, setResult] = useState(null) // { viewBox, body } of the current source
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const color = getDefaultColorTheme({ isDarkMode: false })[shape?.props.color ?? 'black'].solid

  useEffect(() => {
    ref.current?.showModal()
    const ta = ref.current?.querySelector('textarea')
    ta?.focus(); ta?.select()
  }, [])
  // Live preview, a moment after typing stops.
  useEffect(() => {
    if (!tex.trim()) { setResult(null); setErr(''); return }
    let live = true
    const t = setTimeout(async () => {
      try { const r = await typeset(tex); if (live) { setResult(r); setErr('') } }
      catch (e) { if (live) { setResult(null); setErr(e.message || String(e)) } }
      finally { if (live) setLoading(false) }
    }, 150)
    return () => { live = false; clearTimeout(t) }
  }, [tex])

  const close = () => { ref.current?.close() }
  const done = () => {
    if (!result) return
    const [, , vw, vh] = result.viewBox.split(/\s+/).map(Number)
    if (shape) {
      // Keep the formula's current font size: its width per em stays the same.
      const em = shape.props.w / (vbOf(shape)[2] / 1000)
      editor.markHistoryStoppingPoint('edit formula')
      editor.updateShape({ id: shape.id, type: 'formula', props: { tex, ...result, w: (vw / 1000) * em, h: (vh / 1000) * em } })
    } else {
      const w = (vw / 1000) * FORMULA_EM, h = (vh / 1000) * FORMULA_EM
      // In the middle of what's on screen, kept on the slide.
      const c = editor.getViewportPageBounds().center
      const x = Math.min(Math.max(c.x - w / 2, 0), Math.max(0, SLIDE_W - w))
      const y = Math.min(Math.max(c.y - h / 2, 0), Math.max(0, SLIDE_H - h))
      const newId = createShapeId()
      editor.markHistoryStoppingPoint('add formula')
      editor.createShape({ id: newId, type: 'formula', x, y, props: { tex, ...result, w, h, color: editor.getStyleForNextShape(DefaultColorStyle) } })
      editor.setCurrentTool('select')
      editor.select(newId)
    }
    close()
  }

  return (
    <dialog ref={ref} className="sb-dialog sb-formula" onClose={() => formulaEditAtom.set(null)}>
      <h2>{shape ? 'Edit formula' : 'New formula'}</h2>
      <p>LaTeX maths, typeset as display maths. Packages: ams, physics, braket, mathtools, cancel, color, boldsymbol; \newcommand works within a formula.</p>
      <textarea value={tex} spellCheck="false" autoCapitalize="off" autoCorrect="off" aria-label="LaTeX source"
        placeholder={'e.g. \\ket{\\psi} = \\sum_k \\alpha_k \\ket{k}'}
        onChange={(e) => setTex(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); done() } }} />
      <div className="sb-formula-preview" aria-live="polite">
        {result
          ? <svg viewBox={result.viewBox} style={{ color, height: `${(Number(result.viewBox.split(/\s+/)[3]) / 1000) * 1.6}em` }} dangerouslySetInnerHTML={{ __html: result.body }} />
          : err ? <p className="sb-error" role="alert">{err}</p>
          : <p className="sb-muted">{tex.trim() && loading ? 'Loading MathJax…' : 'The formula appears here.'}</p>}
      </div>
      <div className="sb-row end">
        <button type="button" onClick={close}>Cancel</button>
        <button type="button" className="primary" onClick={done} disabled={!result} title="Ctrl/Cmd + Enter">{shape ? 'Update' : 'Add'}</button>
      </div>
    </dialog>
  )
}

/** Toolbar icon: a summation sign. */
export const FormulaIcon = (
  <svg viewBox="0 0 30 30" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 7.5V6H8l8 9-8 9h14v-1.5" />
  </svg>
)
