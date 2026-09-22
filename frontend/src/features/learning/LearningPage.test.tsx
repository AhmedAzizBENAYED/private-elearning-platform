import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { AuthHarness } from '../../test/authHarness'
import {
  documentResource,
  learningContent,
  learningLessonIds,
  linkLessonDetail,
  pdfBytes,
  textLessonDetail,
  videoResource,
} from '../../test/courseFixtures'
import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

const COURSE_ID = learningContent.course_id
const lessonPath = (lessonId: string) => `/courses/${COURSE_ID}/lessons/${lessonId}`

/** The one course tree the page reads, plus the two lesson details it may ask for. */
function stubCourse(harness: AuthHarness) {
  harness.http.on(`/courses/${COURSE_ID}/content`, { json: learningContent })
  harness.http.on(`/lessons/${learningLessonIds.text}`, { json: textLessonDetail })
  harness.http.on(`/lessons/${learningLessonIds.link}`, { json: linkLessonDetail })
  // FE-08: a VIDEO lesson resolves its media URL through the resource endpoint.
  harness.http.on(`/lessons/${learningLessonIds.introduction}/resource`, { json: videoResource })
  // FE-09: a DOCUMENT lesson reads its metadata and then its bytes.
  harness.http.on(`/lessons/${learningLessonIds.document}/resource`, { json: documentResource })
  harness.http.on(`/lessons/${learningLessonIds.document}/resource/content`, {
    bytes: pdfBytes,
    contentType: 'application/pdf',
  })
}

const openLesson = (
  lessonId: string,
  beforeMount: (harness: AuthHarness) => void = stubCourse,
  width?: number,
) =>
  renderRoute({
    path: lessonPath(lessonId),
    as: 'member',
    beforeMount,
    ...(width ? { width } : {}),
  })

