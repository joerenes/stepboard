// Builds a Stepboard deck from a "stepboard-import" file (made by tools/key2stepboard.py from a Keynote file).
// Shapes are created through the tldraw editor, so the result is an ordinary, fully editable deck.
import { PageRecordType, AssetRecordType, createShapeId, toRichText, getIndexAbove } from 'tldraw'
import { SLIDE_W, SLIDE_H } from './model.js'

export const IMPORT_FORMAT = 'stepboard-import'

// tldraw 3 shapes can only use its named colours; each imported colour goes to the closest one.
// The exact original colour is kept in meta.sourceColor.
const PALETTE = {
  black: '#1d1d1d', grey: '#9fa8b2', 'light-violet': '#e085f4', violet: '#ae3ec9', blue: '#4465e9',
  'light-blue': '#4ba1f1', yellow: '#f1ac4b', orange: '#e16919', green: '#099268', 'light-green': '#4cb05e',
  'light-red': '#f87777', red: '#e03131', white: '#ffffff',
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0)

// Distances are measured in CIE Lab, so a grey goes to grey or black rather than to a "nearby" hue.
function lab(hex) {
  const lin = rgb(hex).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  const [r, g, b] = lin
  const xyz = [(0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883]
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const [fx, fy, fz] = xyz.map(f)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}
const PALETTE_LAB = Object.entries(PALETTE).map(([name, h]) => [name, lab(h)])
export function nearestColor(hex) {
  const c = lab(hex || '#000000')
  let best = 'black', bestD = Infinity
  for (const [name, p] of PALETTE_LAB) {
    const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2
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
      color: nearestColor(item.fill || item.color), size: 's', dash: 'solid', fill: item.fill ? 'fill' : 'none',
      isPen: false, isComplete: true, isClosed: !!item.fill,
      scale: Math.max(0.05, (item.width * k) / STROKE_BASE),
      // Rounded to 1/100 px: invisible, and it keeps the deck file much smaller than full float precision.
      segments: [{ type: 'free', points: pts.map(([x, y]) => ({ x: Math.round((x - x0) * k * 100) / 100, y: Math.round((y - y0) * k * 100) / 100, z: 0.5 })) }],
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

function imageShape(item, k, pageId, assetId) {
  return {
    id: createShapeId(), type: 'image', parentId: pageId, x: item.x * k, y: item.y * k, rotation: item.rotation || 0,
    meta: stepMeta(item),
    props: { w: item.w * k, h: item.h * k, assetId, playing: true, url: '', crop: null, flipX: false, flipY: false, altText: '' },
  }
}

// Slide backgrounds and filled boxes use their exact Keynote colour, which tldraw's named colours can't
// express (its "black" is a dark grey, for instance). They become images of a single colour: a tiny SVG asset,
// shared by every shape of that colour. Backgrounds are locked so they can't be moved by accident.
function isWhite(hex) { const [r, g, b] = rgb(hex); return r > 245 && g > 245 && b > 245 }
function colourAsset(hex) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" preserveAspectRatio="none"><rect width="16" height="16" fill="${hex}"/></svg>`
  return { id: AssetRecordType.createId(), typeName: 'asset', type: 'image', meta: { role: 'colour', colour: hex },
    props: { name: `colour ${hex}`, src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), w: 16, h: 16, mimeType: 'image/svg+xml', isAnimated: false } }
}
function colourBox(x, y, w, h, assetId, pageId, meta, locked = false) {
  return {
    id: createShapeId(), type: 'image', parentId: pageId, x, y, isLocked: locked, meta,
    props: { w: Math.max(1, w), h: Math.max(1, h), assetId, playing: true, url: '', crop: null, flipX: false, flipY: false, altText: '' },
  }
}

/**
 * Build the imported slides: replacing the editor's document, or with { append: true } after its last slide.
 * Returns a short summary, including the ids of the new slides.
 */
export function buildFromImport(editor, data, { append = false } = {}) {
  if (data?.format !== IMPORT_FORMAT || !Array.isArray(data.slides)) throw new Error('not a Stepboard import file')
  const k = SLIDE_W / (data.slide?.width || 1920)
  const oldPages = append ? [] : editor.getPages().map((p) => p.id)
  let index = append ? editor.getPages().at(-1)?.index : null
  const newPages = []
  let strokes = 0, texts = 0, images = 0

  editor.run(() => {
    // Images: one tldraw asset per image file, shared by every slide that uses it.
    const assetIds = {}
    const assets = Object.entries(data.assets || {}).map(([key, a]) => {
      const id = AssetRecordType.createId()
      assetIds[key] = id
      return { id, typeName: 'asset', type: 'image', meta: {},
        props: { name: a.name || 'image', src: a.src, w: a.w || 1, h: a.h || 1, mimeType: a.mime || null, isAnimated: false } }
    })
    const colours = {}
    const colourId = (hex) => {
      if (!colours[hex]) { const a = colourAsset(hex); colours[hex] = a.id; assets.push(a) }
      return colours[hex]
    }
    for (const slide of data.slides) {
      if (slide.background && !isWhite(slide.background)) colourId(slide.background)
      for (const item of slide.items || []) if (item.type === 'rect' && item.fill) colourId(item.fill)
    }
    if (assets.length) editor.createAssets(assets)

    data.slides.forEach((slide, i) => {
      const pageId = PageRecordType.createId()
      if (append) index = getIndexAbove(index)
      editor.createPage({ id: pageId, name: slide.name || `Slide ${i + 1}`, ...(append ? { index } : {}) })
      newPages.push(pageId)
      const shapes = []
      if (slide.background && !isWhite(slide.background)) {
        shapes.push(colourBox(0, 0, SLIDE_W, SLIDE_H, colours[slide.background], pageId, { in: 0, role: 'background', sourceColor: slide.background }, true))
      }
      const groups = new Map()
      for (const item of slide.items || []) {
        const shape = item.type === 'stroke' ? strokeShape(item, k, pageId)
          : item.type === 'text' ? textShape(item, k, pageId)
          : item.type === 'rect' && item.fill ? colourBox(item.x * k, item.y * k, item.w * k, item.h * k, colours[item.fill], pageId, { ...stepMeta(item), sourceColor: item.fill })
          : item.type === 'image' && assetIds[item.asset] ? imageShape(item, k, pageId, assetIds[item.asset]) : null
        if (!shape) continue
        if (item.type === 'stroke' || item.type === 'rect') strokes++; else if (item.type === 'text') texts++; else images++
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
  return { slides: newPages.length, pageIds: newPages, strokes, texts, images, warnings: data.warnings || [] }
}
