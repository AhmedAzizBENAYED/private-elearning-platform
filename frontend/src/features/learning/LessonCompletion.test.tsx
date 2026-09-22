import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { CourseContent } from '../../api'
import type { AuthHarness } from '../../test/authHarness'
import {
  courseProgressResponse,
  documentResource,
  learningContent,
  learningLessonIds,
  linkLessonDetail,
  pdfBytes,
  progressResponse,
  textLessonDetail,
  videoResource,
} from '../../test/courseFixtures'
import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

/**
 * FE-LEARN-COMPLETED-01 - a completed VIDEO lesson, through its whole life.
 *
 * Completion is the server's: the player reports the position with
 * `PUT /lessons/{id}/progress`, the answer's `completed` is folded into the
 * tree, and a reload reads it back from `GET /courses/{id}/content`. The
 * server below keeps that one piece of state, so a "reload" - a fresh mount of
 * the page - sees exactly what the earlier write stored.
 *
 * DS 08 draws three markers - ✓ completed, ring + dot current, hollow ring not
 * started - and only VIDEO lessons carry one. A completed lesson that is open
 * keeps its ✓; the row's tint and `aria-current` say it is the open one, and
 * it is announced once, as "Completed, current lesson".
 */

const COURSE_ID = learningContent.course_id
const VIDEO = learningLessonIds.introduction
const DURATION = 384
const lessonPath = (lessonId: string) => `/courses/${COURSE_ID}/lessons/${lessonId}`
const progressPath = `/lessons/${VIDEO}/progress`

/** The course tree with its one video not yet watched. */
function unwatched(): CourseContent {
  return {
    ...learningContent,
    completed_video_lessons: 0,
    progress_percent: 0,
    modules: learningContent.modules.map((module) => ({
      ...module,
      lessons: module.lessons.map((lesson) =>
        lesson.id === VIDEO ? { ...lesson, watched_seconds: 0, completed: false, completed_at: null } : lesson,
      ),
    })),
  } as CourseContent
}

/** One course, one member: what a progress write stores, a later read returns. */
function createServer() {
  let content = unwatched()

  function store(watchedSeconds: number) {
    const completed = watchedSeconds >= DURATION - 2
    const done = completed ? 1 : 0
    const total = content.total_video_lessons
    content = {
      ...content,
      completed_video_lessons: done,
      progress_percent: total ? Math.round((done * 10000) / total) / 100 : 0,
      completed: total > 0 && done === total,
      modules: content.modules.map((module) => ({
        ...module,
        lessons: module.lessons.map((lesson) =>
          lesson.id === VIDEO
            ? {
                ...lesson,
                watched_seconds: watchedSeconds,
                completed,
                completed_at: completed ? '2026-09-21T10:00:00Z' : null,
              }
            : lesson,
        ),
      })),
    }
    return { watchedSeconds, completed }
  }

  function install(harness: AuthHarness) {
    harness.http.on(`/courses/${COURSE_ID}/content`, () => ({ json: content }))
    harness.http.on(`/lessons/${learningLessonIds.text}`, { json: textLessonDetail })
    harness.http.on(`/lessons/${learningLessonIds.link}`, { json: linkLessonDetail })
    harness.http.on(`/lessons/${VIDEO}/resource`, { json: videoResource })
    harness.http.on(`/lessons/${learningLessonIds.document}/resource`, { json: documentResource })
    harness.http.on(`/lessons/${learningLessonIds.document}/resource/content`, {
      bytes: pdfBytes,
      contentType: 'application/pdf',
    })
    harness.http.on(progressPath, (call) => {
      const sent = Math.min(DURATION, Number(JSON.parse(call.body ?? '{}').watched_seconds ?? 0))
      const { watchedSeconds, completed } = store(sent)
      return { json: progressResponse({ watchedSeconds, completed }) }
    })
    harness.http.on(`/courses/${COURSE_ID}/progress`, () => ({
      json: courseProgressResponse({
        completedVideoLessons: content.completed_video_lessons,
        totalVideoLessons: content.total_video_lessons,
      }),
    }))
  }

  return { install }
}

