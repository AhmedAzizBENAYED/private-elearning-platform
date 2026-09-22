import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApiClientProvider } from '../../api'
import { useLearningEventOnOpen } from '../courses'
import { createAuthHarness, type AuthHarness } from '../../test/authHarness'
import {
  catalogEnrolled,
  catalogLessonsByModule,
  catalogModules,
  courseContent,
  documentResource,
  learningContent,
  learningLessonIds,
  linkLessonDetail,
  page,
  pdfBytes,
  textLessonDetail,
  videoResource,
} from '../../test/courseFixtures'
import { renderRoute } from '../../test/renderRoute'
import { setViewport, viewports } from '../../test/viewport'

/**
 * FE-LEARNING-TRACKING-01 - the learning pages record what the member opens,
 * through `POST /me/learning-events` (BE-LEARNING-TRACKING-01):
 *
 *   course_opened   the member's course page, once enrolled, and the learning
 *                   page, once per visit
 *   lesson_opened   each lesson the learning page's URL reaches
 *   module_opened   expanding a folded module (modules fold below 1024px)
 *
 * The body is the type and the ids only: the member and the time are the
 * server's, and lesson_completed is the server's to write.
 */

const COURSE = learningContent.course_id
const MODULE_1 = 'mod-0000-0000-4000-8000-000000000001'
const MODULE_2 = 'mod-0000-0000-4000-8000-000000000002'
const EVENTS = '/me/learning-events'
const lessonPath = (lessonId: string) => `/courses/${COURSE}/lessons/${lessonId}`

type Body = Record<string, string>

function stubLearning(harness: AuthHarness) {
  harness.http.on(`/courses/${COURSE}/content`, { json: learningContent })
  harness.http.on(`/lessons/${learningLessonIds.text}`, { json: textLessonDetail })
  harness.http.on(`/lessons/${learningLessonIds.link}`, { json: linkLessonDetail })
  harness.http.on(`/lessons/${learningLessonIds.introduction}/resource`, { json: videoResource })
  harness.http.on(`/lessons/${learningLessonIds.document}/resource`, { json: documentResource })
  harness.http.on(`/lessons/${learningLessonIds.document}/resource/content`, {
    bytes: pdfBytes,
    contentType: 'application/pdf',
  })
}

const events = (harness: AuthHarness): Body[] =>
  harness.http.callsTo(EVENTS).map((call) => JSON.parse(call.body ?? '{}') as Body)

const courseOpened = (courseId = COURSE): Body => ({ type: 'course_opened', course_id: courseId })
const lessonOpened = (moduleId: string, lessonId: string): Body => ({
  type: 'lesson_opened',
  course_id: COURSE,
  module_id: moduleId,
  lesson_id: lessonId,
})

async function openLesson(
  lessonId: string,
  options: { width?: number; strict?: boolean; stub?: (harness: AuthHarness) => void } = {},
) {
  const result = await renderRoute({
    path: lessonPath(lessonId),
    as: 'member',
    width: options.width ?? viewports.wide,
    strict: options.strict ?? false,
    beforeMount: options.stub ?? stubLearning,
  })
  await screen.findByRole('heading', { level: 1, name: titleOf(lessonId) })
  return result
}

function titleOf(lessonId: string): string {
  for (const module of learningContent.modules) {
    for (const lesson of module.lessons) if (lesson.id === lessonId) return lesson.title
  }
  throw new Error(lessonId)
}

const outline = () => screen.getByRole('navigation', { name: 'Course content' })

// ------------------------------------------------------------ the request

describe('tracking - the request', () => {
  it('posts the type and the ids only, to /me/learning-events, through the authenticated client', async () => {
    const { harness } = await openLesson(learningLessonIds.introduction)

    await waitFor(() => expect(events(harness)).toHaveLength(2))
    for (const call of harness.http.callsTo(EVENTS)) {
      expect(call.method).toBe('POST')
      expect(new URL(call.url).pathname).toBe('/api/v1/me/learning-events')
      expect(new Headers(call.headers).get('Content-Type')).toBe('application/json')
      // The client's own session, not a header built here.
      expect(new Headers(call.headers).get('Authorization')).toMatch(/^Bearer /)
    }
    expect(events(harness)).toEqual([courseOpened(), lessonOpened(MODULE_1, learningLessonIds.introduction)])
    for (const body of events(harness)) {
      expect(body).not.toHaveProperty('user_id')
      expect(body).not.toHaveProperty('occurred_at')
    }
  })
})

