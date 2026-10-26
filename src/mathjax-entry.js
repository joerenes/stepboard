// LaTeX → SVG for formula shapes: MathJax 3.2.2 with only TeX input and SVG output (no page scanning, menus or
// accessibility extras). Built by build.mjs into dist/assets/mathjax.js, which the editor loads the first time a
// formula is edited. The player never needs it: formula shapes store their SVG.
import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { SVG } from 'mathjax-full/js/output/svg.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js'
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js'
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js'
import 'mathjax-full/js/input/tex/braket/BraketConfiguration.js'
import 'mathjax-full/js/input/tex/physics/PhysicsConfiguration.js'
import 'mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js'
import 'mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js'
import 'mathjax-full/js/input/tex/cancel/CancelConfiguration.js'
import 'mathjax-full/js/input/tex/color/ColorConfiguration.js'

const PACKAGES = ['base', 'ams', 'newcommand', 'braket', 'physics', 'boldsymbol', 'mathtools', 'cancel', 'color']

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)

/**
 * Typeset `tex` (display style). Returns { viewBox, body } where body is the SVG's content, drawn with
 * currentColor in MathJax units (1000 per em). Throws an Error with TeX's message if the source has a mistake.
 */
function tex2svg(tex) {
  // A fresh document each time, so \newcommand definitions don't leak from one formula into the next.
  const doc = mathjax.document('', {
    InputJax: new TeX({ packages: PACKAGES, formatError: (_jax, err) => { throw new Error(err.message) } }),
    OutputJax: new SVG({ fontCache: 'none' }),
  })
  const svg = adaptor.innerHTML(doc.convert(tex, { display: true }))
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1]
  const body = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace(/ data-[a-z-]+="[^"]*"/g, '')
  if (!viewBox) throw new Error('MathJax produced no picture')
  return { viewBox, body }
}

globalThis.StepboardTeX = { tex2svg }
