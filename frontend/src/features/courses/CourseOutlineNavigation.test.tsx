import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { AuthHarness } from '../../test/authHarness'
import {
  catalogEnrolled,
  catalogLessonsByModule,
  catalogModules,
  courseContent,
  documentResource,
  page,
  pdfBytes,
  videoResource,
} from '../../test/courseFixtures'
import { renderRoute } from '../../test/renderRoute'

/**
 * Opening a lesson from the course details outline.
 *
 * FE-06 shipped that outline as inert rows, because the learning page did not
 * exist yet. Once it did, the outline became the only way to reach a lesson
 * that "Continue learning" never points at - it targets the first unfinished
 * VIDEO, so a DOCUMENT, TEXT or LINK lesson had no route in from the UI at all.
 * These tests pin the whole path: row -> link -> learning route -> the right
 * body for the lesson's kind.
 */

const COURSE_ID = catalogEnrolled.id
const PATH = `/courses/${COURSE_ID}`

const VIDEO_DONE = 'l1000000-0000-4000-8000-000000000001'
const DOCUMENT = 'l1000000-0000-4000-8000-000000000002'
const VIDEO_CURRENT = 'l2000000-0000-4000-8000-000000000001'
const TEXT = 'l2000000-0000-4000-8000-000000000002'
const LINK = 'l2000000-0000-4000-8000-000000000003'

const lessonPath = (lessonId: string) => `/courses/${COURSE_ID}/lessons/${lessonId}`

/** `courseContent` plus a TEXT and a LINK lesson, so all four kinds are here. */
const everyKind = {
  ...courseContent,
  modules: courseContent.modules.map((module, index) =>
    index === 1
      ? {
          ...module,
          lessons: [
            ...module.lessons,
            {
              id: TEXT,
              title: 'Practice exercises',
              description: null,
              content_type: 'TEXT' as const,
              duration_seconds: null,
              position: 2,
              is_preview: false,
              has_resource: false,
              watched_seconds: null,
              completed: null,
              completed_at: null,
            },
            {
              id: LINK,
              title: 'Further reading',
              description: null,
              content_type: 'LINK' as const,
              duration_seconds: null,
              position: 3,
              is_preview: false,
              has_resource: false,
              watched_seconds: null,
              completed: null,
              completed_at: null,
            },
          ],
        }
      : module,
  ),
}

const textDetail = {
  id: TEXT,
  title: 'Practice exercises',
  description: null,
  content_type: 'TEXT' as const,
  duration_seconds: null,
  position: 2,
  is_preview: false,
  content: 'Before you start\n\nThese exercises use only what you have seen so far.',
}

const linkDetail = {
  ...textDetail,
  id: LINK,
  title: 'Further reading',
  content_type: 'LINK' as const,
  position: 3,
  content: 'https://docs.python.org/3/tutorial/',
}

/** Enrolled, with every endpoint the learning page may reach for any kind. */
function stubEnrolled(harness: AuthHarness, content: typeof courseContent = everyKind) {
  harness.http.on(`/courses/${COURSE_ID}`, { json: catalogEnrolled })
  harness.http.on(`/courses/${COURSE_ID}/content`, { json: content })
  harness.http.on(`/lessons/${TEXT}`, { json: textDetail })
  harness.http.on(`/lessons/${LINK}`, { json: linkDetail })
  harness.http.on(`/lessons/${VIDEO_DONE}/resource`, {
    json: { ...videoResource, lesson_id: VIDEO_DONE },
  })
  harness.http.on(`/lessons/${VIDEO_CURRENT}/resource`, {
    json: { ...videoResource, lesson_id: VIDEO_CURRENT },
  })
  harness.http.on(`/lessons/${DOCUMENT}/resource`, {
    // `download_url` names the lesson too, so it has to move with `lesson_id`;
    // the viewer follows the URL the backend gives, not one it rebuilds.
    json: {
      ...documentResource,
      lesson_id: DOCUMENT,
      download_url: `/api/v1/lessons/${DOCUMENT}/resource/content`,
    },
  })
  harness.http.on(`/lessons/${DOCUMENT}/resource/content`, {
    bytes: pdfBytes,
    contentType: 'application/pdf',
  })
}