type Server = ReturnType<typeof createServer>

const open = (server: Server, lessonId: string, width?: number) =>
  renderRoute({
    path: lessonPath(lessonId),
    as: 'member',
    beforeMount: server.install,
    ...(width ? { width } : {}),
  })

const outline = () => screen.getByRole('navigation', { name: 'Course content' })
const row = (title: string) => within(outline()).getByRole('link', { name: new RegExp(title) })

/** The row's visually hidden status - what assistive technology hears. */
function spokenStatus(title: string): string {
  const hidden = row(title).querySelector('.dsVisuallyHidden')
  return hidden?.textContent?.replace(/^ — /, '') ?? ''
}

/** Whether the row draws the ✓ (the completed marker holds the check icon). */
const hasCheck = (title: string) => row(title).querySelector('[aria-hidden="true"] svg') !== null

/** Plays the open video to its end, as a browser would report it. */
async function watchToTheEnd(container: HTMLElement) {
  const video = (await waitFor(() => {
    const element = container.querySelector('video')
    expect(element).not.toBeNull()
    return element
  })) as HTMLVideoElement
  Object.defineProperty(video, 'duration', { configurable: true, get: () => DURATION })
  Object.defineProperty(video, 'currentTime', { configurable: true, get: () => DURATION, set: () => undefined })
  fireEvent.loadedMetadata(video)
  fireEvent.ended(video)
}

describe('completed lesson - the outline states', () => {
  it('an unfinished video that is open: current, not completed', async () => {
    await open(createServer(), VIDEO)
    await screen.findByRole('heading', { name: 'Introduction', level: 1 })

    expect(row('Introduction')).toHaveAttribute('aria-current', 'page')
    expect(spokenStatus('Introduction')).toBe('Current lesson')
    expect(hasCheck('Introduction')).toBe(false)
  })

  it('an unfinished video that is not open: not started', async () => {
    await open(createServer(), learningLessonIds.document)
    await screen.findByRole('heading', { name: 'Python cheat sheet', level: 1 })

    expect(row('Introduction')).not.toHaveAttribute('aria-current')
    expect(spokenStatus('Introduction')).toBe('Not started')
    expect(hasCheck('Introduction')).toBe(false)
  })

  it('a completed video that is not open: completed, with its check', async () => {
    // `learningContent` has the video completed, as the backend reports it.
    await renderRoute({
      path: lessonPath(learningLessonIds.document),
      as: 'member',
      beforeMount: (harness) => {
        createServer().install(harness)
        harness.http.on(`/courses/${COURSE_ID}/content`, { json: learningContent })
      },
    })
    await screen.findByRole('heading', { name: 'Python cheat sheet', level: 1 })

    expect(row('Introduction')).not.toHaveAttribute('aria-current')
    expect(spokenStatus('Introduction')).toBe('Completed')
    expect(hasCheck('Introduction')).toBe(true)
  })

  it('a completed video that is open: keeps its check, and is announced once as both', async () => {
    await renderRoute({
      path: lessonPath(VIDEO),
      as: 'member',
      beforeMount: (harness) => {
        createServer().install(harness)
        harness.http.on(`/courses/${COURSE_ID}/content`, { json: learningContent })
      },
    })
    await screen.findByRole('heading', { name: 'Introduction', level: 1 })

    expect(row('Introduction')).toHaveAttribute('aria-current', 'page')
    expect(hasCheck('Introduction')).toBe(true)
    expect(spokenStatus('Introduction')).toBe('Completed, current lesson')
    // One statement: no "Not started", and "current" is not said twice.
    expect(row('Introduction')).not.toHaveTextContent('Not started')
    expect(row('Introduction').textContent?.match(/current lesson/gi)).toHaveLength(1)
    // Only one row in the outline is the open one.
    expect(within(outline()).getAllByRole('link', { current: 'page' })).toHaveLength(1)
  })

  it('text, document and link lessons carry no completion marker in any case', async () => {
    await renderRoute({
      path: lessonPath(learningLessonIds.text),
      as: 'member',
      beforeMount: (harness) => {
        createServer().install(harness)
        harness.http.on(`/courses/${COURSE_ID}/content`, { json: learningContent })
      },
    })
    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })

    for (const title of ['Python cheat sheet', 'Further reading']) {
      expect(spokenStatus(title)).toBe('')
      expect(hasCheck(title)).toBe(false)
    }
    // The open one is only the current lesson - never "completed".
    expect(spokenStatus('Practice exercises')).toBe('Current lesson')
    expect(hasCheck('Practice exercises')).toBe(false)
  })
})