describe('learning - routing and selection', () => {
  it('renders the lesson the URL names, not the first one', async () => {
    await openLesson(learningLessonIds.text)

    expect(
      await screen.findByRole('heading', { name: 'Practice exercises', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Introduction', level: 1 })).toBeNull()
  })

  it('places the lesson inside its module, with the backend positions', async () => {
    await openLesson(learningLessonIds.text)

    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })
    // Module position 2, and lesson position 1 of the 2 lessons in it - the
    // board's line exactly (G34); the module's title is in the breadcrumb.
    expect(screen.getByText('Module 2 · Lesson 1 of 2')).toBeInTheDocument()
    expect(screen.getByText('Module 2 · Functions and structure')).toBeInTheDocument()
  })

  // FE-QA-FINAL-01 (G34): the note under the description, per kind, and the
  // link card named by its lesson (Learning-Video, Learning-Link).
  it('says under a video lesson that it completes by itself when the video ends', async () => {
    await openLesson(learningLessonIds.introduction)
    const title = await screen.findByRole('heading', { name: 'Introduction', level: 1 })

    const note = screen.getByText('The lesson is marked as complete automatically when the video ends.')
    // In the lesson's header, with its title - not somewhere after the player.
    expect(title.closest('header')).toContainElement(note)
    expect(screen.queryByText(/don’t count toward your course progress/)).toBeNull()
  })

  it('names the link card after its lesson and opens it with the glyph after the label', async () => {
    await openLesson(learningLessonIds.link)
    const title = await screen.findByRole('heading', { level: 1 })

    const card = screen.getByRole('heading', { level: 2, name: title.textContent ?? '' })
    expect(card).toBeInTheDocument()
    const open = screen.getByRole('link', { name: /open link/i })
    expect(open.lastElementChild?.tagName.toLowerCase()).toBe('svg')
    expect(title.closest('header')).toContainElement(
      screen.getByText('Links don’t count toward your course progress.'),
    )
  })

  it('shows the unavailable state for a lesson id this course does not contain', async () => {
    await openLesson('00000000-0000-4000-8000-000000000000')

    expect(
      await screen.findByRole('heading', { name: 'This lesson isn’t available' }),
    ).toBeInTheDocument()
    // Emphatically NOT the first lesson.
    expect(screen.queryByRole('heading', { name: 'Introduction', level: 1 })).toBeNull()
  })

  it('keeps the course outline usable when the lesson is unavailable', async () => {
    await openLesson('00000000-0000-4000-8000-000000000000')

    await screen.findByRole('heading', { name: 'This lesson isn’t available' })
    const outline = screen.getByRole('navigation', { name: 'Course content' })
    expect(within(outline).getByRole('link', { name: /Introduction/ })).toBeInTheDocument()
  })

  it('works as a direct deep link', async () => {
    const { router } = await openLesson(learningLessonIds.link)

    await screen.findByRole('heading', { name: 'Further reading', level: 1 })
    expect(router.state.location.pathname).toBe(lessonPath(learningLessonIds.link))
  })
})

describe('learning - course outline', () => {
  it('orders modules and lessons by the backend position, not by array order', async () => {
    await openLesson(learningLessonIds.introduction)

    const outline = await screen.findByRole('navigation', { name: 'Course content' })
    const headings = within(outline)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)

    // The fixture lists module 2 first; position must win.
    expect(headings).toEqual(['Getting started', 'Functions and structure'])

    const links = within(outline)
      .getAllByRole('link')
      .map((link) => link.textContent)
    expect(links[0]).toContain('Introduction')
    expect(links[1]).toContain('Python cheat sheet')
    expect(links[2]).toContain('Practice exercises')
    expect(links[3]).toContain('Further reading')
  })

  it('marks the selected lesson as the current page', async () => {
    await openLesson(learningLessonIds.document)

    const outline = await screen.findByRole('navigation', { name: 'Course content' })
    const current = within(outline).getByRole('link', { name: /Python cheat sheet/ })
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(within(outline).getAllByRole('link', { current: 'page' })).toHaveLength(1)
  })

  it('renders the completion the backend reported, and claims none otherwise', async () => {
    // Opened on another lesson, so "Introduction" is only "Completed" - not
    // also the current lesson (FE-LEARN-COMPLETED-01 covers both at once).
    await openLesson(learningLessonIds.document)

    const outline = await screen.findByRole('navigation', { name: 'Course content' })
    expect(within(outline).getByRole('link', { name: /Introduction/ })).toHaveTextContent(
      'Completed',
    )
    // A DOCUMENT carries `completed: null`; that is not a completion.
    expect(
      within(outline).getByRole('link', { name: /Python cheat sheet/ }),
    ).not.toHaveTextContent('Completed')
  })

  // FE-QA-FIX-01 (G12) - DS 08: "Only VIDEO lessons have a completion marker…
  // Text / document / link: no completion marker, type icon only".
  it('draws no progress state on text, document or link lessons', async () => {
    // Opened on the LINK lesson, so the other rows show their own state.
    await openLesson(learningLessonIds.link)

    const outline = await screen.findByRole('navigation', { name: 'Course content' })
    // The VIDEO reports its progress...
    expect(within(outline).getByRole('link', { name: /Introduction/ })).toHaveTextContent('Completed')
    // ...a non-video lesson has none to report, only its type - never the
    // "Not started" its `completed: null` used to be drawn as.
    for (const title of ['Python cheat sheet', 'Practice exercises']) {
      const row = within(outline).getByRole('link', { name: new RegExp(title) })
      expect(row).not.toHaveTextContent(/Not started|Completed|Current lesson/)
    }
  })

  it('still announces a selected non-video lesson as the current one', async () => {
    await openLesson(learningLessonIds.text)

    const outline = await screen.findByRole('navigation', { name: 'Course content' })
    const row = within(outline).getByRole('link', { name: /Practice exercises/ })
    expect(row).toHaveAttribute('aria-current', 'page')
    expect(row).toHaveTextContent('Current lesson')
    expect(row).not.toHaveTextContent('Not started')
  })

  it('shows the backend course progress, without recomputing it', async () => {
    await openLesson(learningLessonIds.introduction)

    await screen.findByRole('heading', { name: 'Introduction', level: 1 })
    const bar = screen.getByRole('progressbar', { name: /python fundamentals progress/i })
    expect(bar).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getByText('1 of 2 videos')).toBeInTheDocument()
  })

  it('shows each lesson duration and type from the backend', async () => {
    await openLesson(learningLessonIds.introduction)

    const outline = await screen.findByRole('navigation', { name: 'Course content' })
    expect(within(outline).getByText('06:24')).toBeInTheDocument()
    expect(within(outline).getByText('DOCUMENT')).toBeInTheDocument()
    expect(within(outline).getByText('TEXT')).toBeInTheDocument()
    expect(within(outline).getByText('LINK')).toBeInTheDocument()
  })
})

