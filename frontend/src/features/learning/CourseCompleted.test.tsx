import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { CourseContent } from '../../api'
import type { AuthHarness } from '../../test/authHarness'
import {
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

import { courseCompletionLessonId } from './model'

/**
 * FE-LEARN-COMPLETE-SCREEN-01 - the course-completed screen (Course-Completed,
 * Completion-Mobile).
 *
 * "Complete" is the backend's verdict: `CourseContent.completed` on load, and
 * `CourseProgressResponse.completed` once a video's completion is confirmed.
 * The screen takes the place of the lesson that finished the course - the
 * video completed last, by the `completed_at` the server stored - so it is
 * found again after navigating away or reloading. The server below keeps the
 * state a progress write produces, so a fresh mount reads what was stored.
 *
 * The fixture course has one VIDEO lesson ("Introduction") among its lessons;
 * `totalVideos` says how many videos the server counts for the course.
 */

const COURSE_ID = learningContent.course_id
const VIDEO = learningLessonIds.introduction
const DURATION = 384
const lessonPath = (lessonId: string) => `/courses/${COURSE_ID}/lessons/${lessonId}`

function createServer({ totalVideos = 1, completed = false } = {}) {
  const tree = (done: boolean): CourseContent =>
    ({
      ...learningContent,
      total_video_lessons: totalVideos,
      completed_video_lessons: done ? 1 : 0,
      progress_percent: done ? Math.round(10000 / totalVideos) / 100 : 0,
      completed: done && totalVideos === 1,
      modules: learningContent.modules.map((module) => ({
        ...module,
        lessons: module.lessons.map((lesson) =>
          lesson.id === VIDEO
            ? {
                ...lesson,
                watched_seconds: done ? DURATION : 0,
                completed: done,
                completed_at: done ? '2026-09-21T10:00:00Z' : null,
              }
            : lesson,
        ),
      })),
    }) as CourseContent

  let content = tree(completed)

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
    harness.http.on(`/lessons/${VIDEO}/progress`, (call) => {
      const sent = Math.min(DURATION, Number(JSON.parse(call.body ?? '{}').watched_seconds ?? 0))
      const done = sent >= DURATION - 2
      content = tree(done)
      return { json: progressResponse({ watchedSeconds: sent, completed: done }) }
    })
    harness.http.on(`/courses/${COURSE_ID}/progress`, () => ({
      json: {
        course_id: COURSE_ID,
        total_video_lessons: content.total_video_lessons,
        completed_video_lessons: content.completed_video_lessons,
        progress_percent: content.progress_percent,
        completed: content.completed,
      },
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

const completedHeading = () => screen.queryByRole('heading', { name: 'Course completed', level: 1 })
const outline = () => screen.getByRole('navigation', { name: 'Course content' })

async function playToTheEnd(container: HTMLElement) {
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

describe('course completed - not yet', () => {
  it('keeps the ordinary learning page while the course is not complete', async () => {
    await open(createServer(), VIDEO)

    expect(await screen.findByRole('heading', { name: 'Introduction', level: 1 })).toBeInTheDocument()
    expect(completedHeading()).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Lesson navigation' })).toBeInTheDocument()
  })

  it('does not complete the course for opening its last video, or starting it', async () => {
    const { container } = await open(createServer(), VIDEO)
    await screen.findByRole('heading', { name: 'Introduction', level: 1 })

    // The element appears once its resource request answers, after the heading.
    const video = await waitFor(() => {
      const element = container.querySelector('video')
      expect(element).not.toBeNull()
      return element!
    })
    fireEvent.loadedMetadata(video)
    fireEvent.play(video)

    expect(completedHeading()).toBeNull()
  })

  it('does not show the screen when a finished video leaves others to watch', async () => {
    const { container, harness } = await open(createServer({ totalVideos: 2 }), VIDEO)
    await screen.findByRole('heading', { name: 'Introduction', level: 1 })

    await playToTheEnd(container)
    await waitFor(() => expect(harness.http.callsTo(`/courses/${COURSE_ID}/progress`)).toHaveLength(1))

    expect(completedHeading()).toBeNull()
    expect(screen.getByRole('heading', { name: 'Introduction', level: 1 })).toBeInTheDocument()
  })
})

describe('course completed - the screen', () => {
  it('replaces the lesson once the server confirms the last video, and announces it', async () => {
    const { container } = await open(createServer(), VIDEO)
    await screen.findByRole('heading', { name: 'Introduction', level: 1 })

    await playToTheEnd(container)

    const heading = await screen.findByRole('heading', { name: 'Course completed', level: 1 })
    // Focus follows the news, from a player that is no longer there.
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByText('You have completed all video lessons in this course.')).toBeInTheDocument()
    expect(screen.getByText('1 of 1 videos completed')).toBeInTheDocument()
    expect(
      screen.getByText('Text, document and link lessons stay available in the course content list.'),
    ).toBeInTheDocument()
    // One level-1 heading, and the lesson's own content is gone.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(container.querySelector('video')).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Lesson navigation' })).toBeNull()
    // The course content list stays, with every lesson still open.
    expect(within(outline()).getByRole('link', { name: /Practice exercises/ })).toBeInTheDocument()
  })

  it('shows the board’s course line, figures and actions on a laptop', async () => {
    await open(createServer({ completed: true }), VIDEO, viewports.wide)
    await screen.findByRole('heading', { name: 'Course completed', level: 1 })

    const section = screen.getByRole('region', { name: 'Course completed' })
    expect(within(section).getByText(learningContent.title)).toBeInTheDocument()
    // The 100% figure is decoration beside the words that say it.
    expect(within(section).getByText('100%')).toHaveAttribute('aria-hidden', 'true')
    expect(section.querySelector('img')).toHaveAttribute('alt', '')
    const actions = [...section.querySelectorAll('a, button')].map((control) => control.textContent)
    expect(actions).toEqual(['Review course', 'Back to my courses'])
  })

  it('follows Completion-Mobile on a phone: progress bar, "Back to my courses" first', async () => {
    await open(createServer({ completed: true }), VIDEO, viewports.mobile)
    await screen.findByRole('heading', { name: 'Course completed', level: 1 })

    const section = screen.getByRole('region', { name: 'Course completed' })
    expect(within(section).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    expect(within(section).queryByText(learningContent.title)).toBeNull()
    const actions = [...section.querySelectorAll('a, button')].map((control) => control.textContent)
    expect(actions).toEqual(['Back to my courses', 'Review course'])
  })

  it('lays out at 768 px with the laptop order', async () => {
    await open(createServer({ completed: true }), VIDEO, viewports.tablet)
    await screen.findByRole('heading', { name: 'Course completed', level: 1 })

    const section = screen.getByRole('region', { name: 'Course completed' })
    const actions = [...section.querySelectorAll('a, button')].map((control) => control.textContent)
    expect(actions).toEqual(['Review course', 'Back to my courses'])
  })
})

describe('course completed - persistence', () => {
  it('is found again after a reload, without moving focus', async () => {
    const server = createServer()
    const { container } = await open(server, VIDEO)
    await screen.findByRole('heading', { name: 'Introduction', level: 1 })
    await playToTheEnd(container)
    await screen.findByRole('heading', { name: 'Course completed', level: 1 })

    cleanup()
    const reloaded = await open(server, VIDEO)

    const heading = await screen.findByRole('heading', { name: 'Course completed', level: 1 })
    expect(heading).not.toHaveFocus()
    expect(reloaded.harness.http.callsTo(`/lessons/${VIDEO}/progress`)).toHaveLength(0)
  })

  it('is found again after going to another lesson and back', async () => {
    await open(createServer({ completed: true }), VIDEO)
    await screen.findByRole('heading', { name: 'Course completed', level: 1 })

    await userEvent.click(within(outline()).getByRole('link', { name: /Python cheat sheet/ }))
    expect(await screen.findByRole('heading', { name: 'Python cheat sheet', level: 1 })).toBeInTheDocument()
    expect(completedHeading()).toBeNull()

    await userEvent.click(within(outline()).getByRole('link', { name: /Introduction/ }))
    expect(await screen.findByRole('heading', { name: 'Course completed', level: 1 })).toBeInTheDocument()
  })

  it('leaves every other lesson of a completed course an ordinary lesson', async () => {
    await open(createServer({ completed: true }), learningLessonIds.text)

    expect(await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })).toBeInTheDocument()
    expect(completedHeading()).toBeNull()
  })
})

describe('course completed - actions', () => {
  it('"Back to my courses" leads to the member dashboard', async () => {
    const { router } = await open(createServer({ completed: true }), VIDEO)
    await screen.findByRole('heading', { name: 'Course completed', level: 1 })

    const back = screen.getByRole('link', { name: 'Back to my courses' })
    expect(back).toHaveAttribute('href', '/dashboard')
    await userEvent.click(back)

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
  })

  it('"Review course" shows the lesson in place, from the keyboard too', async () => {
    const { router } = await open(createServer({ completed: true }), VIDEO)
    await screen.findByRole('heading', { name: 'Course completed', level: 1 })

    screen.getByRole('button', { name: 'Review course' }).focus()
    await userEvent.keyboard('{Enter}')

    expect(await screen.findByRole('heading', { name: 'Introduction', level: 1 })).toBeInTheDocument()
    expect(completedHeading()).toBeNull()
    expect(router.state.location.pathname).toBe(lessonPath(VIDEO))
    // Reviewing marks nothing: the lesson is still completed, as it was (its
    // header's badge; the outline's legend says "Completed" as well).
    const header = screen.getByRole('heading', { name: 'Introduction', level: 1 }).closest('header')!
    expect(within(header).getByText('Completed')).toBeInTheDocument()
  })
})

describe('course completed - which lesson holds the screen', () => {
  const lesson = (id: string, position: number, completedAt: string | null) => ({
    id,
    title: id,
    description: null,
    content_type: 'VIDEO' as const,
    duration_seconds: 60,
    position,
    is_preview: false,
    has_resource: true,
    watched_seconds: completedAt ? 60 : 0,
    completed: completedAt !== null,
    completed_at: completedAt,
  })
  const course = (completed: boolean, lessons: ReturnType<typeof lesson>[]) =>
    ({
      ...learningContent,
      completed,
      modules: [{ id: 'm', title: 'M', description: null, position: 1, lessons }],
    }) as CourseContent

  it('is the video completed last, by the server’s timestamp', () => {
    const content = course(true, [
      lesson('a', 1, '2026-09-21T10:00:00Z'),
      lesson('b', 2, '2026-09-20T10:00:00Z'),
    ])
    expect(courseCompletionLessonId(content)).toBe('a')
  })

  it('is none at all while the backend says the course is not complete', () => {
    const content = course(false, [lesson('a', 1, '2026-09-21T10:00:00Z')])
    expect(courseCompletionLessonId(content)).toBeNull()
  })

  it('breaks a tie with the course order', () => {
    const at = '2026-09-21T10:00:00Z'
    expect(courseCompletionLessonId(course(true, [lesson('a', 1, at), lesson('b', 2, at)]))).toBe('b')
  })
})
