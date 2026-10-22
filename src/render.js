// Renders the current page of a tldraw editor into step layers: [{ in, out, svg }].
// Every layer is exported with the same slide bounds, so stacked layers line up exactly.
import { Box } from 'tldraw'
import { SLIDE_W, SLIDE_H, layersOf } from './model.js'

export const SLIDE_BOX = new Box(0, 0, SLIDE_W, SLIDE_H)

export async function renderPage(editor, pageId = editor.getCurrentPageId()) {
  if (!editor.getPage(pageId)) return []
  const top = editor.getSortedChildIdsForParent(pageId).map((id) => editor.getShape(id)).filter(Boolean)
  const layers = layersOf(top)
  const out = []
  for (const layer of layers) {
    const res = await editor.getSvgString(layer.ids, {
      bounds: SLIDE_BOX, padding: 0, background: false, darkMode: false, scale: 1,
    })
    if (!res) continue
    // Strip fixed pixel sizes so the SVG scales with its container.
    const svg = res.svg.replace(/^<svg([^>]*?)\swidth="[^"]*"/, '<svg$1').replace(/^<svg([^>]*?)\sheight="[^"]*"/, '<svg$1')
    out.push({ in: layer.in, out: layer.out, svg })
  }
  return out
}