describe('learning - navigation', () => {
  it('changes the URL and the lesson when a sidebar row is clicked', async () => {
    const { router } = await openLesson(learningLessonIds.introduction)

    const outline = await screen.findByRole('navigation', { name: 'Course content' })
    await userEvent.click(within(outline).getByRole('link', { name: /Practice exercises/ }))

    expect(
      await screen.findByRole('heading', { name: 'Practice exercises', level: 1 }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(lessonPath(learningLessonIds.text))
  })

  it('does not refetch the course tree when moving between lessons', async () => {
    const { harness } = await openLesson(learningLessonIds.introduction)

    const outline = await screen.findByRole('navigation', { name: 'Course content' })
    await userEvent.click(within(outline).getByRole('link', { name: /Practice exercises/ }))
    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })

    expect(harness.http.callsTo(`/courses/${COURSE_ID}/content`)).toHaveLength(1)
  })

  it('walks forward across a module boundary', async () => {
    const { router } = await openLesson(learningLessonIds.document)

    await screen.findByRole('heading', { name: 'Python cheat sheet', level: 1 })
    await userEvent.click(screen.getByRole('link', { name: /next lesson: practice exercises/i }))

    expect(
      await screen.findByRole('heading', { name: 'Practice exercises', level: 1 }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(lessonPath(learningLessonIds.text))
  })

  it('walks backward with Previous', async () => {
    const { router } = await openLesson(learningLessonIds.text)

    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })
    await userEvent.click(screen.getByRole('link', { name: /previous lesson: python cheat sheet/i }))

    await screen.findByRole('heading', { name: 'Python cheat sheet', level: 1 })
    expect(router.state.location.pathname).toBe(lessonPath(learningLessonIds.document))
  })

  it('offers no Previous on the first lesson', async () => {
    await openLesson(learningLessonIds.introduction)

    await screen.findByRole('heading', { name: 'Introduction', level: 1 })
    const pager = screen.getByRole('navigation', { name: 'Lesson navigation' })
    expect(within(pager).queryByRole('link', { name: /previous/i })).toBeNull()
    expect(within(pager).getByRole('link', { name: /next lesson/i })).toBeInTheDocument()
  })

  it('offers no Next on the last lesson', async () => {
    await openLesson(learningLessonIds.link)

    await screen.findByRole('heading', { name: 'Further reading', level: 1 })
    const pager = screen.getByRole('navigation', { name: 'Lesson navigation' })
    expect(within(pager).queryByRole('link', { name: /next lesson/i })).toBeNull()
    expect(within(pager).getByRole('link', { name: /previous/i })).toBeInTheDocument()
  })

  it('navigates through the router, with no full page load', async () => {
    const { harness, router } = await openLesson(learningLessonIds.introduction)

    const outline = await screen.findByRole('navigation', { name: 'Course content' })
    const sessionReadsBefore = harness.http.callsTo('/auth/me').length

    await userEvent.click(within(outline).getByRole('link', { name: /Further reading/ }))
    await screen.findByRole('heading', { name: 'Further reading', level: 1 })

    // A real page load would re-run the auth bootstrap; navigating in the
    // router does not touch the session at all.
    expect(harness.http.callsTo('/auth/me')).toHaveLength(sessionReadsBefore)
    expect(router.state.location.pathname).toBe(lessonPath(learningLessonIds.link))
  })

  it('follows browser back to the previous lesson', async () => {
    const { router } = await openLesson(learningLessonIds.introduction)

    const outline = await screen.findByRole('navigation', { name: 'Course content' })
    await userEvent.click(within(outline).getByRole('link', { name: /Practice exercises/ }))
    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })

    await router.navigate(-1)

    expect(
      await screen.findByRole('heading', { name: 'Introduction', level: 1 }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(lessonPath(learningLessonIds.introduction))
  })

  it('offers a breadcrumb back to the course and the catalogue', async () => {
    await openLesson(learningLessonIds.introduction)

    const breadcrumb = await screen.findByRole('navigation', { name: 'Breadcrumb' })
    expect(within(breadcrumb).getByRole('link', { name: 'Courses' })).toHaveAttribute(
      'href',
      '/courses',
    )
    expect(
      within(breadcrumb).getByRole('link', { name: 'Python Fundamentals' }),
    ).toHaveAttribute('href', `/courses/${COURSE_ID}`)
  })
})

