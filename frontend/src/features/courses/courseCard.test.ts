import { describe, expect, it } from 'vitest'

import {
  catalogAvailable,
  catalogEnrolled,
  enrollmentCompleted,
  enrollmentInProgress,
} from '../../test/courseFixtures'

import { catalogCard, descriptionsByCourse, enrollmentCard, enrollmentsByCourse } from './courseCard'

describe('card building', () => {
  it('borrows the description from the catalogue for an enrolled course', () => {
    const card = enrollmentCard(enrollmentInProgress, descriptionsByCourse([catalogEnrolled]))

    expect(card).toEqual({
      courseId: enrollmentInProgress.course_id,
      title: 'Python Fundamentals',
      description: catalogEnrolled.description,
      thumbnailUrl: 'https://cdn.example.org/python.jpg',
      state: 'in-progress',
      progressPercent: 45.45,
      // BE-COURSE-CATALOG-01 (G05): the enrollment's own figures, as sent.
      size: { modules: 3, videos: 11 },
      videoProgress: { completed: 5, total: 11 },
    })
  })

  it('leaves the description null when the course is no longer published', () => {
    // An archived course still appears in /me/enrollments but not in /courses,
    // so its description is genuinely unavailable rather than blank.
    const card = enrollmentCard(enrollmentInProgress, descriptionsByCourse([]))

    expect(card.description).toBeNull()
  })

  it('marks a completed enrollment', () => {
    const card = enrollmentCard(enrollmentCompleted, descriptionsByCourse([]))

    expect(card.state).toBe('completed')
    expect(card.progressPercent).toBe(100)
  })

  it('builds a not-enrolled card with no progress at all', () => {
    const card = catalogCard(catalogAvailable)

    expect(card.state).toBe('not-enrolled')
    // Not zero: this member has no progress on this course, which is different.
    expect(card.progressPercent).toBeNull()
  })
})

describe('catalogCard with enrollment state', () => {
  it('marks a catalogue course the member is working through', () => {
    const card = catalogCard(catalogEnrolled, enrollmentsByCourse([enrollmentInProgress]))

    expect(card.state).toBe('in-progress')
    expect(card.progressPercent).toBe(enrollmentInProgress.progress_percent)
  })

  it('marks a catalogue course the member has finished', () => {
    const finished = { ...enrollmentCompleted, course_id: catalogEnrolled.id }
    const card = catalogCard(catalogEnrolled, enrollmentsByCourse([finished]))

    expect(card.state).toBe('completed')
    expect(card.progressPercent).toBe(100)
  })

  it('leaves an unenrolled course with no progress at all', () => {
    const card = catalogCard(catalogAvailable, enrollmentsByCourse([enrollmentInProgress]))

    expect(card.state).toBe('not-enrolled')
    // Not zero: this member has no progress on this course, which differs.
    expect(card.progressPercent).toBeNull()
  })

  it('keeps the catalogue description, which the enrollment row lacks', () => {
    const card = catalogCard(catalogEnrolled, enrollmentsByCourse([enrollmentInProgress]))

    expect(card.description).toBe(catalogEnrolled.description)
  })
})
