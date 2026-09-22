import { useCallback, useMemo, useRef, useState } from 'react'

import { useApiClient } from '../../api'

import { createAdminApi, type AdminLesson } from './api'
import type { MoveFocus } from './components/StructureModule'
import type { ModuleWithLessons } from './structureModel'
import {
  entriesFromStructure,
  previewStructure,
  stepLesson,
  stepModule,
  structureOrder,
  type Direction,
  type StructureOrder,
} from './structureMoves'
import { classifyWrite, type CourseWriteFailure } from './useAdminCourse'

/**
 * Why a move did not happen: the server's refusal, or `incomplete` - a
 * module's lessons could not be read, so no complete structure can be sent.
 */
export type MoveFailure = CourseWriteFailure | 'incomplete'

export interface StructureMoves {
  moveModule: (moduleId: string, direction: Direction) => void
  moveLesson: (lesson: AdminLesson, direction: Direction) => void
  /** A move is being written; further presses are ignored until it settles. */
  moving: boolean
  /** Where focus belongs while a move is being written. */
  focus: MoveFocus | null
  /** The last successful move, in words, for the polite live region. */
  announcement: string
}

/**
 * The ↑ ↓ buttons, as the board's DEV NOTE specifies them: "the row moves
 * immediately, positions are re-saved, and a toast appears only on failure
 * (row snaps back)."
 *
 * Each press is one `PUT /admin/courses/{id}/structure` carrying the whole
 * structure in the new order (BE-COURSE-REORDER-01). While it is out the rows
 * show the order asked for; the server's answer then replaces them - its
 * order and its positions, whatever was asked. The write is atomic, so a
 * failure means the server changed nothing: the structure shown before the
 * press comes back as it was, with no re-read and no repair write.
 *
 * One move at a time. A second press while a move is in flight is ignored -
 * the arrows stay enabled, since disabling the button under the keyboard focus
 * would drop that focus on the body.
 */
export function useStructureMoves({
  courseId,
  modules,
  update,
  onFailed,
}: {
  courseId: string
  modules: ModuleWithLessons[]
  update: (change: (modules: ModuleWithLessons[]) => ModuleWithLessons[]) => void
  onFailed: (reason: MoveFailure) => void
}): StructureMoves {
  const client = useApiClient()
  const api = useMemo(() => createAdminApi(client), [client])
  const inFlight = useRef(false)
  const seq = useRef(0)
  const [moving, setMoving] = useState(false)
  const [focus, setFocus] = useState<MoveFocus | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const write = useCallback(
    (id: string, direction: Direction, next: StructureOrder, describe: (saved: ModuleWithLessons[]) => string) => {
      inFlight.current = true
      const before = modules
      setMoving(true)
      setAnnouncement('')
      seq.current += 1
      setFocus({ id, direction, seq: seq.current })
      update(() => previewStructure(before, next))

      void api
        .replaceStructure(courseId, next)
        .then(
          (stored) => {
            const saved = entriesFromStructure(stored)
            update(() => saved)
            setAnnouncement(describe(saved))
          },
          (error: unknown) => {
            update(() => before)
            onFailed(classifyWrite(error))
          },
        )
        .finally(() => {
          inFlight.current = false
          setMoving(false)
          // Applied when the row moved; cleared so a later re-render of the
          // structure - a reload, a deletion - never pulls focus back to it.
          setFocus(null)
        })
    },
    [modules, update, api, courseId, onFailed],
  )

  const moveModule = useCallback(
    (moduleId: string, direction: Direction) => {
      if (inFlight.current) return
      const order = structureOrder(modules)
      if (order === null) {
        onFailed('incomplete')
        return
      }
      const next = stepModule(order, moduleId, direction)
      if (next === null) return

      write(moduleId, direction, next, (saved) => {
        const moved = saved.find((entry) => entry.module.id === moduleId)?.module
        return moved === undefined ? '' : `Module “${moved.title}” moved to position ${moved.position}.`
      })
    },
    [modules, write, onFailed],
  )

  const moveLesson = useCallback(
    (lesson: AdminLesson, direction: Direction) => {
      if (inFlight.current) return
      const order = structureOrder(modules)
      if (order === null) {
        onFailed('incomplete')
        return
      }
      const next = stepLesson(order, lesson.id, direction)
      if (next === null) return

      write(lesson.id, direction, next, (saved) => {
        const moved = saved.flatMap((entry) => entry.lessons).find((item) => item.id === lesson.id)
        return moved === undefined ? '' : `Lesson “${moved.title}” moved to position ${moved.position}.`
      })
    },
    [modules, write, onFailed],
  )

  return { moveModule, moveLesson, moving, focus, announcement }
}