describe('learning - lesson types', () => {
  it('renders a real video element for a VIDEO lesson', async () => {
    const { container } = await openLesson(learningLessonIds.introduction)

    await screen.findByRole('heading', { name: 'Introduction', level: 1 })
    // The FE-07 placeholder is gone, replaced by the player.
    expect(screen.queryByText(/ready for playback/i)).toBeNull()
    await waitFor(() => expect(container.querySelector('video')).not.toBeNull())
    expect(container.querySelectorAll('video')).toHaveLength(1)
  })

  it('renders the real text of a TEXT lesson', async () => {
    await openLesson(learningLessonIds.text)

    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })
    // The lesson's own text arrives with its own request, after the heading.
    expect(await screen.findByText('Before you start')).toBeInTheDocument()
    expect(
      screen.getByText('These exercises use only what you have seen so far.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/text lessons don’t count toward your course progress/i)).toBeInTheDocument()
  })

  it('renders lesson text as text, never as markup', async () => {
    await openLesson(learningLessonIds.text, (harness) => {
      stubCourse(harness)
      harness.http.on(`/lessons/${learningLessonIds.text}`, {
        json: { ...textLessonDetail, content: '<img src=x onerror="alert(1)">' },
      })
    })

    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })
    // The heading comes from the course tree; the text from its own request,
    // which may answer a moment later - so the text is waited for.
    expect(await screen.findByText('<img src=x onerror="alert(1)">')).toBeInTheDocument()
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })

  it('renders a LINK lesson as an explicit, safely-attributed link', async () => {
    await openLesson(learningLessonIds.link)

    await screen.findByRole('heading', { name: 'Further reading', level: 1 })
    const link = screen.getByRole('link', { name: /open link/i })
    expect(link).toHaveAttribute('href', 'https://docs.python.org/3/tutorial/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText(/you will leave the platform/i)).toBeInTheDocument()
  })

  it('refuses a LINK whose URL is not http(s)', async () => {
    await openLesson(learningLessonIds.link, (harness) => {
      stubCourse(harness)
      harness.http.on(`/lessons/${learningLessonIds.link}`, {
        // eslint-disable-next-line no-script-url
        json: { ...linkLessonDetail, content: 'javascript:alert(1)' },
      })
    })

    await screen.findByRole('heading', { name: 'Further reading', level: 1 })
    expect(screen.getByText(/this link is not available/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /open link/i })).toBeNull()
  })

  it('renders the document viewer for a DOCUMENT lesson', async () => {
    await openLesson(learningLessonIds.document)

    await screen.findByRole('heading', { name: 'Python cheat sheet', level: 1 })
    expect(
      await screen.findByRole('region', { name: `Document: ${documentResource.filename}` }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open document/i })).toBeEnabled()
    expect(screen.getByText(/documents don’t count toward your course progress/i)).toBeInTheDocument()
  })

  it('says so when a stored lesson has no file, using the backend flag', async () => {
    await openLesson(learningLessonIds.link, (harness) => {
      harness.http.on(`/courses/${COURSE_ID}/content`, {
        json: {
          ...learningContent,
          modules: learningContent.modules.map((module) => ({
            ...module,
            lessons: module.lessons.map((lesson) =>
              lesson.content_type === 'VIDEO' ? { ...lesson, has_resource: false } : lesson,
            ),
          })),
        },
      })
      harness.http.on(`/lessons/${learningLessonIds.link}`, { json: linkLessonDetail })
    })

    await screen.findByRole('heading', { name: 'Further reading', level: 1 })
    const outline = screen.getByRole('navigation', { name: 'Course content' })
    await userEvent.click(within(outline).getByRole('link', { name: /Introduction/ }))

    expect(await screen.findByText(/no video file has been uploaded/i)).toBeInTheDocument()
  })

  it('requests no media for a lesson the backend says has no file', async () => {
    const { harness } = await openLesson(learningLessonIds.introduction, (harness) => {
      harness.http.on(`/courses/${COURSE_ID}/content`, {
        json: {
          ...learningContent,
          modules: learningContent.modules.map((module) => ({
            ...module,
            lessons: module.lessons.map((lesson) =>
              lesson.content_type === 'VIDEO' ? { ...lesson, has_resource: false } : lesson,
            ),
          })),
        },
      })
    })

    await screen.findByText(/no video file has been uploaded/i)
    expect(harness.http.calls.filter((call) => call.url.includes('/resource'))).toHaveLength(0)
  })
})

