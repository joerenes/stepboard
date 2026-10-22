// Builds the Stepboard editor into ./dist: index.html (inlined JS + CSS) and assets/ (tldraw fonts, icons, translations).
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs'

rmSync('dist', { recursive: true, force: true })
mkdirSync('dist', { recursive: true })

const r = await build({
  entryPoints: ['src/App.jsx'], bundle: true, minify: true, format: 'iife', write: false, outdir: 'out',
  target: ['safari16'], jsx: 'automatic', legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const js = r.outputFiles.find((f) => f.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script')
const css = r.outputFiles.find((f) => f.path.endsWith('.css')).text
const html = readFileSync('src/index.template.html', 'utf8').replace('/*VENDOR_CSS*/', () => css).replace('/*BUNDLE*/', () => js)
writeFileSync('dist/index.html', html)

const a = 'node_modules/@tldraw/assets'
for (const d of ['fonts', 'translations', 'embed-icons']) cpSync(`${a}/${d}`, `dist/assets/${d}`, { recursive: true })
mkdirSync('dist/assets/icons/icon', { recursive: true })
cpSync(`${a}/icons/icon/0_merged.svg`, 'dist/assets/icons/icon/0_merged.svg')
cpSync('LICENSES/tldraw-3.15.6-LICENSE.md', 'dist/TLDRAW-LICENSE.md')
// dist/site: the same app as a normal website, for static hosting (GitHub/GitLab Pages, Netlify, ...).
// Includes a web app manifest so "Add to Home Screen" on the iPad opens it full screen.
mkdirSync('dist/site', { recursive: true })
const head = [
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="Stepboard">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
  '<link rel="manifest" href="manifest.webmanifest">',
  '<link rel="apple-touch-icon" href="icon-180.png">',
  '<style>html,body{margin:0}</style>',
].join('')
writeFileSync('dist/site/index.html', `<!doctype html><html lang="en"><head>${head}</head><body>${html}</body></html>`)
cpSync('dist/assets', 'dist/site/assets', { recursive: true })
cpSync('static', 'dist/site', { recursive: true })
cpSync('LICENSES/tldraw-3.15.6-LICENSE.md', 'dist/site/TLDRAW-LICENSE.md')
console.log('built', (html.length / 1e6).toFixed(2), 'MB')
