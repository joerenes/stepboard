// Build map: boxes on the slide around what each build shows, with the build number in a corner.
// Objects of the same build that touch or sit close together share a box ("clusters"); a build spread across
// the slide gets several boxes with the same number. Disappearing objects get a dashed box marked "−n".
import { useEditor, useValue } from 'tldraw'
import { inOf, outOf } from './model.js'
import { viewAtom, topShapes, selectStepItems } from './state.js'

const GAP = 28 // page units: boxes closer than this merge into one cluster
const COLORS = ['#2f6f8f', '#c2410c', '#15803d', '#7c3aed', '#b91c1c', '#0e7490', '#a16207', '#be185d']
export const stepColor = (n) => COLORS[(n - 1) % COLORS.length]

const near = (a, b, g) => a.x - g <= b.x + b.w && b.x - g <= a.x + a.w && a.y - g <= b.y + b.h && b.y - g <= a.y + a.h
const union = (a, b) => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

/** Merge boxes that are within `gap` of each other until no two clusters are close. */
export function clusterBoxes(boxes, gap = GAP) {
  let out = boxes.map((b) => ({ ...b }))
  let merged = true
  while (merged) {
    merged = false
    const next = []
    for (const b of out) {
      const hit = next.find((c) => near(c, b, gap))
      if (hit) { Object.assign(hit, union(hit, b)); merged = true } else next.push({ ...b })
    }
    out = next
  }
  return out
}

/** Clusters for the current page: [{ step, kind: 'in' | 'out', x, y, w, h }]. */
function buildClusters(editor) {
  const byKey = new Map()
  for (const s of topShapes(editor)) {
    if (s.meta?.role === 'background') continue
    const b = editor.getShapePageBounds(s.id)
    if (!b) continue
    const box = { x: b.x, y: b.y, w: b.w, h: b.h }
    const add = (step, kind) => {
      const k = `${kind}:${step}`
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k).push(box)
    }
    if (inOf(s) > 0) add(inOf(s), 'in')
    if (outOf(s) !== undefined) add(outOf(s), 'out')
  }
  const out = []
  for (const [k, boxes] of byKey) {
    const [kind, step] = k.split(':')
    for (const c of clusterBoxes(boxes)) out.push({ step: Number(step), kind, ...c })
  }
  return out.sort((a, b) => a.step - b.step)
}

export function BuildMapOverlay() {
  const editor = useEditor()
  const on = useValue('map view', () => viewAtom.get() === 'map', [])
  const clusters = useValue('build clusters', () => (on ? buildClusters(editor) : []), [editor, on])
  const zoom = useValue('zoom', () => editor.getZoomLevel(), [editor])
  if (!on) return null
  const px = 1 / zoom // one screen pixel in page units, so lines and labels keep their size when zooming
  return (
    <div className="sb-map" aria-hidden="true">
      {clusters.map((c, i) => {
        const color = stepColor(c.step)
        const pad = 6 * px
        return (
          <div key={i} className={`sb-map-box ${c.kind}`} style={{
            left: c.x - pad, top: c.y - pad, width: c.w + 2 * pad, height: c.h + 2 * pad,
            borderWidth: 1.5 * px, borderColor: color, borderRadius: 4 * px,
          }}>
            <button type="button" className="sb-map-badge" title={c.kind === 'in' ? `Build ${c.step}: select` : `Disappears at build ${c.step}: select`}
              style={{ background: color, fontSize: 12 * px, padding: `${1 * px}px ${5 * px}px`, borderRadius: 3 * px,
                [c.kind === 'in' ? 'left' : 'right']: -1.5 * px, top: -1.5 * px }}
              onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); selectStepItems(editor, c.step, c.kind) }}>
              {c.kind === 'in' ? c.step : `−${c.step}`}
            </button>
          </div>
        )
      })}
    </div>
  )
}
