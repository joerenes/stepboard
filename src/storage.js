// Browser storage for the deck: one IndexedDB record. Every call is wrapped; failures resolve to null/false.
const DB = 'stepboard'
const STORE = 'decks'
const KEY = 'current'

function open() {
  return new Promise((resolve, reject) => {
    let req
    try { req = indexedDB.open(DB, 1) } catch (e) { reject(e); return }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function loadDeck() {
  try {
    const db = await open()
    return await new Promise((resolve) => {
      const r = db.transaction(STORE).objectStore(STORE).get(KEY)
      r.onsuccess = () => resolve(r.result ?? null)
      r.onerror = () => resolve(null)
    })
  } catch { return null }
}

export async function saveDeck(deck) {
  try {
    const db = await open()
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(deck, KEY)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
    })
  } catch { return false }
}
