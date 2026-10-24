// Reading deck files. A deck can arrive as JSON (.stepboard.json, .stepboard-import.json) or inside an HTML file
// exported by Stepboard, which carries the full deck in <script type="application/json" id="sb-deck">.

const DECK_SCRIPT = /<script[^>]*\bid=["']sb-deck["'][^>]*>([\s\S]*?)<\/script>/i

/** Parse the text of a deck file. Throws an Error with a user-facing message if it isn't one. */
export function parseDeckText(text) {
  const t = text.trimStart()
  if (t.startsWith('<')) {
    const m = DECK_SCRIPT.exec(text)
    if (!m) throw new Error('That HTML file has no Stepboard deck inside. Only files from Export HTML can be opened.')
    try { return JSON.parse(m[1]) } catch { throw new Error('The deck inside that HTML file is damaged.') }
  }
  try { return JSON.parse(text) } catch { throw new Error('That file is not valid JSON.') }
}

export const DECK_FILE_ACCEPT = '.json,.html,.htm,application/json,text/html'
