// Text fonts for tldraw's four font slots: Adobe's Source family (SIL Open Font License, see dist/assets/fonts/).
// tldraw's own handwriting slot ("draw") gets Source Sans as well: Stepboard's handwriting is pen strokes, and
// text that older decks or tldraw's defaults put in that slot then matches the rest. build.mjs copies the files.
const FAMILIES = { sans: 'SourceSans3', serif: 'SourceSerif4', mono: 'SourceCodePro', draw: 'SourceSans3' }
const VARIANTS = { '': 'Regular', _italic: 'It', _bold: 'Bold', _italic_bold: 'BoldIt' }

/** The `fonts` part of tldraw's assetUrls, for font files served from `base`. */
export function fontUrls(base) {
  const out = {}
  for (const [slot, file] of Object.entries(FAMILIES)) {
    for (const [suffix, v] of Object.entries(VARIANTS)) out[`tldraw_${slot}${suffix}`] = `${base}/${file}-${v}.woff2`
  }
  return out
}

/** Saved with each deck; slide pictures made with other fonts are re-rendered when the deck is opened. */
export const FONTS = 'source-1'

/** Drop cached slide pictures that contain text rendered with another font set (they embed those fonts). */
export function withoutStaleText(deck, cache) {
  if (deck?.fonts === FONTS) return cache
  return Object.fromEntries(Object.entries(cache).filter(([, layers]) => !(layers || []).some((l) => l.svg?.includes('@font-face'))))
}