describe('tracking - one opening, one event, however often the effect runs', () => {
  /**
   * The page sends nothing while it loads, so the mount that Strict Mode
   * doubles is a no-op there; what has to hold is the rule itself - the same
   * opening is recorded once, even when the effect runs again because
   * something around it changed (a new client after a refresh, a parent that
   * re-rendered) - and once per thing when the opening changes.
   */
  function Probe({ lessonId }: { lessonId: string | null }) {
    useLearningEventOnOpen(
      lessonId === null
        ? { type: 'course_opened', courseId: COURSE }
        : { type: 'lesson_opened', courseId: COURSE, moduleId: MODULE_1, lessonId },
    )
    return null
  }

  it('records it once, and records the next opening', async () => {
    const harness = createAuthHarness()
    harness.http.on(EVENTS, { status: 201, json: {} })
    const tree = (client: typeof harness.apiClient, lessonId: string | null) => (
      <StrictMode>
        <ApiClientProvider client={client}>
          <Probe lessonId={lessonId} />
        </ApiClientProvider>
      </StrictMode>
    )

    const view = render(tree(harness.apiClient, null))
    await waitFor(() => expect(events(harness)).toEqual([courseOpened()]))

    // Re-rendered, then re-rendered with another client - the effect runs
    // again both times, and the course was already opened.
    view.rerender(tree(harness.apiClient, null))
    view.rerender(tree(createAuthHarness().apiClient, null))
    await act(async () => undefined)
    expect(events(harness)).toEqual([courseOpened()])

    // A different opening is a different event.
    view.rerender(tree(harness.apiClient, learningLessonIds.introduction))
    await waitFor(() => expect(events(harness)).toHaveLength(2))
    expect(events(harness)[1]).toEqual(lessonOpened(MODULE_1, learningLessonIds.introduction))
  })
})

// --------------------------------------------------------- the lesson page

