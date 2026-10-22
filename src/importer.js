// Builds a Stepboard deck from a "stepboard-import" file (made by tools/key2stepboard.py from a Keynote file).
// Shapes are created through the tldraw editor, so the result is an ordinary, fully editable deck.
import { PageRecordType, createShapeId, toRichText } from 'tldraw'
import { SLIDE_W } from './model.js'

export const IMPORT_FORMAT = 'stepboard-import'

// tldraw 3 shapes can only use its named colours; each imported colour goes to the closest one.
// The exact original colour is kept in meta.sourceColor.
const PALETTE = {
  black: '#1d1d1d', grey: '#9fa8b2', 'light-violet': '#e085f4', violet: '#ae3ec9', blue: '#4465e9',
  'light-blue': '#4ba1f1', yellow: '#f1ac4b', orange: '#e16919', green: '#099268', 'light-green': '#4cb05e',
  'light-red': '#f87777', red: '#e03131', white: '#ffffff',
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0)
export function nearestColor(hex) {
  const [r, g, b] = rgb(hex || '#000000')
  let best = 'black', bestD = Infinity
  for (const [name, h] of Object.entries(PALETTE)) {
    const [R, G, B] = rgb(h)
    const rm = (r + R) / 2 // "redmean" colour distance: cheap and closer to perception than plain RGB
    const d = (2 + rm / 256) * (r - R) ** 2 + 4 * (g - G) ** 2 + (2 + (255 - rm) / 256) * (b - B) ** 2
    if (d < bestD) { bestD = d; best = name }
  }
  return best
}

const STROKE_BASE = 3   // tldraw's "s" stroke width (2) + 1
const FONT_BASE = 24    // tldraw's "m" text size
const TEXT_LINE = 1.35  // tldraw's text line height
const GLYPH_BOX = 1.165 // Keynote's glyph box / font size (see key2stepboard.py)

function stepMeta(item) {
  const meta = { in: Number.isInteger(item.in) ? item.in : 0 }
  if (Number.isInteger(item.out) && item.out > meta.in) meta.out = item.out
  return meta
}

function strokeShape(item, k, pageId) {
  const pts = item.points || []
  if (!pts.length) return null
  const [x0, y0] = pts[0]
  return {
    id: createShapeId(), type: 'draw', parentId: pageId, x: x0 * k, y: y0 * k,
    meta: { ...stepMeta(item), sourceColor: item.color, ...(item.brush ? { sourceBrush: item.brush } : {}) },
    props: {
      color: nearestColor(item.color), size: 's', dash: 'solid', fill: 'none',
      isPen: false, isComplete: true, isClosed: false,
      scale: Math.max(0.05, (item.width * k) / STROKE_BASE),
      segments: [{ type: 'free', points: pts.map(([x, y]) => ({ x: (x - x0) * k, y: (y - y0) * k, z: 0.5 })) }],
    },
  }
}

function textShape(item, k, pageId) {
  const fontPx = item.fontSize * k
  const scale = fontPx / FONT_BASE
  // Keynote gives the top of the glyph box; tldraw's line box is taller, so centre the glyphs in it.
  const y = item.y * k - ((TEXT_LINE - GLYPH_BOX) / 2) * fontPx
  return {
    id: createShapeId(), type: 'text', parentId: pageId, x: item.x * k, y,
    meta: { ...stepMeta(item), sourceColor: item.color },
    props: {
      color: nearestColor(item.color), size: 'm', font: 'sans', scale,
      textAlign: item.align === 'middle' ? 'middle' : item.align === 'end' ? 'end' : 'start',
      // Left-aligned lines size to their text (tldraw's font is a little wider than Keynote's, so a fixed
      // width would wrap); centred and right-aligned text keeps the Keynote box width to stay in place.
      autoSize: item.align !== 'middle' && item.align !== 'end',
      w: Math.max(20, (item.w * k) / scale), richText: toRichText(item.text),
    },
  }
}

/** Replace the editor's document with the imported slides. Returns a short summary. */
export function buildFromImport(editor, data) {
  if (data?.format !== IMPORT_FORMAT || !Array.isArray(data.slides)) throw new Error('not a Stepboard import file')
  const k = SLIDE_W / (data.slide?.width || 1920)
  const oldPages = editor.getPages().map((p) => p.id)
  const newPages = []
  let strokes = 0, texts = 0

  editor.run(() => {
    data.slides.forEach((slide, i) => {
      const pageId = PageRecordType.createId()
      editor.createPage({ id: pageId, name: slide.name || `Slide ${i + 1}` })
      newPages.push(pageId)
      const shapes = []
      const groups = new Map()
      for (const item of slide.items || []) {
        const shape = item.type === 'stroke' ? strokeShape(item, k, pageId) : item.type === 'text' ? textShape(item, k, pageId) : null
        if (!shape) continue
        item.type === 'stroke' ? strokes++ : texts++
        shapes.push(shape)
        if (item.group) {
          if (!groups.has(item.group)) groups.set(item.group, { ids: [], meta: shape.meta })
          groups.get(item.group).ids.push(shape.id)
        }
      }
      editor.createShapes(shapes)
      // Each Keynote drawing (one build target) becomes a tldraw group, so it can be selected in one tap.
      for (const { ids, meta } of groups.values()) {
        if (ids.length < 2) continue
        const groupId = createShapeId()
        editor.groupShapes(ids, { groupId, select: false })
        const g = editor.getShape(groupId)
        if (g) editor.updateShape({ id: groupId, type: 'group', meta: { ...g.meta, in: meta.in, ...(meta.out !== undefined ? { out: meta.out } : {}) } })
      }
    })
    editor.setCurrentPage(newPages[0])
    for (const id of oldPages) editor.deletePage(id)
  })
  editor.selectNone()
  return { slides: newPages.length, strokes, texts, warnings: data.warnings || [] }
}
