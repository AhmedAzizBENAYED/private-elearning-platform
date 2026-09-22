import { describe, expect, it } from 'vitest'

import { courseContent } from '../../test/courseFixtures'

import { continueTargetFrom } from './courseDetails'

describe('continueTargetFrom', () => {
  it('finds the first unfinished video in course order', () => {
    const target = continueTargetFrom(courseContent)

    expect(target.lesson).toEqual({
      id: 'l2000000-0000-4000-8000-000000000001',
      title: 'Parameters and return values',
      modulePosition: 2,
    })
  })

  it('skips non-video lessons, which carry no completion', () => {
    const target = continueTargetFrom(courseContent)

    expect(target.lesson?.title).not.toBe('Python cheat sheet')
  })

  it('carries the backend counts rather than recomputing them', () => {
    const target = continueTargetFrom(courseContent)

    expect(target.completedVideoLessons).toBe(5)
    expect(target.totalVideoLessons).toBe(11)
    expect(target.progressPercent).toBe(45.45)
  })

  it('returns no lesson when every video is done', () => {
    const finished = {
      ...courseContent,
      modules: courseContent.modules.map((module) => ({
        ...module,
        lessons: module.lessons.map((lesson) =>
          lesson.content_type === 'VIDEO' ? { ...lesson, completed: true } : lesson,
        ),
      })),
    }

    expect(continueTargetFrom(finished).lesson).toBeNull()
  })

  it('returns no lesson for a course that holds no video at all', () => {
    const noVideos = {
      ...courseContent,
      total_video_lessons: 0,
      completed_video_lessons: 0,
      modules: courseContent.modules.map((module) => ({
        ...module,
        lessons: module.lessons.filter((lesson) => lesson.content_type !== 'VIDEO'),
      })),
    }

    expect(continueTargetFrom(noVideos).lesson).toBeNull()
  })

  it('tolerates a module with no lessons', () => {
    const withEmptyModule = {
      ...courseContent,
      modules: [
        { id: 'm0', title: 'Empty', description: null, position: 1, lessons: [] },
        ...courseContent.modules,
      ],
    }

    expect(continueTargetFrom(withEmptyModule).lesson?.title).toBe('Parameters and return values')
  })
})
