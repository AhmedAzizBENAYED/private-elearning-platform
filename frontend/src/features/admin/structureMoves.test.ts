import { describe, expect, it } from 'vitest'

import { adminLessons, adminModules } from '../../test/courseFixtures'

import type { CourseStructure } from './api'
import type { ModuleWithLessons } from './structureModel'
import {
  entriesFromStructure,
  moveLesson,
  moveModule,
  previewStructure,
  stepLesson,
  stepModule,
  structureOrder,
  type StructureOrder,
} from './structureMoves'

/**
 * FE-LESSON-REORDER-01 - the pure half of a move: the body of
 * `PUT /admin/courses/{id}/structure` computed from the screen, and the
 * server's answer turned back into the screen.
 */

// M1: A, B · M2: C, D · M3: (empty) - the backend ticket's own example.
const ORDER: StructureOrder = {
  modules: [
    { id: 'M1', lesson_ids: ['A', 'B'] },
    { id: 'M2', lesson_ids: ['C', 'D'] },
    { id: 'M3', lesson_ids: [] },
  ],
}
const shape = (order: StructureOrder | null) =>
  order === null ? null : order.modules.map((module) => `${module.id}:${module.lesson_ids.join(',')}`)

describe('moveLesson - to another module', () => {
  it('moves A between C and D, as the backend ticket draws it', () => {
    expect(shape(moveLesson(ORDER, 'A', 'M1', 'M2', 1))).toEqual(['M1:B', 'M2:C,A,D', 'M3:'])
  })

  it.each([
    [0, 'M2:A,C,D'],
    [1, 'M2:C,A,D'],
    [2, 'M2:C,D,A'],
  ])('puts it at index %i of the destination', (index, destination) => {
    expect(shape(moveLesson(ORDER, 'A', 'M1', 'M2', index))![1]).toBe(destination)
  })

  it('moves into an empty module', () => {
    expect(shape(moveLesson(ORDER, 'B', 'M1', 'M3', 0))).toEqual(['M1:A', 'M2:C,D', 'M3:B'])
  })

  it('can empty the source module', () => {
    const once = moveLesson(ORDER, 'A', 'M1', 'M3', 0)!
    expect(shape(moveLesson(once, 'B', 'M1', 'M3', 1))).toEqual(['M1:', 'M2:C,D', 'M3:A,B'])
  })

  it('keeps every lesson exactly once', () => {
    const moved = moveLesson(ORDER, 'C', 'M2', 'M1', 1)!
    const lessons = moved.modules.flatMap((module) => module.lesson_ids)
    expect([...lessons].sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(moved.modules.map((module) => module.id)).toEqual(['M1', 'M2', 'M3'])
  })

  it.each([
    ['the lesson is not in the source', 'C', 'M1', 'M2', 0],
    ['the source is unknown', 'A', 'MX', 'M2', 0],
    ['the destination is unknown', 'A', 'M1', 'MX', 0],
    ['the index is past the end', 'A', 'M1', 'M2', 3],
    ['the index is negative', 'A', 'M1', 'M2', -1],
    ['nothing would change', 'A', 'M1', 'M1', 0],
  ])('refuses when %s', (_why, lesson, source, destination, index) => {
    expect(moveLesson(ORDER, lesson, source, destination, index)).toBeNull()
  })

  it('never mutates the order it was given', () => {
    const before = JSON.stringify(ORDER)
    moveLesson(ORDER, 'A', 'M1', 'M2', 1)
    moveModule(ORDER, 'M3', 0)
    expect(JSON.stringify(ORDER)).toBe(before)
  })
})

describe('the arrows', () => {
  it('moves a lesson down and up within its module', () => {
    expect(shape(stepLesson(ORDER, 'A', 'down'))![0]).toBe('M1:B,A')
    expect(shape(stepLesson(ORDER, 'D', 'up'))![1]).toBe('M2:D,C')
  })

  it('goes nowhere past either end of a module', () => {
    expect(stepLesson(ORDER, 'A', 'up')).toBeNull()
    expect(stepLesson(ORDER, 'B', 'down')).toBeNull()
    expect(stepLesson(ORDER, 'Z', 'down')).toBeNull()
  })

  it('moves a module, with its lessons, up and down', () => {
    expect(shape(stepModule(ORDER, 'M2', 'up'))).toEqual(['M2:C,D', 'M1:A,B', 'M3:'])
    expect(shape(stepModule(ORDER, 'M1', 'down'))).toEqual(['M2:C,D', 'M1:A,B', 'M3:'])
    expect(stepModule(ORDER, 'M1', 'up')).toBeNull()
    expect(stepModule(ORDER, 'M3', 'down')).toBeNull()
  })

  it('moves a module anywhere', () => {
    expect(shape(moveModule(ORDER, 'M3', 0))).toEqual(['M3:', 'M1:A,B', 'M2:C,D'])
    expect(moveModule(ORDER, 'M1', 3)).toBeNull()
  })
})

// -------------------------------------------------------------- screen <-> body

const M1 = adminModules[0]!
const M2 = adminModules[1]!
const [VIDEO, DOCUMENT, TEXT] = [adminLessons[0]!, adminLessons[1]!, adminLessons[2]!]
const ENTRIES: ModuleWithLessons[] = [
  { module: M1, lessons: [VIDEO, DOCUMENT], lessonsFailed: false },
  { module: M2, lessons: [TEXT], lessonsFailed: false },
]

describe('from the screen to the body and back', () => {
  it('builds the body from the order shown, ids only', () => {
    expect(structureOrder(ENTRIES)).toEqual({
      modules: [
        { id: M1.id, lesson_ids: [VIDEO.id, DOCUMENT.id] },
        { id: M2.id, lesson_ids: [TEXT.id] },
      ],
    })
  })

  it('builds none while a module s lessons are unknown', () => {
    expect(structureOrder([ENTRIES[0]!, { module: M2, lessons: [], lessonsFailed: true }])).toBeNull()
  })

  it('previews the order asked for, numbered as the server numbers', () => {
    const order = moveLesson(structureOrder(ENTRIES)!, DOCUMENT.id, M1.id, M2.id, 0)!
    const preview = previewStructure(ENTRIES, order)

    expect(preview[0]!.lessons.map((lesson) => [lesson.id, lesson.position])).toEqual([[VIDEO.id, 1]])
    expect(preview[1]!.lessons.map((lesson) => [lesson.id, lesson.module_id, lesson.position])).toEqual([
      [DOCUMENT.id, M2.id, 1],
      [TEXT.id, M2.id, 2],
    ])
    // Everything else about a row is left as it was.
    expect(preview[1]!.lessons[0]).toMatchObject({ title: DOCUMENT.title, content_type: 'DOCUMENT' })
  })

  it('takes the server s answer as it is: its order, its positions, its fields', () => {
    const answer: CourseStructure = {
      course_id: M1.course_id,
      modules: [
        { ...M2, position: 1, lessons: [{ ...TEXT, position: 1, updated_at: 'later' }] },
        { ...M1, position: 2, lessons: [{ ...DOCUMENT, position: 1 }, { ...VIDEO, position: 2 }] },
      ],
    }

    const entries = entriesFromStructure(answer)

    expect(entries.map((entry) => [entry.module.id, entry.module.position])).toEqual([
      [M2.id, 1],
      [M1.id, 2],
    ])
    expect(entries[0]!.lessons[0]!.updated_at).toBe('later')
    expect(entries[1]!.lessons.map((lesson) => lesson.id)).toEqual([DOCUMENT.id, VIDEO.id])
    expect(entries.every((entry) => entry.lessonsFailed === false)).toBe(true)
    expect(entries[0]!.module).not.toHaveProperty('lessons')
  })
})
