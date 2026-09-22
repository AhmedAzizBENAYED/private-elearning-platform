import { describe, expect, it } from 'vitest'

import {
  catalogAvailable,
  catalogEnrolled,
  enrollmentCompleted,
  enrollmentInProgress,
  enrollmentNewer,
} from '../../test/courseFixtures'

import { availableCourses, continueCourseId, splitEnrollments } from './model'

describe('splitEnrollments', () => {
  it('splits on the backend completed flag, not on the percentage', () => {
    const { inProgress, completed } = splitEnrollments([
      enrollmentInProgress,
      enrollmentCompleted,
    ])

    expect(inProgress.map((row) => row.title)).toEqual(['Python Fundamentals'])
    expect(completed.map((row) => row.title)).toEqual(['Project Management Essentials'])
  })

  it('trusts the server when a 100% course is not marked complete', () => {
    // The backend never completes a course with no videos, whatever the
    // percentage says. Recomputing this on the client would disagree with it.
    const oddity = { ...enrollmentInProgress, progress_percent: 100, completed: false }

    const { inProgress, completed } = splitEnrollments([oddity])

    expect(inProgress).toHaveLength(1)
    expect(completed).toHaveLength(0)
  })

  it('handles an account with no enrollments', () => {
    expect(splitEnrollments([])).toEqual({ inProgress: [], completed: [] })
  })
})

describe('availableCourses', () => {
  it('excludes courses the member is already enrolled in', () => {
    const available = availableCourses(
      [catalogEnrolled, catalogAvailable],
      [enrollmentInProgress],
    )

    expect(available.map((course) => course.title)).toEqual(['Professional Communication'])
  })

  it('returns the whole catalogue when nothing is enrolled', () => {
    expect(availableCourses([catalogEnrolled, catalogAvailable], [])).toHaveLength(2)
  })
})

describe('continueCourseId', () => {
  it('picks the most recently enrolled unfinished course', () => {
    expect(continueCourseId([enrollmentInProgress, enrollmentNewer])).toBe(
      enrollmentNewer.course_id,
    )
  })

  it('is null when nothing is in progress', () => {
    expect(continueCourseId([])).toBeNull()
  })
})