describe('learning - request strategy', () => {
  it('reads the tree and the media URL, and no lesson content, for a VIDEO', async () => {
    const { harness } = await openLesson(learningLessonIds.introduction)

    await screen.findByRole('heading', { name: 'Introduction', level: 1 })
    await waitFor(() =>
      expect(
        harness.http.callsTo(`/lessons/${learningLessonIds.introduction}/resource`),
      ).toHaveLength(1),
    )

    // Reads only: the opening records (FE-LEARNING-TRACKING-01) are writes,
    // counted by LearningTracking.test.tsx, not a read cost.
    const feature = harness.http.calls.filter(
      (call) => !call.url.includes('/auth/') && !call.url.includes('/me/learning-events'),
    )
    expect(feature).toHaveLength(2)
  })

  it('asks for no lesson detail for a DOCUMENT either, only its file', async () => {
    const { harness } = await openLesson(learningLessonIds.document)

    await screen.findByRole('region', { name: `Document: ${documentResource.filename}` })

    // `catalog_get` blanks `content` for a DOCUMENT, so the detail endpoint
    // would answer nothing useful. The two resource reads are the whole cost.
    const detail = harness.http.calls.filter((call) =>
      new URL(call.url).pathname.endsWith(`/lessons/${learningLessonIds.document}`),
    )
    expect(detail).toHaveLength(0)
    expect(
      harness.http.callsTo(`/lessons/${learningLessonIds.document}/resource`),
    ).toHaveLength(1)
    expect(
      harness.http.callsTo(`/lessons/${learningLessonIds.document}/resource/content`),
    ).toHaveLength(1)
  })

  it('reads exactly one lesson detail for a TEXT lesson: the selected one', async () => {
    const { harness } = await openLesson(learningLessonIds.text)

    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })

    const lessonCalls = harness.http.calls.filter((call) => call.url.includes('/lessons/'))
    expect(lessonCalls).toHaveLength(1)
    expect(lessonCalls[0]?.url).toContain(learningLessonIds.text)
  })

  it('never calls the course progress endpoint, which would duplicate the tree', async () => {
    const { harness } = await openLesson(learningLessonIds.introduction)

    await screen.findByRole('heading', { name: 'Introduction', level: 1 })
    expect(harness.http.callsTo('/progress')).toHaveLength(0)
  })

  it('writes no progress merely from opening and leaving a lesson', async () => {
    const { harness } = await openLesson(learningLessonIds.introduction)

    await screen.findByRole('heading', { name: 'Introduction', level: 1 })
    const outline = screen.getByRole('navigation', { name: 'Course content' })
    await userEvent.click(within(outline).getByRole('link', { name: /Practice exercises/ }))
    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })

    // The opening records (FE-LEARNING-TRACKING-01) are the only writes allowed.
    expect(
      harness.http.calls.every(
        (call) => call.method === 'GET' || call.url.includes('/auth/') || call.url.includes('/me/learning-events'),
      ),
    ).toBe(true)
    expect(harness.http.calls.some((call) => call.url.includes('/progress'))).toBe(false)
  })
})