describe('tracking - the learning page', () => {
  it('opens the course and the lesson a pasted URL names, once each', async () => {
    const { harness } = await openLesson(learningLessonIds.text)

    await waitFor(() => expect(events(harness)).toHaveLength(2))
    expect(events(harness)).toEqual([courseOpened(), lessonOpened(MODULE_2, learningLessonIds.text)])
  })

  it('sends nothing twice under React Strict Mode', async () => {
    const { harness } = await openLesson(learningLessonIds.introduction, { strict: true })

    await waitFor(() => expect(events(harness)).toHaveLength(2))
    await userEvent.click(within(outline()).getByRole('link', { name: /Practice exercises/ }))
    await screen.findByRole('heading', { level: 1, name: 'Practice exercises' })

    await waitFor(() => expect(events(harness)).toHaveLength(3))
    expect(events(harness)).toEqual([
      courseOpened(),
      lessonOpened(MODULE_1, learningLessonIds.introduction),
      lessonOpened(MODULE_2, learningLessonIds.text),
    ])
  })

  it('sends nothing more for renders that open nothing', async () => {
    const { harness } = await openLesson(learningLessonIds.introduction)
    await waitFor(() => expect(events(harness)).toHaveLength(2))

    // Layout changes re-render the page (header, outline folding) ...
    act(() => setViewport(viewports.mobile))
    act(() => setViewport(viewports.tablet))
    act(() => setViewport(viewports.wide))
    // ... and so does interacting with the video without leaving the lesson.
    const video = document.querySelector('video')
    if (video) act(() => video.dispatchEvent(new Event('play')))
    await screen.findByRole('heading', { level: 1, name: 'Introduction' })

    expect(events(harness)).toHaveLength(2)
  })

  it('opens each lesson reached from the outline, and not the course again', async () => {
    const { harness } = await openLesson(learningLessonIds.introduction)
    await waitFor(() => expect(events(harness)).toHaveLength(2))

    await userEvent.click(within(outline()).getByRole('link', { name: /Python cheat sheet/ }))
    await screen.findByRole('heading', { level: 1, name: 'Python cheat sheet' })
    await userEvent.click(within(outline()).getByRole('link', { name: /Further reading/ }))
    await screen.findByRole('heading', { level: 1, name: 'Further reading' })

    await waitFor(() => expect(events(harness)).toHaveLength(4))
    expect(events(harness).slice(2)).toEqual([
      lessonOpened(MODULE_1, learningLessonIds.document),
      lessonOpened(MODULE_2, learningLessonIds.link),
    ])
    // Wide: every module is always shown, so nothing is "expanded".
    expect(events(harness).some((body) => body.type === 'module_opened')).toBe(false)
  })

  it('opens the lesson Previous and Next lead to, and the one back and forward return to', async () => {
    const { harness, router } = await openLesson(learningLessonIds.introduction)
    await waitFor(() => expect(events(harness)).toHaveLength(2))
    const nav = () => screen.getByRole('navigation', { name: 'Lesson navigation' })

    await userEvent.click(within(nav()).getByRole('link', { name: /^Next lesson: Python cheat sheet/ }))
    await screen.findByRole('heading', { level: 1, name: 'Python cheat sheet' })
    await userEvent.click(within(nav()).getByRole('link', { name: /^Next lesson: Practice exercises/ }))
    await screen.findByRole('heading', { level: 1, name: 'Practice exercises' })
    await userEvent.click(within(nav()).getByRole('link', { name: /^Previous lesson: Python cheat sheet/ }))
    await screen.findByRole('heading', { level: 1, name: 'Python cheat sheet' })
    await act(() => router.navigate(-1))
    await screen.findByRole('heading', { level: 1, name: 'Practice exercises' })
    await act(() => router.navigate(1))
    await screen.findByRole('heading', { level: 1, name: 'Python cheat sheet' })

    await waitFor(() => expect(events(harness)).toHaveLength(7))
    expect(events(harness).slice(2)).toEqual([
      lessonOpened(MODULE_1, learningLessonIds.document),
      lessonOpened(MODULE_2, learningLessonIds.text),
      lessonOpened(MODULE_1, learningLessonIds.document),
      lessonOpened(MODULE_2, learningLessonIds.text),
      lessonOpened(MODULE_1, learningLessonIds.document),
    ])
    expect(events(harness).filter((body) => body.type === 'course_opened')).toHaveLength(1)
  })

  it('opens the course again after leaving it and coming back', async () => {
    const { harness, router } = await openLesson(learningLessonIds.introduction)
    await waitFor(() => expect(events(harness)).toHaveLength(2))

    await act(() => router.navigate('/dashboard'))
    await act(() => router.navigate(lessonPath(learningLessonIds.introduction)))
    await screen.findByRole('heading', { level: 1, name: 'Introduction' })

    await waitFor(() => expect(events(harness)).toHaveLength(4))
    expect(events(harness).slice(2)).toEqual([courseOpened(), lessonOpened(MODULE_1, learningLessonIds.introduction)])
  })

  it('treats a reload as one new visit: one course, one lesson', async () => {
    const first = await openLesson(learningLessonIds.text)
    await waitFor(() => expect(events(first.harness)).toHaveLength(2))
    first.unmount()

    const reloaded = await openLesson(learningLessonIds.text)
    await waitFor(() => expect(events(reloaded.harness)).toHaveLength(2))
    expect(events(reloaded.harness)).toEqual([courseOpened(), lessonOpened(MODULE_2, learningLessonIds.text)])
  })

  it('records nothing for a course the member cannot read, nor while it fails', async () => {
    for (const answer of [
      { status: 404, json: { detail: 'Enrollment not found' } },
      { status: 500, json: { detail: 'Internal server error' } },
    ]) {
      const { harness, unmount } = await renderRoute({
        path: lessonPath(learningLessonIds.introduction),
        as: 'member',
        beforeMount: (h) => h.http.on(`/courses/${COURSE}/content`, answer),
      })
      await screen.findByRole('heading', { level: 1 })
      expect(events(harness)).toEqual([])
      unmount()
    }
  })

  it('opens the course but no lesson when the URL names a lesson the course does not hold', async () => {
    const { harness } = await renderRoute({
      path: lessonPath('les-0000-0000-4000-8000-00000000dead'),
      as: 'member',
      beforeMount: stubLearning,
    })
    await screen.findByRole('heading', { name: 'This lesson isn’t available' })

    await waitFor(() => expect(events(harness)).toHaveLength(1))
    expect(events(harness)).toEqual([courseOpened()])
  })
})

