import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { AuthHarness } from '../../test/authHarness'
import {
  catalogEnrolled,
  catalogLessonsByModule,
  catalogModules,
  courseContent,
  page,
} from '../../test/courseFixtures'
import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

const COURSE_ID = catalogEnrolled.id
const PATH = `/courses/${COURSE_ID}`

/** The course itself: every details test needs this one to succeed. */
function stubCourse(harness: AuthHarness) {
  harness.http.on(`/courses/${COURSE_ID}`, { json: catalogEnrolled })
}

/** The outline a member who is not enrolled may read (catalog projections). */
function stubCatalogOutline(harness: AuthHarness) {
  harness.http.on(`/courses/${COURSE_ID}/modules`, { json: page(catalogModules) })
  for (const module of catalogModules) {
    harness.http.on(`/modules/${module.id}/lessons`, {
      json: page(catalogLessonsByModule[module.id] ?? []),
    })
  }
}

/** Not enrolled: `/content` answers 404, which is the backend's own "no". */
function stubNotEnrolled(harness: AuthHarness) {
  stubCourse(harness)
  harness.http.on(`/courses/${COURSE_ID}/content`, {
    status: 404,
    json: { detail: 'Enrollment not found' },
  })
  stubCatalogOutline(harness)
}

/**
 * Not enrolled, and about to be: the FIRST `/content` read answers 404, and the
 * one that follows the POST answers 200 - exactly what the backend does.
 */
function stubEnrollable(harness: AuthHarness) {
  stubCourse(harness)
  harness.http.once(`/courses/${COURSE_ID}/content`, {
    status: 404,
    json: { detail: 'Enrollment not found' },
  })
  harness.http.on(`/courses/${COURSE_ID}/content`, { json: courseContent })
  stubCatalogOutline(harness)
}

/** Enrolled: `/content` answers 200 with the tree and this member's progress. */
function stubEnrolled(harness: AuthHarness, content = courseContent) {
  stubCourse(harness)
  harness.http.on(`/courses/${COURSE_ID}/content`, { json: content })
}

const openDetails = (beforeMount: (harness: AuthHarness) => void, width?: number) =>
  renderRoute({ path: PATH, as: 'member', beforeMount, ...(width ? { width } : {}) })

/**
 * Where a successful enrollment leads (Course-Details-States DEV NOTE: "After
 * success -> Learning page at the first lesson"): module 1, lesson 1.
 */
const FIRST_LESSON_PATH = `${PATH}/lessons/${courseContent.modules[0]!.lessons[0]!.id}`

