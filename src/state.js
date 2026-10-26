// Editor state shared between the editor's components: the current build step per slide and the board view.
import { atom } from 'tldraw'
import { inOf, outOf } from './model.js'

export const stepsAtom = atom('steps', {})    // pageId -> current step
export const viewAtom = atom('view', 'ghost')  // 'ghost' | 'audience' | 'all' | 'map'

export const stepOf = (editor, pageId = editor.getCurrentPageId()) => stepsAtom.get()[pageId] ?? 0
export const setStep = (pageId, s) => stepsAtom.update((m) => ({ ...m, [pageId]: Math.max(0, s) }))

export const topShapes = (editor, pageId = editor.getCurrentPageId()) =>
  editor.getSortedChildIdsForParent(pageId).map((id) => editor.getShape(id)).filter(Boolean)

/**
 * Go to a build step and select what it shows: the objects that appear at it, or, for a step that only
 * removes things, the objects that disappear at it. Returns how many objects were selected.
 */
export function selectStepItems(editor, step, kind = 'auto') {
  const pageId = editor.getCurrentPageId()
  const tops = topShapes(editor, pageId).filter((s) => !s.isLocked)
  const appear = () => tops.filter((s) => inOf(s) === step).map((s) => s.id)
  const vanish = () => tops.filter((s) => outOf(s) === step).map((s) => s.id)
  let ids = kind === 'out' ? vanish() : appear()
  if (!ids.length && kind === 'auto' && step > 0) ids = vanish()
  setStep(pageId, step)
  editor.setCurrentTool('select')
  editor.setSelectedShapes(ids)
  return ids.length
}
