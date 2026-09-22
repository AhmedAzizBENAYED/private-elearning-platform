import { describe, expect, it } from 'vitest'

import { learningContent, learningLessonIds } from '../../test/courseFixtures'

import { needsLessonContent, orderedLessons, placeLesson, safeExternalUrl } from './model'

describe('orderedLessons', () => {
  it('walks modules and lessons by backend position, not by array order', () => {
    // The fixture deliberately lists module 2 before module 1, and the LINK
    // lesson before the TEXT one.
    expect(orderedLessons(learningContent).map((entry) => entry.lesson.title)).toEqual([
      'Introduction',
      'Python cheat sheet',
      'Practice exercises',
      'Further reading',
    ])
  })

  it('is empty for a course with no module', () => {
    expect(orderedLessons({ ...learningContent, modules: [] })).toEqual([])
  })
})

describe('placeLesson', () => {
  it('locates the lesson and numbers it within its module', () => {
    const placement = placeLesson(learningContent, learningLessonIds.text)

    expect(placement?.lesson.title).toBe('Practice exercises')
    expect(placement?.module.position).toBe(2)
    expect(placement?.numberInModule).toBe(1)
    expect(placement?.lessonsInModule).toBe(2)
  })

  it('links previous and next across a module boundary', () => {
    const placement = placeLesson(learningContent, learningLessonIds.text)

    // The previous lesson is the last of module 1, not of module 2.
    expect(placement?.previous?.title).toBe('Python cheat sheet')
    expect(placement?.next?.title).toBe('Further reading')
  })

  it('has no previous at the start of the course', () => {
    const placement = placeLesson(learningContent, learningLessonIds.introduction)

    expect(placement?.previous).toBeNull()
    expect(placement?.next?.title).toBe('Python cheat sheet')
  })

  it('has no next at the end of the course', () => {
    const placement = placeLesson(learningContent, learningLessonIds.link)

    expect(placement?.next).toBeNull()
    expect(placement?.previous?.title).toBe('Practice exercises')
  })

  it('is null for a lesson that belongs to another course', () => {
    // The caller must then show "unavailable" rather than fall back to a lesson
    // the URL did not ask for.
    expect(placeLesson(learningContent, '00000000-0000-4000-8000-000000000000')).toBeNull()
  })
})

describe('needsLessonContent', () => {
  it('is true only for the kinds whose content the backend actually returns', () => {
    expect(needsLessonContent('TEXT')).toBe(true)
    expect(needsLessonContent('LINK')).toBe(true)
  })

  it('is false for the stored kinds, whose content the backend blanks', () => {
    expect(needsLessonContent('VIDEO')).toBe(false)
    expect(needsLessonContent('DOCUMENT')).toBe(false)
  })
})

describe('safeExternalUrl', () => {
  it('passes an http(s) URL through', () => {
    expect(safeExternalUrl('https://docs.python.org/3/tutorial/')).toBe(
      'https://docs.python.org/3/tutorial/',
    )
    expect(safeExternalUrl('http://example.org/')).toBe('http://example.org/')
  })

  it('rejects every scheme that could execute or embed', () => {
    for (const hostile of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      expect(safeExternalUrl(hostile)).toBeNull()
    }
  })

  it('rejects anything that is not a URL at all', () => {
    expect(safeExternalUrl('not a url')).toBeNull()
    expect(safeExternalUrl('')).toBeNull()
    expect(safeExternalUrl(null)).toBeNull()
  })
})
