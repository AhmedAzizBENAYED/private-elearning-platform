import { describe, expect, it } from 'vitest'

import { catalogLessonsByModule, catalogModules, courseContent } from '../../test/courseFixtures'

import {
  formatDuration,
  outlineFromCatalog,
  outlineFromContent,
  spokenDuration,
} from './courseDetails'

const lessonsByModule = new Map(Object.entries(catalogLessonsByModule))

describe('outlineFromContent', () => {
  it('keeps the backend order of modules and lessons', () => {
    const outline = outlineFromContent(courseContent)

    expect(outline.modules.map((module) => module.title)).toEqual([
      'Getting started',
      'Functions and structure',
    ])
    expect(outline.modules[0]?.lessons.map((lesson) => lesson.title)).toEqual([
      'Introduction',
      'Python cheat sheet',
    ])
  })

  it('counts modules, lessons and videos from what the backend returned', () => {
    const outline = outlineFromContent(courseContent)

    // Two modules, three lessons, of which two are videos - counted, not
    // invented: no course shape carries these numbers.
    expect(outline.moduleCount).toBe(2)
    expect(outline.lessonCount).toBe(3)
    expect(outline.videoCount).toBe(2)
  })

  it('counts a module completion from the backend completion flags', () => {
    const outline = outlineFromContent(courseContent)

    expect(outline.modules[0]?.completedVideoCount).toBe(1)
    expect(outline.modules[0]?.videoCount).toBe(1)
    expect(outline.modules[1]?.completedVideoCount).toBe(0)
  })

  it('carries a non-video lesson through with no completion at all', () => {
    const outline = outlineFromContent(courseContent)
    const document_ = outline.modules[0]?.lessons[1]

    expect(document_?.contentType).toBe('DOCUMENT')
    expect(document_?.completed).toBeNull()
    expect(document_?.durationSeconds).toBeNull()
  })
})

describe('outlineFromCatalog', () => {
  it('builds the same structure the enrolled outline has', () => {
    const outline = outlineFromCatalog(catalogModules, lessonsByModule)

    expect(outline.moduleCount).toBe(2)
    expect(outline.lessonCount).toBe(3)
    expect(outline.videoCount).toBe(2)
  })

  it('reports no progress whatsoever, because the endpoint carries none', () => {
    const outline = outlineFromCatalog(catalogModules, lessonsByModule)

    for (const module of outline.modules) {
      expect(module.completedVideoCount).toBeNull()
      for (const lesson of module.lessons) expect(lesson.completed).toBeNull()
    }
  })

  it('keeps a module whose lessons could not be listed, rather than dropping it', () => {
    const outline = outlineFromCatalog(catalogModules, new Map())

    expect(outline.moduleCount).toBe(2)
    expect(outline.lessonCount).toBe(0)
  })
})

describe('formatDuration', () => {
  it('formats the board figures', () => {
    expect(formatDuration(384)).toBe('06:24')
    expect(formatDuration(690)).toBe('11:30')
    expect(formatDuration(1267)).toBe('21:07')
  })

  it('adds an hour segment past 3600 seconds', () => {
    expect(formatDuration(3661)).toBe('1:01:01')
  })

  it('is null when the backend stores no duration', () => {
    // Every non-video lesson has `duration_seconds: null`.
    expect(formatDuration(null)).toBeNull()
  })
})

describe('spokenDuration', () => {
  it('reads as words, not as a clock time', () => {
    expect(spokenDuration(384)).toBe('6 minutes 24 seconds')
    expect(spokenDuration(60)).toBe('1 minute')
    expect(spokenDuration(9)).toBe('9 seconds')
  })

  it('is null when there is no duration', () => {
    expect(spokenDuration(null)).toBeNull()
  })
})