/** Not enrolled: `/content` is a 404 and the catalogue outline is read instead. */
function stubNotEnrolled(harness: AuthHarness) {
  harness.http.on(`/courses/${COURSE_ID}`, { json: catalogEnrolled })
  harness.http.on(`/courses/${COURSE_ID}/content`, {
    status: 404,
    json: { detail: 'Enrollment not found' },
  })
  harness.http.on(`/courses/${COURSE_ID}/modules`, { json: page(catalogModules) })
  for (const module of catalogModules) {
    harness.http.on(`/modules/${module.id}/lessons`, {
      json: page(catalogLessonsByModule[module.id] ?? []),
    })
  }
}

const openDetails = (beforeMount: (harness: AuthHarness) => void = stubEnrolled) =>
  renderRoute({ path: PATH, as: 'member', beforeMount })

/** The outline row for a lesson, by its visible title. */
const rowFor = async (title: string) => {
  const heading = await screen.findByText(title)
  const row = heading.closest('li')?.firstElementChild
  if (!row) throw new Error(`no outline row for ${title}`)
  return row as HTMLElement
}

describe('course details - lesson rows are navigable', () => {
  it('renders the DOCUMENT lesson as a link, not an inert row', async () => {
    await openDetails()
    const row = await rowFor('Python cheat sheet')

    expect(row.tagName).toBe('A')
    expect(row).toHaveAttribute('href', lessonPath(DOCUMENT))
  })

  it('points every lesson kind at the one learning route', async () => {
    await openDetails()

    for (const [title, lessonId] of [
      ['Introduction', VIDEO_DONE],
      ['Python cheat sheet', DOCUMENT],
      ['Parameters and return values', VIDEO_CURRENT],
      ['Practice exercises', TEXT],
      ['Further reading', LINK],
    ] as const) {
      const row = await rowFor(title)
      expect(row).toHaveAttribute('href', lessonPath(lessonId))
    }
  })

  it('names the whole row, not only the title fragment', async () => {
    await openDetails()
    const row = await rowFor('Python cheat sheet')

    // Title and type badge are both inside the one interactive element.
    expect(within(row).getByText('Python cheat sheet')).toBeInTheDocument()
    expect(within(row).getByText('DOCUMENT')).toBeInTheDocument()
    expect(within(row).queryByRole('button')).toBeNull()
    expect(within(row).queryByRole('link')).toBeNull()
  })

  it('keeps the rows inert for a member who is not enrolled', async () => {
    await openDetails(stubNotEnrolled)
    const row = await rowFor('Python cheat sheet')

    // The content endpoint refuses this member, so the link could only lead to
    // a refusal. The banner above the outline says the same thing in words.
    expect(row.tagName).not.toBe('A')
    expect(screen.getByText(/lessons open once you are enrolled/i)).toBeInTheDocument()
  })
})

