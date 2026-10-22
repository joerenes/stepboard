// Lasso select tool for tldraw 3: draw a loop, everything mostly inside it gets selected.
// Written against tldraw's public API (StateNode, geometry, pointInPolygon); tldraw itself is not modified.
import { StateNode, atom, pointInPolygon, Vec, useValue } from 'tldraw'

/** Points of the lasso being drawn, in page coordinates (empty when not lassoing). */
export const lassoPointsAtom = atom('lasso points', [])

/** Share of a shape's outline that must lie inside the loop for it to be selected. */
const INSIDE_SHARE = 0.6

function shapeSamplePoints(editor, shape) {
  const t = editor.getShapePageTransform(shape)
  const verts = editor.getShapeGeometry(shape).vertices
  if (verts.length >= 8) return verts.map((v) => t.applyToPoint(v))
  const b = editor.getShapePageBounds(shape)
  return [b.point, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }, b.center]
}

export function shapesInLasso(editor, loop) {
  if (loop.length < 3) return []
  const pageId = editor.getCurrentPageId()
  const hits = []
  for (const id of editor.getSortedChildIdsForParent(pageId)) {
    const shape = editor.getShape(id)
    if (!shape || shape.isLocked || editor.isShapeHidden(shape)) continue
    const pts = shapeSamplePoints(editor, shape)
    const inside = pts.filter((p) => pointInPolygon(p, loop)).length
    if (inside / pts.length >= INSIDE_SHARE) hits.push(id)
  }
  return hits
}

class LassoIdle extends StateNode {
  static id = 'idle'
  onEnter() { this.editor.setCursor({ type: 'cross', rotation: 0 }) }
  onPointerDown(info) { this.parent.transition('lassoing', info) }
  onCancel() { this.editor.setCurrentTool('select') }
}

class Lassoing extends StateNode {
  static id = 'lassoing'
  onEnter() {
    this.additive = this.editor.inputs.shiftKey
    lassoPointsAtom.set([this.editor.inputs.currentPagePoint.clone()])
  }
  onPointerMove() {
    const p = this.editor.inputs.currentPagePoint
    const pts = lassoPointsAtom.get()
    const minGap = 3 / this.editor.getZoomLevel()
    if (Vec.Dist(p, pts[pts.length - 1]) >= minGap) lassoPointsAtom.set([...pts, p.clone()])
  }
  onPointerUp() { this.complete() }
  onComplete() { this.complete() }
  onCancel() { lassoPointsAtom.set([]); this.parent.transition('idle') }
  onExit() { lassoPointsAtom.set([]) }
  complete() {
    const ids = shapesInLasso(this.editor, lassoPointsAtom.get())
    lassoPointsAtom.set([])
    const next = this.additive ? [...new Set([...this.editor.getSelectedShapeIds(), ...ids])] : ids
    // Switch to the select tool so the selection can be moved or given a build step right away.
    this.editor.setCurrentTool('select')
    this.editor.setSelectedShapes(next)
  }
}

export class LassoTool extends StateNode {
  static id = 'lasso'
  static initial = 'idle'
  static children = () => [LassoIdle, Lassoing]
}

/** Renders the loop while it is being drawn (place inside tldraw's OnTheCanvas layer). */
export function LassoOverlay() {
  const pts = useValue('lasso pts', () => lassoPointsAtom.get(), [])
  if (pts.length < 2) return null
  const d = `M${pts.map((p) => `${p.x},${p.y}`).join('L')}Z`
  return (
    <svg className="sb-lasso" width="1" height="1" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export const LassoIcon = (
  <div className="sb-lasso-icon">
    <svg viewBox="0 0 30 30" width="18" height="18" aria-hidden="true">
      <path d="M15 5c6.6 0 11 3.4 11 7.5S21.6 20 15 20 4 16.6 4 12.5 8.4 5 15 5Z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeDasharray="3.2 2.6" strokeLinecap="round" />
      <path d="M9 19c-1.6 1.8-1.4 4 .6 5.3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  </div>
)