describe('learning - loading and errors', () => {
  it('announces the course loading state', async () => {
    await openLesson(learningLessonIds.introduction, (harness) => {
      harness.http.on(`/courses/${COURSE_ID}/content`, () => new Promise(() => ({})))
    })

    expect(await screen.findByRole('status', { name: 'Loading course' })).toBeInTheDocument()
  })

  it('announces the lesson loading state separately', async () => {
    await openLesson(learningLessonIds.text, (harness) => {
      harness.http.on(`/courses/${COURSE_ID}/content`, { json: learningContent })
      harness.http.on(`/lessons/${learningLessonIds.text}`, () => new Promise(() => ({})))
    })

    // The course frame is already there; only the body is still loading.
    expect(await screen.findByRole('status', { name: 'Loading lesson' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Practice exercises', level: 1 })).toBeInTheDocument()
  })

  it('shows no other lesson while the requested one loads', async () => {
    await openLesson(learningLessonIds.text, (harness) => {
      harness.http.on(`/courses/${COURSE_ID}/content`, { json: learningContent })
      harness.http.on(`/lessons/${learningLessonIds.text}`, () => new Promise(() => ({})))
    })

    await screen.findByRole('status', { name: 'Loading lesson' })
    expect(screen.queryByText('Video lesson')).toBeNull()
  })

  it('shows a page-level error when the course tree fails', async () => {
    await openLesson(learningLessonIds.introduction, (harness) => {
      harness.http.on(`/courses/${COURSE_ID}/content`, { status: 503, json: { detail: 'down' } })
    })

    // Access-States, "Server / network error" (G35): overline, copy, and a
    // way out beside the retry.
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.getByText('Error 500')).toBeInTheDocument()
    expect(
      screen.getByText('We couldn’t reach the server. Check your connection and try again.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/dashboard')
    expect(screen.queryByText('down')).toBeNull()
  })

  it('retries the course tree', async () => {
    await openLesson(learningLessonIds.introduction, (harness) => {
      harness.http.once(`/courses/${COURSE_ID}/content`, { status: 503, json: { detail: 'down' } })
      harness.http.on(`/courses/${COURSE_ID}/content`, { json: learningContent })
    })

    await userEvent.click(await screen.findByRole('button', { name: /try again/i }))

    expect(
      await screen.findByRole('heading', { name: 'Introduction', level: 1 }),
    ).toBeInTheDocument()
  })

  it('keeps the outline when only the lesson detail fails', async () => {
    await openLesson(learningLessonIds.text, (harness) => {
      harness.http.on(`/courses/${COURSE_ID}/content`, { json: learningContent })
      harness.http.on(`/lessons/${learningLessonIds.text}`, {
        status: 503,
        json: { detail: 'storage down' },
      })
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t load this lesson')
    expect(screen.getByRole('navigation', { name: 'Course content' })).toBeInTheDocument()
    expect(screen.queryByText('storage down')).toBeNull()
  })

  it('retries the lesson detail alone', async () => {
    await openLesson(learningLessonIds.text, (harness) => {
      harness.http.on(`/courses/${COURSE_ID}/content`, { json: learningContent })
      harness.http.once(`/lessons/${learningLessonIds.text}`, { status: 503, json: { detail: 'x' } })
      harness.http.on(`/lessons/${learningLessonIds.text}`, { json: textLessonDetail })
    })

    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(await screen.findByText('Before you start')).toBeInTheDocument()
  })

  it('reports the backend 404 as not enrolled, not as a missing course', async () => {
    await openLesson(learningLessonIds.introduction, (harness) => {
      harness.http.on(`/courses/${COURSE_ID}/content`, {
        status: 404,
        json: { detail: 'Enrollment not found' },
      })
    })

    // Access-States, "Learning page · not enrolled" (G34).
    expect(
      await screen.findByRole('heading', { name: 'Enroll to open this lesson' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'You need to be enrolled in this course to watch its lessons and track your progress.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /go to the course/i })).toHaveAttribute(
      'href',
      `/courses/${COURSE_ID}`,
    )
    expect(screen.queryByText('Enrollment not found')).toBeNull()
  })
})

describe('learning - security', () => {
  it('renders no token and calls no admin endpoint', async () => {
    const { harness } = await openLesson(learningLessonIds.text)

    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })

    const markup = document.body.innerHTML
    expect(markup).not.toContain('access-2')
    expect(markup).not.toContain('refresh-1')
    expect(markup).not.toMatch(/bearer/i)
    expect(harness.http.calls.some((call) => call.url.includes('/admin'))).toBe(false)
  })

  it('exposes no storage or provider vocabulary', async () => {
    await openLesson(learningLessonIds.document)

    await screen.findByRole('heading', { name: 'Python cheat sheet', level: 1 })
    expect(document.body.textContent).not.toMatch(/storage:\/\/|drive|bucket|provider|s3/i)
  })

  it('sends the token in the header, never in a URL', async () => {
    const { harness } = await openLesson(learningLessonIds.text)

    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })

    for (const call of harness.http.calls.filter((entry) => !entry.url.includes('/auth/'))) {
      expect(call.url).not.toMatch(/token/i)
      expect(call.headers.authorization).toMatch(/^Bearer /)
    }
  })
})

describe('learning - responsive and accessibility', () => {
  it('renders on a phone', async () => {
    await openLesson(learningLessonIds.introduction, stubCourse, viewports.mobile)

    expect(
      await screen.findByRole('heading', { name: 'Introduction', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Course content' })).toBeInTheDocument()
  })

  it('has exactly one level-1 heading, and it names the lesson', async () => {
    await openLesson(learningLessonIds.introduction)

    await screen.findByRole('heading', { name: 'Introduction', level: 1 })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('names each navigation landmark', async () => {
    await openLesson(learningLessonIds.document)

    await screen.findByRole('heading', { name: 'Python cheat sheet', level: 1 })
    for (const name of ['Breadcrumb', 'Course content', 'Lesson navigation']) {
      expect(screen.getByRole('navigation', { name })).toBeInTheDocument()
    }
  })

  it('reaches a sidebar lesson from the keyboard and opens it with Enter', async () => {
    const { router } = await openLesson(learningLessonIds.introduction)

    const outline = await screen.findByRole('navigation', { name: 'Course content' })
    const target = within(outline).getByRole('link', { name: /Practice exercises/ })
    target.focus()
    expect(target).toHaveFocus()

    await userEvent.keyboard('{Enter}')

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(lessonPath(learningLessonIds.text)),
    )
  })
})


// FE-QA-FINAL-01 (G25): the learning outline as DS 08 draws it - the
// "Now playing" / "Viewing" label, the finished module's check, the legend,
// the modules folding below 1024px, and the current lesson kept in view.
describe('learning - outline (DS 08)', () => {
  const outline = () => screen.getByRole('navigation', { name: 'Course content' })
  const moduleHeader = (title: string) =>
    within(outline()).getByRole('heading', { name: title, level: 3 }).closest('header')!

  it('labels the current video "Now playing", and nothing else', async () => {
    await openLesson(learningLessonIds.introduction)
    await screen.findByRole('heading', { name: 'Introduction', level: 1 })

    const current = within(outline()).getByRole('link', { current: 'page' })
    expect(within(current).getByText('Now playing')).toHaveAttribute('aria-hidden', 'true')
    expect(within(outline()).getAllByText(/^(Now playing|Viewing)$/)).toHaveLength(1)
  })

  it('labels a current text, document or link lesson "Viewing"', async () => {
    await openLesson(learningLessonIds.text)
    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })

    const current = within(outline()).getByRole('link', { current: 'page' })
    expect(within(current).getByText('Viewing')).toBeInTheDocument()
    expect(within(outline()).queryByText('Now playing')).toBeNull()
  })

  it('checks a module whose videos are all completed, and says so', async () => {
    await openLesson(learningLessonIds.text)
    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })

    // Getting started: its one video is completed.
    expect(moduleHeader('Getting started')).toHaveTextContent('1/1 videos, module completed')
    // Functions and structure has no video to complete.
    expect(moduleHeader('Functions and structure')).not.toHaveTextContent('module completed')
  })

  it('keys the markers in a legend, for the eye only', async () => {
    await openLesson(learningLessonIds.introduction)
    await screen.findByRole('heading', { name: 'Introduction', level: 1 })

    const legend = within(outline()).getByText('Not started').parentElement!
    expect(legend).toHaveAttribute('aria-hidden', 'true')
    expect(legend).toHaveTextContent('CompletedCurrentNot started')
  })

  it('shows every module open, with no disclosure, from 1024px', async () => {
    await openLesson(learningLessonIds.text, stubCourse, viewports.laptop)
    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })

    expect(within(outline()).queryAllByRole('button')).toEqual([])
    expect(within(outline()).getByRole('link', { name: /Introduction/ })).toBeVisible()
    expect(within(outline()).getByRole('link', { name: /Further reading/ })).toBeVisible()
  })

  it.each([
    ['768', viewports.tablet],
    ['390', viewports.mobile],
  ])('folds the other modules at %spx, keeping the current one open', async (_w, width) => {
    await openLesson(learningLessonIds.text, stubCourse, width)
    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })

    const current = within(outline()).getByRole('button', { name: 'Functions and structure' })
    const other = within(outline()).getByRole('button', { name: 'Getting started' })
    expect(current).toHaveAttribute('aria-expanded', 'true')
    expect(other).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById(other.getAttribute('aria-controls')!)).not.toBeVisible()
    expect(within(outline()).getByRole('link', { name: /Further reading/ })).toBeVisible()
    // The heading keeps the module's name: the button is inside it.
    expect(within(outline()).getByRole('heading', { name: 'Getting started', level: 3 })).toContainElement(other)

    // From the keyboard, as any button.
    other.focus()
    await userEvent.keyboard('{Enter}')
    expect(other).toHaveAttribute('aria-expanded', 'true')
    expect(within(outline()).getByRole('link', { name: /Introduction/ })).toBeVisible()
    await userEvent.keyboard(' ')
    expect(other).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the module of a lesson reached from elsewhere', async () => {
    const { router } = await openLesson(learningLessonIds.text, stubCourse, viewports.mobile)
    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })

    await router.navigate(lessonPath(learningLessonIds.introduction))

    await screen.findByRole('heading', { name: 'Introduction', level: 1 })
    expect(within(outline()).getByRole('button', { name: 'Getting started' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('scrolls the sidebar, never the window, to bring the current lesson into view', async () => {
    const { router } = await openLesson(learningLessonIds.introduction, stubCourse, viewports.laptop)
    await screen.findByRole('heading', { name: 'Introduction', level: 1 })

    // jsdom lays nothing out: give the sidebar a scroll box, and place the
    // current row below its bottom edge.
    const box = outline().parentElement!
    box.style.overflowY = 'auto'
    Object.defineProperty(box, 'scrollHeight', { configurable: true, value: 2000 })
    Object.defineProperty(box, 'clientHeight', { configurable: true, value: 400 })
    const rect = (top: number, height: number) =>
      ({ top, bottom: top + height, height, left: 0, right: 300, width: 300, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this === box) return rect(0, 400)
      if (this.getAttribute('aria-current') === 'page') return rect(900, 48)
      return original.call(this)
    }
    const windowScroll = window.scrollY

    try {
      await router.navigate(lessonPath(learningLessonIds.link))
      await screen.findByRole('heading', { name: 'Further reading', level: 1 })

      // Centred: 900 - (400 - 48) / 2.
      expect(box.scrollTop).toBe(724)
      expect(window.scrollY).toBe(windowScroll)
    } finally {
      Element.prototype.getBoundingClientRect = original
    }
  })
})

// FE-QA-FINAL-01 (G27): Learning-Mobile stacks "Next lesson" above
// "Previous"; wider boards keep Previous on the left. The DOM follows, so the
// reading and tab order are what is seen.
describe('learning - lesson pager order', () => {
  const stepNames = () =>
    within(screen.getByRole('navigation', { name: 'Lesson navigation' }))
      .getAllByRole('link')
      .map((link) => link.getAttribute('aria-label'))

  it('puts "Next lesson" first on a phone', async () => {
    await openLesson(learningLessonIds.text, stubCourse, viewports.mobile)
    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })

    expect(stepNames()).toEqual(['Next lesson: Further reading', 'Previous lesson: Python cheat sheet'])
  })

  it.each([
    ['768', viewports.tablet],
    ['1440', viewports.wide],
  ])('keeps Previous first at %spx', async (_w, width) => {
    await openLesson(learningLessonIds.text, stubCourse, width)
    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })

    expect(stepNames()).toEqual(['Previous lesson: Python cheat sheet', 'Next lesson: Further reading'])
  })
})