describe('course details - opening a lesson', () => {
  it('opens the DOCUMENT lesson and reaches the document viewer', async () => {
    const { router } = await openDetails()

    await userEvent.click(await rowFor('Python cheat sheet'))

    expect(router.state.location.pathname).toBe(lessonPath(DOCUMENT))
    expect(
      await screen.findByRole('heading', { name: 'Python cheat sheet', level: 1 }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('region', { name: `Document: ${documentResource.filename}` }),
    ).toBeInTheDocument()
  })

  it('hands the document viewer the selected lesson, not another one', async () => {
    const { harness } = await openDetails()

    await userEvent.click(await rowFor('Python cheat sheet'))
    await screen.findByRole('region', { name: `Document: ${documentResource.filename}` })

    expect(harness.http.callsTo(`/lessons/${DOCUMENT}/resource`)).toHaveLength(1)
    expect(harness.http.callsTo(`/lessons/${DOCUMENT}/resource/content`)).toHaveLength(1)
    // No other lesson's file was fetched on the way.
    expect(harness.http.callsTo(`/lessons/${VIDEO_DONE}/resource`)).toHaveLength(0)
  })

  it('opens a VIDEO lesson into the player', async () => {
    const { router } = await openDetails()

    await userEvent.click(await rowFor('Parameters and return values'))

    expect(router.state.location.pathname).toBe(lessonPath(VIDEO_CURRENT))
    expect(
      await screen.findByLabelText('Video lesson: Parameters and return values'),
    ).toBeInTheDocument()
  })

  it('opens a TEXT lesson into its prose', async () => {
    const { router } = await openDetails()

    await userEvent.click(await rowFor('Practice exercises'))

    expect(router.state.location.pathname).toBe(lessonPath(TEXT))
    expect(await screen.findByText(/Before you start/)).toBeInTheDocument()
  })

  it('opens a LINK lesson into its external action', async () => {
    const { router } = await openDetails()

    await userEvent.click(await rowFor('Further reading'))

    expect(router.state.location.pathname).toBe(lessonPath(LINK))
    expect(await screen.findByRole('link', { name: /open link/i })).toHaveAttribute(
      'href',
      'https://docs.python.org/3/tutorial/',
    )
  })

  it('marks the opened lesson as current in the learning sidebar', async () => {
    await openDetails()

    await userEvent.click(await rowFor('Python cheat sheet'))

    const outline = await screen.findByRole('navigation', { name: 'Course content' })
    const selected = within(outline).getByRole('link', { current: 'page' })
    expect(selected).toHaveAttribute('href', lessonPath(DOCUMENT))
    expect(selected).toHaveTextContent('Python cheat sheet')
  })

  it('is reachable and activated from the keyboard', async () => {
    const { router } = await openDetails()
    const row = await rowFor('Python cheat sheet')

    row.focus()
    expect(row).toHaveFocus()
    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(router.state.location.pathname).toBe(lessonPath(DOCUMENT)))
  })
})

describe('course details - navigation continues inside the lesson', () => {
  it('walks DOCUMENT -> next -> previous without leaving the router', async () => {
    const { router } = await openDetails()

    await userEvent.click(await rowFor('Python cheat sheet'))
    await screen.findByRole('region', { name: `Document: ${documentResource.filename}` })

    const navigation = screen.getByRole('navigation', { name: 'Lesson navigation' })
    await userEvent.click(within(navigation).getByRole('link', { name: /next lesson/i }))

    expect(router.state.location.pathname).toBe(lessonPath(VIDEO_CURRENT))
    await screen.findByLabelText('Video lesson: Parameters and return values')

    const back = screen.getByRole('navigation', { name: 'Lesson navigation' })
    await userEvent.click(within(back).getByRole('link', { name: /previous lesson/i }))

    expect(router.state.location.pathname).toBe(lessonPath(DOCUMENT))
    await screen.findByRole('region', { name: `Document: ${documentResource.filename}` })
  })

  it('walks VIDEO -> DOCUMENT -> VIDEO from the sidebar', async () => {
    const { router } = await openDetails()

    await userEvent.click(await rowFor('Introduction'))
    await screen.findByLabelText('Video lesson: Introduction')

    const outline = await screen.findByRole('navigation', { name: 'Course content' })
    await userEvent.click(within(outline).getByRole('link', { name: /Python cheat sheet/ }))

    expect(router.state.location.pathname).toBe(lessonPath(DOCUMENT))
    await screen.findByRole('region', { name: `Document: ${documentResource.filename}` })

    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Course content' })).getByRole('link', {
        name: /Introduction/,
      }),
    )

    expect(router.state.location.pathname).toBe(lessonPath(VIDEO_DONE))
    expect(await screen.findByLabelText('Video lesson: Introduction')).toBeInTheDocument()
  })

  it('never reloads the application: the course tree is read once per course', async () => {
    const { harness } = await openDetails()

    await userEvent.click(await rowFor('Python cheat sheet'))
    await screen.findByRole('region', { name: `Document: ${documentResource.filename}` })

    const navigation = screen.getByRole('navigation', { name: 'Lesson navigation' })
    await userEvent.click(within(navigation).getByRole('link', { name: /next lesson/i }))
    await screen.findByLabelText('Video lesson: Parameters and return values')

    // One read for the details page, one for the learning page. Walking
    // between lessons adds none: the effect depends on courseId, not lessonId.
    expect(harness.http.callsTo(`/courses/${COURSE_ID}/content`)).toHaveLength(2)
  })
})