// ----------------------------------------------------------------- modules

describe('tracking - opening a module', () => {
  it.each([
    ['390', viewports.mobile],
    ['768', viewports.tablet],
  ])('records expanding a folded module at %spx, and not folding it', async (_name, width) => {
    const { harness } = await openLesson(learningLessonIds.introduction, { width })
    await waitFor(() => expect(events(harness)).toHaveLength(2))
    const toggle = (title: string) => within(outline()).getByRole('button', { name: title })
    // The current lesson's module is shown open on arrival: that is not an opening.
    expect(toggle('Getting started')).toHaveAttribute('aria-expanded', 'true')
    expect(toggle('Functions and structure')).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(toggle('Functions and structure'))
    await userEvent.click(toggle('Functions and structure'))
    await userEvent.click(toggle('Getting started'))
    await userEvent.click(toggle('Getting started'))

    await waitFor(() => expect(events(harness)).toHaveLength(4))
    expect(events(harness).slice(2)).toEqual([
      { type: 'module_opened', course_id: COURSE, module_id: MODULE_2 },
      { type: 'module_opened', course_id: COURSE, module_id: MODULE_1 },
    ])
  })

  it('records one module opening per click under Strict Mode', async () => {
    const { harness } = await openLesson(learningLessonIds.introduction, { width: viewports.mobile, strict: true })
    await waitFor(() => expect(events(harness)).toHaveLength(2))

    await userEvent.click(within(outline()).getByRole('button', { name: 'Functions and structure' }))

    await waitFor(() => expect(events(harness)).toHaveLength(3))
    expect(events(harness)[2]).toEqual({ type: 'module_opened', course_id: COURSE, module_id: MODULE_2 })
  })

  it('offers no module to expand at 1024px and wider, so records none', async () => {
    const { harness } = await openLesson(learningLessonIds.introduction, { width: viewports.laptop })
    await waitFor(() => expect(events(harness)).toHaveLength(2))

    expect(within(outline()).queryAllByRole('button')).toHaveLength(0)
    expect(events(harness).some((body) => body.type === 'module_opened')).toBe(false)
  })
})

// ------------------------------------------------------------ the course page

const DETAILS = `/courses/${catalogEnrolled.id}`

function stubDetails(harness: AuthHarness, enrolled: boolean) {
  harness.http.on(`/courses/${catalogEnrolled.id}`, { json: catalogEnrolled })
  if (enrolled) {
    harness.http.on(`/courses/${catalogEnrolled.id}/content`, { json: courseContent })
    return
  }
  harness.http.on(`/courses/${catalogEnrolled.id}/content`, { status: 404, json: { detail: 'Enrollment not found' } })
  harness.http.on(`/courses/${catalogEnrolled.id}/modules`, { json: page(catalogModules) })
  for (const module of catalogModules) {
    harness.http.on(`/modules/${module.id}/lessons`, { json: page(catalogLessonsByModule[module.id] ?? []) })
  }
}

