// Appending the slides of another Stepboard deck to the open one.
// The other deck's tldraw records (pages, shapes, images, bindings) get fresh ids so nothing collides with the
// open deck, and its cached slide pictures are carried over under the new ids, so nothing needs re-rendering.
import { PageRecordType, AssetRecordType, createShapeId, createBindingId, getIndexAbove } from 'tldraw'

/** Append all slides of `deck` (format "stepboard-deck") after the last slide. Returns { pageIds, cache }. */
export function appendDeck(editor, deck) {
  // Bring the other deck's records up to this editor's tldraw schema first (decks saved by older versions).
  const migrated = editor.store.schema.migrateStoreSnapshot(deck.tldraw)
  if (migrated.type !== 'success') throw new Error('that deck was saved by an incompatible version')
  const records = Object.values(migrated.value)

  const ids = new Map()
  const fresh = (id) => {
    if (!ids.has(id)) {
      const kind = id.split(':')[0]
      ids.set(id, kind === 'page' ? PageRecordType.createId() : kind === 'shape' ? createShapeId()
        : kind === 'asset' ? AssetRecordType.createId() : kind === 'binding' ? createBindingId() : id)
    }
    return ids.get(id)
  }
  const pages = records.filter((r) => r.typeName === 'page').sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0))
  let index = editor.getPages().at(-1)?.index
  const out = []
  for (const p of pages) {
    index = getIndexAbove(index)
    out.push({ ...p, id: fresh(p.id), index })
  }
  for (const r of records) {
    if (r.typeName === 'asset') out.push({ ...r, id: fresh(r.id) })
    if (r.typeName === 'shape') {
      const props = r.props?.assetId ? { ...r.props, assetId: fresh(r.props.assetId) } : r.props
      out.push({ ...r, id: fresh(r.id), parentId: fresh(r.parentId), props })
    }
    if (r.typeName === 'binding') out.push({ ...r, id: fresh(r.id), fromId: fresh(r.fromId), toId: fresh(r.toId) })
  }
  editor.run(() => {
    editor.store.put(out.filter((r) => r.typeName === 'page' || r.typeName === 'asset'))
    editor.store.put(out.filter((r) => r.typeName === 'shape'))
    editor.store.put(out.filter((r) => r.typeName === 'binding'))
  })

  // Cached slide pictures, re-keyed to the new page ids, with image layers pointing at the new asset ids.
  const cache = {}
  for (const s of deck.slides || []) {
    if (!ids.has(s.pageId)) continue
    cache[ids.get(s.pageId)] = (s.layers || []).map((l) => (l.image ? { ...l, image: { ...l.image, asset: fresh(l.image.asset) } } : l))
  }
  return { pageIds: pages.map((p) => ids.get(p.id)), cache }
}
