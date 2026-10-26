// Builds Stepboard into dist/: a complete static website (editor at index.html, player at present.html).
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs'

rmSync('dist', { recursive: true, force: true })
mkdirSync('dist', { recursive: true })

const common = {
  bundle: true, minify: true, format: 'iife', write: false, outdir: 'out',
  target: ['safari16'], jsx: 'automatic', legalComments: 'none',
}
const scriptSafe = (s) => s.replace(/<\/script/gi, '<\\/script')
const pick = (r, ext) => r.outputFiles.find((f) => f.path.endsWith(ext))?.text ?? ''
const define = (extra = {}) => ({ 'process.env.NODE_ENV': '"production"', ...extra })

// 1. Player runtime, inlined into exported HTML files so they work offline.
const runtime = pick(await build({ ...common, entryPoints: ['src/runtime.js'], define: define() }), '.js')
const revealCss = readFileSync('node_modules/reveal.js/dist/reveal.css', 'utf8')

// 2. Editor.
const ed = await build({
  ...common, entryPoints: ['src/App.jsx'],
  define: define({ __PLAYER_RUNTIME__: JSON.stringify(runtime), __REVEAL_CSS__: JSON.stringify(revealCss) }),
})
const editorHtml = readFileSync('src/index.template.html', 'utf8')
  .replace('/*VENDOR_CSS*/', () => pick(ed, '.css')).replace('/*BUNDLE*/', () => scriptSafe(pick(ed, '.js')))

// 3. Player page.
const pl = await build({ ...common, entryPoints: ['src/present.js'], define: define() })
const playerHtml = readFileSync('src/present.template.html', 'utf8')
  .replace('/*VENDOR_CSS*/', () => pick(pl, '.css')).replace('/*BUNDLE*/', () => scriptSafe(pick(pl, '.js')))

// MathJax (TeX → SVG) for formula shapes, loaded by the editor when a formula is first edited.
const mj = await build({ ...common, entryPoints: ['src/mathjax-entry.js'], define: define() })
mkdirSync('dist/assets', { recursive: true })
writeFileSync('dist/assets/mathjax.js', pick(mj, '.js'))
cpSync('node_modules/mathjax-full/LICENSE', 'dist/assets/MATHJAX-LICENSE.txt')

// tldraw's icons and translations, served next to the page.
const a = 'node_modules/@tldraw/assets'
for (const d of ['translations', 'embed-icons']) cpSync(`${a}/${d}`, `dist/assets/${d}`, { recursive: true })
// Text fonts: Adobe's Source family (SIL Open Font License) instead of tldraw's IBM Plex and Shantell Sans.
// The file names here must match FONT_FILES in src/fonts.js.
mkdirSync('dist/assets/fonts', { recursive: true })
for (const [pkg, base] of [['source-sans', 'SourceSans3'], ['source-serif', 'SourceSerif4'], ['source-code-pro', 'SourceCodePro']]) {
  for (const v of ['Regular', 'It', 'Bold', 'BoldIt']) cpSync(`node_modules/${pkg}/WOFF2/TTF/${base}-${v}.ttf.woff2`, `dist/assets/fonts/${base}-${v}.woff2`)
  cpSync(`node_modules/${pkg}/LICENSE.md`, `dist/assets/fonts/${base}-LICENSE.md`)
}
mkdirSync('dist/assets/icons/icon', { recursive: true })
cpSync(`${a}/icons/icon/0_merged.svg`, 'dist/assets/icons/icon/0_merged.svg')

// Pages. The manifest makes "Add to Home Screen" on the iPad open the editor full screen.
const head = (extra = '') => [
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
  '<link rel="apple-touch-icon" href="icon-180.png">',
  extra,
  '<style>html,body{margin:0}</style>',
].join('')
const page = (h, body) => `<!doctype html><html lang="en"><head>${h}</head><body>${body}</body></html>`
writeFileSync('dist/index.html', page(head('<meta name="apple-mobile-web-app-title" content="Stepboard"><link rel="manifest" href="manifest.webmanifest">'), editorHtml))
writeFileSync('dist/present.html', page(head('<meta name="apple-mobile-web-app-title" content="Stepboard Player">'), playerHtml))
cpSync('static', 'dist', { recursive: true })
cpSync('LICENSES/tldraw-3.15.6-LICENSE.md', 'dist/TLDRAW-LICENSE.md')

console.log('editor', (editorHtml.length / 1e6).toFixed(2), 'MB · player', (playerHtml.length / 1e3).toFixed(0), 'KB · runtime', (runtime.length / 1e3).toFixed(0), 'KB')
