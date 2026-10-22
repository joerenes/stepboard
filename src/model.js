// Step model: pure functions over plain shape-like objects { id, parentId, meta }.
// A shape is visible at step s when  in <= s  and (out is undefined or s < out).
// Step 0 = visible when the slide opens. Nested shapes take the range of their top-level ancestor.

export const SLIDE_W = 1600
export const SLIDE_H = 900

export const inOf = (shape) => (Number.isInteger(shape?.meta?.in) ? shape.meta.in : 0)
export const outOf = (shape) => (Number.isInteger(shape?.meta?.out) ? shape.meta.out : undefined)

export function visibleAt(range, step) {
  return range.in <= step && (range.out === undefined || step < range.out)
}

/** Top-level ancestor on the page (the shape itself if its parent is the page). */
export function topLevel(shape, byId) {
  let s = shape
  while (s && byId.has(s.parentId)) s = byId.get(s.parentId)
  return s
}

export function rangeOf(shape, byId) {
  const t = topLevel(shape, byId)
  return { in: inOf(t), out: outOf(t) }
}

/** Highest step number referenced by any shape on the page. */
export function lastStep(shapes) {
  let m = 0
  for (const s of shapes) {
    m = Math.max(m, inOf(s))
    const o = outOf(s)
    if (o !== undefined) m = Math.max(m, o)
  }
  return m
}

/** Per-step summary: how many top-level shapes appear / disappear at each step. */
export function stepSummary(topShapes, maxStep) {
  const rows = Array.from({ length: maxStep + 1 }, (_, i) => ({ step: i, appear: 0, disappear: 0 }))
  for (const s of topShapes) {
    rows[Math.min(inOf(s), maxStep)].appear++
    const o = outOf(s)
    if (o !== undefined && o <= maxStep) rows[o].disappear++
  }
  return rows
}

/**
 * Group z-ordered top-level shapes into render layers: consecutive shapes with the same range share
 * a layer, so stacking order is preserved and the layer count stays small.
 */
export function layersOf(sortedTopShapes) {
  const layers = []
  for (const s of sortedTopShapes) {
    const r = { in: inOf(s), out: outOf(s) }
    const last = layers[layers.length - 1]
    if (last && last.in === r.in && last.out === r.out) last.ids.push(s.id)
    else layers.push({ ...r, ids: [s.id] })
  }
  return layers
}

// ---------- meta transforms (return new meta objects; callers write them back) ----------

const clean = (meta) => {
  const m = { ...meta }
  if (m.out !== undefined && m.out <= (m.in ?? 0)) m.out = (m.in ?? 0) + 1
  if (m.out === undefined) delete m.out
  return m
}

/** Make the shape appear at step s. A disappearance at or before s is pushed to s+1. */
export const setIn = (meta, s) => clean({ ...meta, in: s, out: meta?.out !== undefined && meta.out <= s ? undefined : meta?.out })

/** Hide from step s. Returns null if the shape only appears at or after s. */
export function setOut(meta, s) {
  if ((meta?.in ?? 0) >= s) return null
  return { ...meta, out: s }
}

export const clearOut = (meta) => { const m = { ...meta }; delete m.out; return m }

/** Renumber every step value with f (used for insert / delete / swap). */
export function mapSteps(meta, f) {
  const m = { ...meta, in: f(meta?.in ?? 0) }
  if (meta?.out !== undefined) m.out = f(meta.out)
  return clean(m)
}

export const insertAfter = (s) => (v) => (v > s ? v + 1 : v)
export const removeStep = (s) => (v) => (v >= s && v > 0 ? v - 1 : v) // merges step s into s-1
export const swapSteps = (a, b) => (v) => (v === a ? b : v === b ? a : v)
