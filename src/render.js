// Renders a page of a tldraw editor into step layers for the player:
//   { in, out, svg }    strokes, text and shapes, exported as one SVG with the slide's bounds
//   { in, out, image }  an image, placed by the player as its own <img> (see player.js), so its file is
//                       stored once (in the tldraw document) instead of being copied into every layer SVG
// Layers keep the stacking order: consecutive non-image shapes with the same build range share an SVG layer.
import { Box } from 'tldraw'
import { SLIDE_W, SLIDE_H, inOf, outOf } from './model.js'

export const SLIDE_BOX = new Box(0, 0, SLIDE_W, SLIDE_H)

const round = (v) => Math.round(v * 100) / 100

/** Placement of an image shape in slide coordinates, or null if it can't be shown as a plain image. */
function imagePlacement(editor, shape) {
  if (shape.type !== 'image' || !shape.props.assetId) return null
  const asset = editor.getAsset(shape.props.assetId)
  if (!asset?.props?.src) return null
  const m = editor.getShapePageTransform(shape.id)
  let opacity = shape.opacity ?? 1
  for (let p = editor.getShape(shape.parentId); p; p = editor.getShape(p.parentId)) opacity *= p.opacity ?? 1
  const img = {
    asset: asset.id, x: round(m.e), y: round(m.f), w: round(shape.props.w), h: round(shape.props.h),
    rot: round(Math.atan2(m.b, m.a) * 1e4) / 1e4,
  }
  if (shape.props.flipX) img.flipX = true
  if (shape.props.flipY) img.flipY = true
  if (shape.props.crop) img.crop = shape.props.crop
  if (opacity < 1) img.opacity = round(opacity)
  return img
}

/** A top-level shape split into pieces in stacking order: images on their own, everything else as SVG runs. */
function pieces(editor, shape, out = []) {
  const img = imagePlacement(editor, shape)
  if (img) { out.push({ image: img }); return out }
  if (shape.type === 'group' && hasImage(editor, shape)) {
    for (const id of editor.getSortedChildIdsForParent(shape.id)) pieces(editor, editor.getShape(id), out)
    return out
  }
  const last = out[out.length - 1]
  if (last?.ids) last.ids.push(shape.id); else out.push({ ids: [shape.id] })
  return out
}

function hasImage(editor, shape) {
  return editor.getSortedChildIdsForParent(shape.id).some((id) => {
    const s = editor.getShape(id)
    return s && (imagePlacement(editor, s) || (s.type === 'group' && hasImage(editor, s)))
  })
}

export async function renderPage(editor, pageId = editor.getCurrentPageId()) {
  if (!editor.getPage(pageId)) return []
  // Plan: a list of { in, out, ids } (SVG) and { in, out, image } entries, merging adjacent SVG runs.
  const plan = []
  for (const id of editor.getSortedChildIdsForParent(pageId)) {
    const shape = editor.getShape(id)
    if (!shape) continue
    const range = { in: inOf(shape), out: outOf(shape) }
    for (const piece of pieces(editor, shape)) {
      const last = plan[plan.length - 1]
      if (piece.ids && last?.ids && last.in === range.in && last.out === range.out) last.ids.push(...piece.ids)
      else plan.push({ ...range, ...(piece.ids ? { ids: [...piece.ids] } : { image: piece.image }) })
    }
  }
  const out = []
  for (const layer of plan) {
    const base = { in: layer.in, ...(layer.out !== undefined ? { out: layer.out } : {}) }
    if (layer.image) { out.push({ ...base, image: layer.image }); continue }
    const res = await editor.getSvgString(layer.ids, {
      bounds: SLIDE_BOX, padding: 0, background: false, darkMode: false, scale: 1,
    })
    if (!res) continue
    // Strip fixed pixel sizes so the SVG scales with its container.
    const svg = res.svg.replace(/^<svg([^>]*?)\swidth="[^"]*"/, '<svg$1').replace(/^<svg([^>]*?)\sheight="[^"]*"/, '<svg$1')
      // tldraw draws a halo in the background colour around text; slides look like Keynote without it.
      .replaceAll('var(--tl-text-outline)', 'none')
    out.push({ ...base, svg })
  }
  return out
}