describe('tracking - the course page', () => {
  it('opens the course for an enrolled member, once, even under Strict Mode', async () => {
    const { harness } = await renderRoute({
      path: DETAILS, as: 'member', strict: true, beforeMount: (h) => stubDetails(h, true),
    })
    await screen.findByRole('heading', { level: 1, name: catalogEnrolled.title })

    await waitFor(() => expect(events(harness)).toHaveLength(1))
    expect(events(harness)).toEqual([courseOpened(catalogEnrolled.id)])
  })

  it('records nothing for the catalogue preview of a course the member has not joined', async () => {
    const { harness } = await renderRoute({
      path: DETAILS, as: 'member', width: viewports.mobile, beforeMount: (h) => stubDetails(h, false),
    })
    await screen.findByRole('heading', { level: 1, name: catalogEnrolled.title })
    await screen.findByText(/Lessons open once you are enrolled/)
    // Expanding a module of the preview is browsing, not learning.
    const content = screen.getByRole('region', { name: 'Course content' })
    const folded = within(content).getAllByRole('button', { expanded: false })
    expect(folded.length).toBeGreaterThan(0)
    for (const button of folded) await userEvent.click(button)

    expect(events(harness)).toEqual([])
  })

  it('records expanding a module of an enrolled course on a phone', async () => {
    const { harness } = await renderRoute({
      path: DETAILS, as: 'member', width: viewports.mobile, beforeMount: (h) => stubDetails(h, true),
    })
    await screen.findByRole('heading', { level: 1, name: catalogEnrolled.title })
    await waitFor(() => expect(events(harness)).toHaveLength(1))
    const content = screen.getByRole('region', { name: 'Course content' })
    const folded = within(content).getAllByRole('button', { expanded: false })[0]!

    await userEvent.click(folded)
    await userEvent.click(folded)

    await waitFor(() => expect(events(harness)).toHaveLength(2))
    expect(events(harness)[1]!.type).toBe('module_opened')
    expect(courseContent.modules.map((module) => module.id)).toContain(events(harness)[1]!.module_id)
    expect(events(harness)[1]!.course_id).toBe(catalogEnrolled.id)
  })

  it('opens the course once when enrolling leads straight to the first lesson', async () => {
    const { harness, router } = await renderRoute({
      path: DETAILS,
      as: 'member',
      beforeMount: (h) => {
        stubDetails(h, false)
        h.http.once(`/courses/${catalogEnrolled.id}/content`, { status: 404, json: { detail: 'Enrollment not found' } })
        h.http.on(`/courses/${catalogEnrolled.id}/content`, { json: courseContent })
        h.http.on('/enroll', {
          json: { id: 'e1', course_id: catalogEnrolled.id, enrolled_at: '2026-09-20T10:00:00Z', completed_at: null },
        })
      },
    })
    await userEvent.click(await screen.findByRole('button', { name: /enroll in this course/i }))
    const first = courseContent.modules[0]!.lessons[0]!
    await waitFor(() => expect(router.state.location.pathname).toBe(`${DETAILS}/lessons/${first.id}`))

    await waitFor(() => expect(events(harness)).toHaveLength(2))
    expect(events(harness)).toEqual([
      courseOpened(catalogEnrolled.id),
      { type: 'lesson_opened', course_id: catalogEnrolled.id, module_id: courseContent.modules[0]!.id, lesson_id: first.id },
    ])
  })

  it('opens the course on the course page when enrolling there leads nowhere else', async () => {
    const empty = { ...courseContent, modules: [], total_video_lessons: 0, completed_video_lessons: 0 }
    const { harness, router } = await renderRoute({
      path: DETAILS,
      as: 'member',
      beforeMount: (h) => {
        stubDetails(h, false)
        h.http.once(`/courses/${catalogEnrolled.id}/content`, { status: 404, json: { detail: 'Enrollment not found' } })
        h.http.on(`/courses/${catalogEnrolled.id}/content`, { json: empty })
        h.http.on('/enroll', {
          json: { id: 'e1', course_id: catalogEnrolled.id, enrolled_at: '2026-09-20T10:00:00Z', completed_at: null },
        })
      },
    })
    await userEvent.click(await screen.findByRole('button', { name: /enroll in this course/i }))

    await waitFor(() => expect(events(harness)).toHaveLength(1))
    expect(events(harness)).toEqual([courseOpened(catalogEnrolled.id)])
    expect(router.state.location.pathname).toBe(DETAILS)
  })

  it('records nothing for the catalogue list and its cards', async () => {
    const { harness } = await renderRoute({
      path: '/courses',
      as: 'member',
      beforeMount: (h) => h.http.on('/courses', {
        json: { items: [{ ...catalogEnrolled, module_count: 2, total_video_lessons: 3 }], total: 1, page: 1,
                page_size: 20, enrollment_counts: { all: 1, not_enrolled: 1, in_progress: 0, completed: 0 } },
      }),
    })
    await screen.findByText(catalogEnrolled.title)

    expect(events(harness)).toEqual([])
  })
})