describe('completed lesson - the lifecycle', () => {
  it('completes from the server’s answer, survives navigation, and a reload', async () => {
    const server = createServer()
    const { container, harness } = await open(server, VIDEO)
    await screen.findByRole('heading', { name: 'Introduction', level: 1 })

    // 1. Opening the lesson completes nothing.
    expect(spokenStatus('Introduction')).toBe('Current lesson')
    expect(harness.http.callsTo(progressPath)).toHaveLength(0)

    // 2. The video ends; the outline changes only once the server says so.
    await watchToTheEnd(container)
    await waitFor(() => expect(spokenStatus('Introduction')).toBe('Completed, current lesson'))
    expect(harness.http.callsTo(progressPath).length).toBeGreaterThan(0)
    expect(hasCheck('Introduction')).toBe(true)

    // 3. Away to another lesson: the video reads as completed, not current.
    await userEvent.click(row('Python cheat sheet'))
    await screen.findByRole('heading', { name: 'Python cheat sheet', level: 1 })
    expect(spokenStatus('Introduction')).toBe('Completed')
    expect(row('Introduction')).not.toHaveAttribute('aria-current')

    // 4. And back: completed and current again, with its check.
    await userEvent.click(row('Introduction'))
    await screen.findByRole('heading', { name: 'Introduction', level: 1 })
    expect(spokenStatus('Introduction')).toBe('Completed, current lesson')
    expect(hasCheck('Introduction')).toBe(true)

    // 5. Reload: a fresh page reads the stored state back from the backend.
    cleanup()
    const reloaded = await open(server, VIDEO)
    await screen.findByRole('heading', { name: 'Introduction', level: 1 })
    expect(spokenStatus('Introduction')).toBe('Completed, current lesson')
    expect(hasCheck('Introduction')).toBe(true)
    expect(reloaded.harness.http.callsTo(progressPath)).toHaveLength(0)
  })

  it('opening a video and leaving it never marks it completed', async () => {
    const server = createServer()
    await open(server, VIDEO)
    await screen.findByRole('heading', { name: 'Introduction', level: 1 })

    await userEvent.click(row('Python cheat sheet'))
    await screen.findByRole('heading', { name: 'Python cheat sheet', level: 1 })

    expect(spokenStatus('Introduction')).toBe('Not started')
    cleanup()
    await open(server, learningLessonIds.document)
    await screen.findByRole('heading', { name: 'Python cheat sheet', level: 1 })
    expect(spokenStatus('Introduction')).toBe('Not started')
  })

  it.each([
    ['390', viewports.mobile],
    ['768', viewports.tablet],
  ])('shows the same state in the outline at %s px', async (_width, width) => {
    await renderRoute({
      path: lessonPath(VIDEO),
      as: 'member',
      width,
      beforeMount: (harness) => {
        createServer().install(harness)
        harness.http.on(`/courses/${COURSE_ID}/content`, { json: learningContent })
      },
    })
    await screen.findByRole('heading', { name: 'Introduction', level: 1 })

    expect(spokenStatus('Introduction')).toBe('Completed, current lesson')
    expect(hasCheck('Introduction')).toBe(true)
  })
})
