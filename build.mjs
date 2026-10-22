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
console.log('built', (html.length / 1e6).toFixed(2), 'MB')