// ----------------------------------------------------------------- failures

describe('tracking - a failure never stands in the way', () => {
  it.each([
    ['a 500', (h: AuthHarness) => h.http.on(EVENTS, { status: 500, json: { detail: 'Internal server error' } })],
    ['a dropped connection', (h: AuthHarness) => {
      for (let i = 0; i < 10; i++) h.http.failNetwork(EVENTS)
    }],
    ['a 401 the refresh cannot fix', (h: AuthHarness) => h.http.on(EVENTS, { status: 401, json: { detail: 'x' } })],
  ])('keeps the course, the lessons and the navigation working after %s', async (_name, fail) => {
    // The failure is swallowed where it happens: nothing escapes as an
    // unhandled rejection either, which would surface as a console error.
    const escaped = vi.fn()
    // Node's own hook, reached through globalThis: the app's tsconfig has no
    // node types, and nothing in `src` may depend on them.
    const node = globalThis as unknown as {
      process: { on: (event: string, listener: () => void) => void; off: (event: string, listener: () => void) => void }
    }
    node.process.on('unhandledRejection', escaped)
    const { harness } = await openLesson(learningLessonIds.introduction, {
      stub: (h) => {
        stubLearning(h)
        fail(h)
      },
    })
    await waitFor(() => expect(harness.http.callsTo(EVENTS).length).toBeGreaterThanOrEqual(2))

    // The video lesson is shown, with its player source resolved.
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull())
    await userEvent.click(within(outline()).getByRole('link', { name: /Practice exercises/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Practice exercises' })).toBeInTheDocument()
    expect(await screen.findByText(textLessonDetail.content!.split('\n')[0]!.slice(0, 20), { exact: false })).toBeInTheDocument()
    // Nothing intrusive: no alert, no error page, no dialog.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(/something went wrong|couldn’t|could not/i)).toBeNull()
    await act(async () => undefined)
    node.process.off('unhandledRejection', escaped)
    expect(escaped).not.toHaveBeenCalled()
  })
})

// --------------------------------------------------------------- completion

describe('tracking - completion stays the progress write', () => {
  it('never sends lesson_completed, nor anything but the three opening types', async () => {
    const { harness } = await openLesson(learningLessonIds.introduction)
    await userEvent.click(within(outline()).getByRole('link', { name: /Practice exercises/ }))
    await screen.findByRole('heading', { level: 1, name: 'Practice exercises' })

    await waitFor(() => expect(events(harness)).toHaveLength(3))
    expect(new Set(events(harness).map((body) => body.type))).toEqual(new Set(['course_opened', 'lesson_opened']))
    expect(harness.http.calls.some((call) => (call.body ?? '').includes('lesson_completed'))).toBe(false)
  })
})

// --------------------------------------------------------------- responsive

describe('tracking - the same at every width', () => {
  it.each([
    ['390', viewports.mobile],
    ['768', viewports.tablet],
    ['1024', viewports.laptop],
    ['1440', viewports.wide],
  ])('at %spx: one course, then one event per lesson reached', async (_name, width) => {
    const { harness } = await openLesson(learningLessonIds.introduction, { width })

    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Lesson navigation' })).getByRole('link', {
        name: /^Next lesson: Python cheat sheet/,
      }),
    )
    await screen.findByRole('heading', { level: 1, name: 'Python cheat sheet' })

    await waitFor(() => expect(events(harness)).toHaveLength(3))
    expect(events(harness)).toEqual([
      courseOpened(),
      lessonOpened(MODULE_1, learningLessonIds.introduction),
      lessonOpened(MODULE_1, learningLessonIds.document),
    ])
  })
})