describe('course details - loading the course', () => {
  it('announces a loading state before anything has arrived', async () => {
    await openDetails((harness) => {
      stubCourse(harness)
      harness.http.on(`/courses/${COURSE_ID}/content`, () => new Promise(() => ({})))
    })

    expect(await screen.findByRole('status', { name: 'Loading course' })).toBeInTheDocument()
  })

  it('renders the backend title and description', async () => {
    await openDetails(stubNotEnrolled)

    expect(
      await screen.findByRole('heading', { name: catalogEnrolled.title, level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByText(catalogEnrolled.description)).toBeInTheDocument()
  })

  it('shows the design placeholder rather than an invented image when thumbnail_url is null', async () => {
    await openDetails((harness) => {
      harness.http.on(`/courses/${COURSE_ID}`, { json: { ...catalogEnrolled, thumbnail_url: null } })
      harness.http.on(`/courses/${COURSE_ID}/content`, {
        status: 404,
        json: { detail: 'Enrollment not found' },
      })
      stubCatalogOutline(harness)
    })

    await screen.findByRole('heading', { name: catalogEnrolled.title, level: 1 })
    // Scoped to the page: the shell's own logo is an image too.
    expect(screen.getByRole('main').querySelector('img')).toBeNull()
  })

  it('renders the course thumbnail when the backend has one', async () => {
    await openDetails(stubNotEnrolled)

    await screen.findByRole('heading', { name: catalogEnrolled.title, level: 1 })
    expect(screen.getByRole('main').querySelector('img')).toHaveAttribute(
      'src',
      catalogEnrolled.thumbnail_url,
    )
  })

  it('invents no metadata the backend does not store', async () => {
    await openDetails(stubNotEnrolled)

    await screen.findByRole('heading', { name: catalogEnrolled.title, level: 1 })
    for (const invented of [/instructor/i, /rating/i, /students?\b/i, /difficulty/i, /category/i, /certificat/i]) {
      expect(screen.queryByText(invented)).toBeNull()
    }
  })

  it('shows the not-available state on a 404, without exposing the backend detail', async () => {
    await openDetails((harness) => {
      harness.http.on(`/courses/${COURSE_ID}`, {
        status: 404,
        json: { detail: 'Course not found' },
      })
    })

    expect(
      await screen.findByRole('heading', { name: 'This course isn’t available' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /browse courses/i })).toHaveAttribute(
      'href',
      '/courses',
    )
    expect(screen.queryByText('Course not found')).toBeNull()
  })

  it('treats an unpublished course exactly as a missing one, because the backend does', async () => {
    // `catalog_get` loads with published=True, so DRAFT and ARCHIVED answer 404.
    await openDetails((harness) => {
      harness.http.on(`/courses/${COURSE_ID}`, { status: 404, json: { detail: 'Course not found' } })
    })

    expect(
      await screen.findByRole('heading', { name: 'This course isn’t available' }),
    ).toBeInTheDocument()
  })

  it('shows a retryable page error when the course request fails', async () => {
    await openDetails((harness) => {
      harness.http.failNetwork(`/courses/${COURSE_ID}`)
      harness.http.on(`/courses/${COURSE_ID}`, { json: catalogEnrolled })
      harness.http.on(`/courses/${COURSE_ID}/content`, {
        status: 404,
        json: { detail: 'Enrollment not found' },
      })
      stubCatalogOutline(harness)
    })

    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.getByText('Error 500')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/dashboard')

    await userEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(
      await screen.findByRole('heading', { name: catalogEnrolled.title, level: 1 }),
    ).toBeInTheDocument()
  })
})

describe('course details - content preview', () => {
  it('renders the outline a member who is not enrolled may read', async () => {
    await openDetails(stubNotEnrolled)

    await screen.findByRole('heading', { name: catalogEnrolled.title, level: 1 })
    expect(screen.getByRole('heading', { name: 'Getting started', level: 3 })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Functions and structure', level: 3 }),
    ).toBeInTheDocument()
    expect(screen.getByText('Introduction')).toBeInTheDocument()
    expect(screen.getByText('Parameters and return values')).toBeInTheDocument()
  })

  it('says the lessons open on enrollment rather than pretending they are playable', async () => {
    await openDetails(stubNotEnrolled)

    expect(await screen.findByText(/lessons open once you are enrolled/i)).toBeInTheDocument()
  })

  it('claims no completion at all before enrollment', async () => {
    await openDetails(stubNotEnrolled)

    await screen.findByText('Introduction')
    // `Introduction` IS completed in the enrolled fixture; the catalog
    // projection carries no progress, so none may be shown.
    expect(screen.queryByText(/— Completed/)).toBeNull()
    expect(screen.queryByText(/videos completed/i)).toBeNull()
  })

  it('renders the completion markers an enrolled member has', async () => {
    await openDetails((harness) => stubEnrolled(harness))

    expect(await screen.findByText(/Introduction/)).toBeInTheDocument()
    const introduction = screen.getByText('Introduction').closest('li')
    expect(introduction).toHaveTextContent('Completed')
  })

  it('marks the first unfinished video as the current lesson', async () => {
    await openDetails((harness) => stubEnrolled(harness))

    const current = await screen.findByText('Parameters and return values')
    // The row itself carries the state; it is the link now that lessons open,
    // so `aria-current` sits on the interactive element rather than the <li>.
    const row = current.closest('li')?.firstElementChild
    expect(row).toHaveAttribute('aria-current', 'step')
    expect(row).toHaveTextContent('Current lesson')
  })

  it('gives a non-video lesson a type badge and no completion marker', async () => {
    await openDetails((harness) => stubEnrolled(harness))

    const document_ = (await screen.findByText('Python cheat sheet')).closest('li')
    expect(document_).toHaveTextContent('DOCUMENT')
    expect(document_).not.toHaveTextContent('Not started')
  })

  it('shows each lesson duration from the backend', async () => {
    await openDetails((harness) => stubEnrolled(harness))

    // 384s and 690s, as the board formats them.
    expect(await screen.findByText('06:24')).toBeInTheDocument()
    expect(screen.getByText('11:30')).toBeInTheDocument()
  })

  it('numbers each module from its backend position, without announcing it twice', async () => {
    await openDetails(stubNotEnrolled)

    const heading = await screen.findByRole('heading', { name: 'Getting started', level: 3 })
    const header = heading.closest('header') as HTMLElement
    const numeral = within(header).getByText('01')

    // Decorative: the module is already named by its heading, so the numeral is
    // a visual marker only and must not be read out as a second label.
    expect(numeral).toHaveAttribute('aria-hidden', 'true')
    // Backend `position`, padded - not the array index.
    expect(within(screen.getByRole('main')).getByText('02')).toBeInTheDocument()
  })

  it('keeps an empty module visible, because the backend returned it', async () => {
    await openDetails((harness) =>
      stubEnrolled(harness, {
        ...courseContent,
        modules: [
          { id: 'm0', title: 'Empty module', description: null, position: 3, lessons: [] },
          ...courseContent.modules,
        ],
      }),
    )

    expect(await screen.findByRole('heading', { name: 'Empty module', level: 3 })).toBeInTheDocument()
    expect(screen.getByText(/no lesson in this module yet/i)).toBeInTheDocument()
  })

  it('leaks no storage or provider vocabulary into the member UI', async () => {
    await openDetails((harness) => stubEnrolled(harness))

    await screen.findByText('Introduction')
    expect(document.body.textContent).not.toMatch(/storage:\/\/|drive|bucket|provider/i)
  })

  it('degrades to a retryable notice when only the outline fails', async () => {
    await openDetails((harness) => {
      stubCourse(harness)
      harness.http.on(`/courses/${COURSE_ID}/content`, {
        status: 404,
        json: { detail: 'Enrollment not found' },
      })
      harness.http.on(`/courses/${COURSE_ID}/modules`, { status: 503, json: { detail: 'nope' } })
    })

    expect(await screen.findByText(/couldn’t load the course outline/i)).toBeInTheDocument()
    // The course and its Enroll action still stand.
    expect(screen.getByRole('button', { name: /enroll in this course/i })).toBeInTheDocument()
  })
})

describe('course details - enrollment state', () => {
  it('offers Enroll when the backend says the member is not enrolled', async () => {
    await openDetails(stubNotEnrolled)

    expect(
      await screen.findByRole('button', { name: /enroll in this course/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('Not enrolled')).toBeInTheDocument()
  })

  it('never offers Enroll to a member who is already enrolled', async () => {
    await openDetails((harness) => stubEnrolled(harness))

    await screen.findByRole('heading', { name: catalogEnrolled.title, level: 1 })
    expect(screen.queryByRole('button', { name: /enroll in this course/i })).toBeNull()
    expect(screen.getByRole('link', { name: /continue/i })).toBeInTheDocument()
  })

  it('shows the backend progress aggregate rather than recounting it', async () => {
    await openDetails((harness) => stubEnrolled(harness))

    const bar = await screen.findByRole('progressbar', { name: /python fundamentals progress/i })
    expect(bar).toHaveAttribute('aria-valuenow', '45')
    expect(screen.getByText('5 of 11 videos completed')).toBeInTheDocument()
  })

  it('shows the completed state from the backend flag', async () => {
    await openDetails((harness) =>
      stubEnrolled(harness, {
        ...courseContent,
        completed: true,
        progress_percent: 100,
        completed_video_lessons: 11,
      }),
    )

    expect(await screen.findByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('11 of 11 videos completed')).toBeInTheDocument()
  })

  it('never claims "not enrolled" when the enrollment read failed', async () => {
    await openDetails((harness) => {
      stubCourse(harness)
      harness.http.on(`/courses/${COURSE_ID}/content`, { status: 503, json: { detail: 'down' } })
    })

    expect(await screen.findByText(/unable to determine enrollment status/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /enroll in this course/i })).toBeNull()
    expect(screen.queryByText('Not enrolled')).toBeNull()
  })

  it('recovers from an unknown enrollment state on retry', async () => {
    await openDetails((harness) => {
      stubCourse(harness)
      harness.http.once(`/courses/${COURSE_ID}/content`, { status: 503, json: { detail: 'down' } })
      harness.http.on(`/courses/${COURSE_ID}/content`, { json: courseContent })
    })

    await userEvent.click(await screen.findByRole('button', { name: /try again/i }))

    expect(await screen.findByText('5 of 11 videos completed')).toBeInTheDocument()
  })
})

describe('course details - enrolling', () => {
  it('posts to the real endpoint with the real course id, exactly once', async () => {
    const { harness, router } = await openDetails((harness) => {
      stubEnrollable(harness)
      harness.http.on('/enroll', {
        json: {
          id: 'e1000000-0000-4000-8000-000000000001',
          course_id: COURSE_ID,
          enrolled_at: '2026-09-20T10:00:00Z',
          completed_at: null,
        },
      })
    })

    await userEvent.click(await screen.findByRole('button', { name: /enroll in this course/i }))
    await waitFor(() => expect(router.state.location.pathname).toBe(FIRST_LESSON_PATH))

    const posts = harness.http.callsTo('/enroll')
    expect(posts).toHaveLength(1)
    expect(posts[0]?.method).toBe('POST')
    expect(posts[0]?.url).toContain(`/courses/${COURSE_ID}/enroll`)
  })

  it('does not send a request body, because the endpoint takes none', async () => {
    const { harness, router } = await openDetails((harness) => {
      stubEnrollable(harness)
      harness.http.on('/enroll', { json: { id: 'e1', course_id: COURSE_ID, enrolled_at: 'x', completed_at: null } })
    })

    await userEvent.click(await screen.findByRole('button', { name: /enroll in this course/i }))
    await waitFor(() => expect(router.state.location.pathname).toBe(FIRST_LESSON_PATH))

    expect(harness.http.callsTo('/enroll')[0]?.body).toBeUndefined()
  })

  it('disables the button and announces progress while the request is in flight', async () => {
    await openDetails((harness) => {
      stubNotEnrolled(harness)
      harness.http.on('/enroll', () => new Promise(() => ({})))
    })

    await userEvent.click(await screen.findByRole('button', { name: /enroll in this course/i }))

    const busy = await screen.findByRole('button', { name: /enrolling/i })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')
  })

  it('two rapid clicks produce one enrollment request', async () => {
    const { harness } = await openDetails((harness) => {
      stubNotEnrolled(harness)
      harness.http.on('/enroll', () => new Promise(() => ({})))
    })

    const button = await screen.findByRole('button', { name: /enroll in this course/i })
    await userEvent.click(button)
    await userEvent.click(button)

    await waitFor(() => expect(harness.http.callsTo('/enroll')).toHaveLength(1))
  })

  // FE-QA-FIX-01 (G18) - Course-Details-States DEV NOTE: "After success ->
  // Learning page at the first lesson".
  it('opens the learning page at the first lesson once enrolled', async () => {
    const { router } = await openDetails((harness) => {
      stubEnrollable(harness)
      harness.http.on('/enroll', { json: { id: 'e1', course_id: COURSE_ID, enrolled_at: 'x', completed_at: null } })
    })

    await userEvent.click(await screen.findByRole('button', { name: /enroll in this course/i }))

    await waitFor(() => expect(router.state.location.pathname).toBe(FIRST_LESSON_PATH))
    expect(await screen.findByRole('heading', { name: 'Introduction', level: 1 })).toBeInTheDocument()

    // Back returns to the course, now in its enrolled state.
    router.navigate(-1)
    expect(await screen.findByText('5 of 11 videos completed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /enroll in this course/i })).toBeNull()
  })

  it('stays on the page, enrolled, when the course has no lesson yet', async () => {
    const empty = {
      ...courseContent,
      total_video_lessons: 0,
      completed_video_lessons: 0,
      progress_percent: 0,
      modules: courseContent.modules.map((module) => ({ ...module, lessons: [] })),
    }
    const { router } = await openDetails((harness) => {
      stubCourse(harness)
      harness.http.once(`/courses/${COURSE_ID}/content`, { status: 404, json: { detail: 'Enrollment not found' } })
      harness.http.on(`/courses/${COURSE_ID}/content`, { json: empty })
      stubCatalogOutline(harness)
      harness.http.on('/enroll', { json: { id: 'e1', course_id: COURSE_ID, enrolled_at: 'x', completed_at: null } })
    })

    await userEvent.click(await screen.findByRole('button', { name: /enroll in this course/i }))

    await waitFor(() => expect(screen.queryByRole('button', { name: /enroll in this course/i })).toBeNull())
    expect(screen.queryByText(/lessons open once you are enrolled/i)).toBeNull()
    expect(router.state.location.pathname).toBe(PATH)
  })

  it('costs one POST plus one content read, and nothing more', async () => {
    const { harness, router } = await openDetails((harness) => {
      stubEnrollable(harness)
      harness.http.on('/enroll', { json: { id: 'e1', course_id: COURSE_ID, enrolled_at: 'x', completed_at: null } })
    })

    await screen.findByRole('button', { name: /enroll in this course/i })
    const before = harness.http.calls.length

    await userEvent.click(screen.getByRole('button', { name: /enroll in this course/i }))
    await waitFor(() => expect(router.state.location.pathname).toBe(FIRST_LESSON_PATH))

    // The details page's own cost, before the learning page takes over and
    // reads what it needs: the POST, then one content read.
    const after = harness.http.calls.slice(before)
    expect(after[0]?.method).toBe('POST')
    expect(after[0]?.url).toContain(`/courses/${COURSE_ID}/enroll`)
    expect(after[1]?.method).toBe('GET')
    expect(after[1]?.url).toContain(`/courses/${COURSE_ID}/content`)
    expect(harness.http.callsTo('/enroll')).toHaveLength(1)
    // Nothing re-reads the course or the catalogue outline.
    expect(after.filter((call) => /\/modules\//.test(call.url) || call.url.endsWith(`/courses/${COURSE_ID}`))).toEqual([])
  })

  it('shows a safe error and keeps the member on the page when enrollment fails', async () => {
    await openDetails((harness) => {
      stubNotEnrolled(harness)
      harness.http.on('/enroll', { status: 500, json: { detail: 'Internal server error' } })
    })

    await userEvent.click(await screen.findByRole('button', { name: /enroll in this course/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('We couldn’t enroll you in this course')
    expect(alert).not.toHaveTextContent('Internal server error')
    expect(screen.getByRole('heading', { name: catalogEnrolled.title, level: 1 })).toBeInTheDocument()
  })

  it('translates the backend 409 into the design copy, not its detail string', async () => {
    await openDetails((harness) => {
      stubNotEnrolled(harness)
      harness.http.on('/enroll', {
        status: 409,
        json: { detail: 'Enrollment requires a PUBLISHED course' },
      })
    })

    await userEvent.click(await screen.findByRole('button', { name: /enroll in this course/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('This course isn’t open for enrollment')
    expect(alert).not.toHaveTextContent('PUBLISHED')
  })

  it('lets the member retry after a failure', async () => {
    const { harness, router } = await openDetails((harness) => {
      stubNotEnrolled(harness)
      harness.http.once('/enroll', { status: 500, json: { detail: 'boom' } })
      harness.http.on('/enroll', { json: { id: 'e1', course_id: COURSE_ID, enrolled_at: 'x', completed_at: null } })
    })

    await userEvent.click(await screen.findByRole('button', { name: /enroll in this course/i }))
    await screen.findByRole('alert')

    harness.http.on(`/courses/${COURSE_ID}/content`, { json: courseContent })
    await userEvent.click(screen.getByRole('button', { name: /enroll in this course/i }))

    await waitFor(() => expect(router.state.location.pathname).toBe(FIRST_LESSON_PATH))
  })
})

describe('course details - navigation', () => {
  it('opens from the catalogue with the real course id', async () => {
    const { router } = await renderRoute({
      path: '/courses',
      as: 'member',
      beforeMount: (harness) => {
        harness.http.on('/courses', { json: page([catalogEnrolled]) })
        stubNotEnrolled(harness)
      },
    })

    const list = await screen.findByRole('list', { name: 'Courses' })
    await userEvent.click(within(list).getByRole('link', { name: catalogEnrolled.title }))

    await screen.findByRole('heading', { name: catalogEnrolled.title, level: 1 })
    expect(router.state.location.pathname).toBe(PATH)
  })

  it('goes back to the catalogue keeping its URL state', async () => {
    const { router } = await renderRoute({
      path: '/courses?search=python&page=1',
      as: 'member',
      beforeMount: (harness) => {
        harness.http.on('/courses', { json: page([catalogEnrolled]) })
        stubNotEnrolled(harness)
      },
    })

    const list = await screen.findByRole('list', { name: 'Courses' })
    await userEvent.click(within(list).getByRole('link', { name: catalogEnrolled.title }))
    await screen.findByRole('heading', { name: catalogEnrolled.title, level: 1 })

    await router.navigate(-1)

    await waitFor(() => expect(router.state.location.pathname).toBe('/courses'))
    expect(router.state.location.search).toContain('search=python')
  })

  it('points Continue at the existing learning route for the real lesson', async () => {
    await openDetails((harness) => stubEnrolled(harness))

    const link = await screen.findByRole('link', { name: /continue/i })
    expect(link).toHaveAttribute(
      'href',
      `${PATH}/lessons/l2000000-0000-4000-8000-000000000001`,
    )
  })

  it('offers a breadcrumb back to the catalogue', async () => {
    await openDetails(stubNotEnrolled)

    const breadcrumb = await screen.findByRole('navigation', { name: 'Breadcrumb' })
    expect(within(breadcrumb).getByRole('link', { name: 'Courses' })).toHaveAttribute(
      'href',
      '/courses',
    )
  })
})

describe('course details - security', () => {
  it('renders no token and calls no admin endpoint', async () => {
    const { harness } = await openDetails((harness) => stubEnrolled(harness))

    await screen.findByRole('heading', { name: catalogEnrolled.title, level: 1 })

    const markup = document.body.innerHTML
    expect(markup).not.toContain('access-2')
    expect(markup).not.toContain('refresh-1')
    expect(markup).not.toMatch(/bearer/i)
    expect(harness.http.calls.some((call) => call.url.includes('/admin'))).toBe(false)
  })

  it('sends the access token in the header, never in the URL', async () => {
    const { harness } = await openDetails((harness) => stubEnrolled(harness))

    await screen.findByRole('heading', { name: catalogEnrolled.title, level: 1 })

    for (const call of harness.http.callsTo('/content')) {
      expect(call.url).not.toMatch(/token/i)
      expect(call.headers.authorization).toMatch(/^Bearer /)
    }
  })
})

describe('course details - request strategy', () => {
  it('costs two requests for an enrolled member', async () => {
    const { harness } = await openDetails((harness) => stubEnrolled(harness))

    await screen.findByText('5 of 11 videos completed')

    // Reads only: the course_opened record (FE-LEARNING-TRACKING-01) is a
    // write, counted by LearningTracking.test.tsx, not a read cost.
    const feature = harness.http.calls.filter(
      (call) => !call.url.includes('/auth/') && !call.url.includes('/me/learning-events'),
    )
    expect(feature).toHaveLength(2)
  })

  it('never reads the whole enrollment list for one course', async () => {
    const { harness } = await openDetails((harness) => stubEnrolled(harness))

    await screen.findByText('5 of 11 videos completed')
    expect(harness.http.callsTo('/me/enrollments')).toHaveLength(0)
  })
})

describe('course details - responsive and accessibility', () => {
  it('renders on a phone', async () => {
    await openDetails(stubNotEnrolled, viewports.mobile)

    expect(
      await screen.findByRole('heading', { name: catalogEnrolled.title, level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /enroll in this course/i })).toBeInTheDocument()
  })

  it('has exactly one level-1 heading, and it names the course', async () => {
    await openDetails(stubNotEnrolled)

    await screen.findByRole('heading', { name: catalogEnrolled.title, level: 1 })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('names the course content section', async () => {
    await openDetails(stubNotEnrolled)

    expect(
      await screen.findByRole('heading', { name: 'Course content', level: 2 }),
    ).toBeInTheDocument()
  })

  it('reaches and activates the enroll button from the keyboard', async () => {
    const { harness } = await openDetails((harness) => {
      stubNotEnrolled(harness)
      harness.http.on('/enroll', () => new Promise(() => ({})))
    })

    const button = await screen.findByRole('button', { name: /enroll in this course/i })
    button.focus()
    expect(button).toHaveFocus()

    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(harness.http.callsTo('/enroll')).toHaveLength(1))
  })
})


// FE-QA-FINAL-01 (G25, G34): the details outline as Course-Details-Enrolled
// and Details-Mobile draw it.
describe('course details - outline (DS 08)', () => {
  const moduleHeader = (title: string) =>
    screen.getByRole('heading', { name: title, level: 3 }).closest('header')!

  it('counts each module as the board does: lessons, then completed videos', async () => {
    await openDetails((harness) => stubEnrolled(harness))
    await screen.findByRole('heading', { name: catalogEnrolled.title, level: 1 })

    expect(moduleHeader('Getting started')).toHaveTextContent('2 lessons · 1/1 videos completed')
  })

  it('counts lessons only before enrollment, when there is no progress to count', async () => {
    await openDetails(stubNotEnrolled)
    await screen.findByRole('heading', { name: catalogEnrolled.title, level: 1 })

    expect(moduleHeader('Getting started')).toHaveTextContent('2 lessons')
    expect(moduleHeader('Getting started')).not.toHaveTextContent('videos completed')
  })

  it('marks the lesson "Continue" opens as "Next up", and no other', async () => {
    await openDetails((harness) => stubEnrolled(harness))
    await screen.findByRole('heading', { name: catalogEnrolled.title, level: 1 })

    const next = screen.getAllByText('Next up')
    expect(next).toHaveLength(1)
    expect(next[0]).toHaveAttribute('aria-hidden', 'true')
    expect(next[0]!.closest('a')).toHaveAttribute('aria-current', 'step')
  })

  it('folds the modules on a phone, keeping the next lesson’s module open', async () => {
    await openDetails((harness) => stubEnrolled(harness), viewports.mobile)
    await screen.findByRole('heading', { name: catalogEnrolled.title, level: 1 })

    const first = screen.getByRole('button', { name: 'Getting started' })
    const second = screen.getByRole('button', { name: 'Functions and structure' })
    expect(first).toHaveAttribute('aria-expanded', 'false')
    expect(second).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Next up')).toBeVisible()

    await userEvent.click(first)
    expect(first).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: /Introduction/ })).toBeVisible()
  })

  it('keeps every module open on a desktop', async () => {
    await openDetails((harness) => stubEnrolled(harness), viewports.wide)
    await screen.findByRole('heading', { name: catalogEnrolled.title, level: 1 })

    expect(screen.queryByRole('button', { name: 'Getting started' })).toBeNull()
    expect(screen.getByRole('link', { name: /Introduction/ })).toBeVisible()
  })
})
