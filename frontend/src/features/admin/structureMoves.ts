import type { CourseStructure, CourseStructureInput } from './api'
import type { ModuleWithLessons } from './structureModel'

/**
 * Moving modules and lessons (Admin-Course-Editor: "Reorder with ... the ↑ ↓
 * buttons (keyboard and touch friendly)").
 *
 * Every move is one `PUT /admin/courses/{id}/structure` (BE-COURSE-REORDER-01):
 * the course's complete structure in the order wanted - module ids, each with
 * its lesson ids - and the server applies it in one transaction and answers
 * with the structure as stored. The functions here are pure: they compute that
 * body from what is on screen, and turn the server's answer back into what is
 * on screen. No position is ever sent; the server numbers each list 1..n.
 */

export type Direction = 'up' | 'down'

export interface Positioned {
  id: string
  position: number
}

/** The body of `PUT .../structure`. */
export type StructureOrder = CourseStructureInput

/** The sibling a row swaps with, or `null` at either end. `items` is sorted. */
export function neighbourOf<Item extends Positioned>(
  items: readonly Item[],
  id: string,
  direction: Direction,
): Item | null {
  const index = items.findIndex((item) => item.id === id)
  if (index === -1) return null
  return items[direction === 'up' ? index - 1 : index + 1] ?? null
}

/**
 * The structure on screen, as the request body, in the order shown.
 *
 * `null` when a module's lessons could not be read: the body must list every
 * lesson of the course, and one built without them would be refused - or
 * worse, read as asking for a module to be emptied.
 */
export function structureOrder(entries: readonly ModuleWithLessons[]): StructureOrder | null {
  if (entries.some((entry) => entry.lessonsFailed)) return null
  return {
    modules: entries.map((entry) => ({
      id: entry.module.id,
      lesson_ids: entry.lessons.map((lesson) => lesson.id),
    })),
  }
}

/** The same structure with the module at `destinationIndex`; `null` if it cannot go there. */
export function moveModule(order: StructureOrder, moduleId: string, destinationIndex: number): StructureOrder | null {
  const index = order.modules.findIndex((module) => module.id === moduleId)
  if (index === -1 || destinationIndex < 0 || destinationIndex >= order.modules.length) return null
  if (index === destinationIndex) return null
  const modules = [...order.modules]
  const [moved] = modules.splice(index, 1)
  modules.splice(destinationIndex, 0, moved!)
  return { modules }
}

/**
 * The same structure with a lesson taken out of `sourceModuleId` and put at
 * `destinationIndex` of `destinationModuleId` - the same module or another one
 * of the course. `null` when the lesson is not in the source, the destination
 * is unknown, the index is out of range or nothing would change.
 *
 * The ↑ ↓ buttons use it within a module; a move to another module - which the
 * endpoint supports - needs no other code, only a control to call it.
 */
export function moveLesson(
  order: StructureOrder,
  lessonId: string,
  sourceModuleId: string,
  destinationModuleId: string,
  destinationIndex: number,
): StructureOrder | null {
  const source = order.modules.find((module) => module.id === sourceModuleId)
  const destination = order.modules.find((module) => module.id === destinationModuleId)
  if (source === undefined || destination === undefined) return null
  const from = source.lesson_ids.indexOf(lessonId)
  if (from === -1) return null

  const sameModule = sourceModuleId === destinationModuleId
  const withoutLesson = source.lesson_ids.filter((id) => id !== lessonId)
  const target = sameModule ? [...withoutLesson] : [...destination.lesson_ids]
  if (destinationIndex < 0 || destinationIndex > target.length) return null
  if (sameModule && destinationIndex === from) return null
  target.splice(destinationIndex, 0, lessonId)

  return {
    modules: order.modules.map((module) =>
      module.id === destinationModuleId
        ? { ...module, lesson_ids: target }
        : module.id === sourceModuleId
          ? { ...module, lesson_ids: withoutLesson }
          : module,
    ),
  }
}

/** One module one place up or down; `null` at either end. */
export function stepModule(order: StructureOrder, moduleId: string, direction: Direction): StructureOrder | null {
  const index = order.modules.findIndex((module) => module.id === moduleId)
  if (index === -1) return null
  return moveModule(order, moduleId, direction === 'up' ? index - 1 : index + 1)
}

/** One lesson one place up or down within its module; `null` at either end. */
export function stepLesson(order: StructureOrder, lessonId: string, direction: Direction): StructureOrder | null {
  const module = order.modules.find((entry) => entry.lesson_ids.includes(lessonId))
  if (module === undefined) return null
  const index = module.lesson_ids.indexOf(lessonId)
  return moveLesson(order, lessonId, module.id, module.id, direction === 'up' ? index - 1 : index + 1)
}

/**
 * The screen while the request is out: the rows in the order asked for,
 * numbered as the server will number them (1..n, its documented rule). Only a
 * preview - the server's answer replaces it, or the previous screen comes back.
 */
export function previewStructure(entries: readonly ModuleWithLessons[], order: StructureOrder): ModuleWithLessons[] {
  const modules = new Map(entries.map((entry) => [entry.module.id, entry]))
  const lessons = new Map(entries.flatMap((entry) => entry.lessons.map((lesson) => [lesson.id, lesson] as const)))

  return order.modules.map((item, moduleIndex) => {
    const entry = modules.get(item.id)!
    return {
      ...entry,
      module: { ...entry.module, position: moduleIndex + 1 },
      lessons: item.lesson_ids.map((id, lessonIndex) => ({
        ...lessons.get(id)!,
        module_id: item.id,
        position: lessonIndex + 1,
      })),
    }
  })
}

/** The server's answer as the screen's structure: its order, its positions, its fields. */
export function entriesFromStructure(structure: CourseStructure): ModuleWithLessons[] {
  return structure.modules.map(({ lessons, ...module }) => ({ module, lessons, lessonsFailed: false }))
}
