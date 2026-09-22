import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { AuthHarness } from '../../test/authHarness'
import { adminCourses, adminCoursesPage, membersPage } from '../../test/courseFixtures'
import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

/**
 * FE-ADMIN-COURSE-EDITOR-01 - the course editor as Admin-Course-Editor draws
 * it: the "Course editor" subtitle and rule, the structure beside a Status card
 * (stepper, next transition, dates) and a Course information card whose title,
 * description and thumbnail a draft saves in place with `PATCH`.
 */

const COURSES = '/admin/courses'
const DRAFT = adminCourses[0]!
const PUBLISHED = adminCourses[1]!
const ARCHIVED = adminCourses[2]!
const THUMB = 'https://cdn.example.org/thumbs/excel.jpg'
const DRAFT_WITH_THUMB = { ...DRAFT, thumbnail_url: THUMB }

type Course = (typeof adminCourses)[number] | typeof DRAFT_WITH_THUMB

interface PatchAnswer {
  status?: number
  json: unknown
}

/**
 * The course, and what its `PATCH` answers: by default the stored row with the
 * patch applied, as `CourseService.update` returns it.
 */
function stub(harness: AuthHarness, course: Course, answer?: (body: Record<string, unknown>) => PatchAnswer) {
  harness.http.on('/admin/members', { json: membersPage() })
  harness.http.on(COURSES, { json: adminCoursesPage() })
  harness.http.on(`${COURSES}/${course.id}`, (call) => {
    if (call.method !== 'PATCH') return { json: course }
    const body = JSON.parse(call.body ?? '{}') as Record<string, unknown>
    return answer ? answer(body) : { json: { ...course, ...body, updated_at: '2026-09-20T10:00:00Z' } }
  })
}

async function open(course: Course = DRAFT, options: { width?: number; answer?: Parameters<typeof stub>[2] } = {}) {
  const result = await renderRoute({
    path: `${COURSES}/${course.id}`,
    as: 'admin',
    beforeMount: (harness) => stub(harness, course, options.answer),
    ...(options.width ? { width: options.width } : {}),
  })
  await screen.findByRole('heading', { name: course.title, level: 1 })
  return result
}

const patches = (harness: AuthHarness) =>
  harness.http.calls.filter((call) => call.method === 'PATCH' && call.url.includes(COURSES))

const infoCard = () => screen.getByRole('region', { name: 'Course information' })
const statusCard = () => screen.getByRole('region', { name: 'Status' })
const titleField = () => within(infoCard()).getByLabelText(/^Title/)
const descriptionField = () => within(infoCard()).getByLabelText(/^Description/)
const saveButton = () => within(infoCard()).getByRole('button', { name: 'Save information' })

describe('course editor - what the board draws', () => {
  it('heads the page with the title, the editor subtitle and the status', async () => {
    await open()

    expect(screen.getByText('Course editor · build the structure, then publish.')).toBeInTheDocument()
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByRole('link', { name: 'Courses' })).toHaveAttribute('href', COURSES)
    expect(within(crumbs).getByText(DRAFT.title)).toHaveAttribute('aria-current', 'page')
    // The description is the form's to show now, not the subtitle's.
    expect(screen.queryByText(DRAFT.description, { selector: 'p' })).toBeNull()
  })

  it('draws the Status card: stepper, the next step, and the dates', async () => {
    await open()
    const card = statusCard()

    const steps = within(within(card).getByRole('list', { name: 'Course lifecycle' })).getAllByRole('listitem')
    expect(steps.map((step) => step.textContent)).toEqual(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
    expect(steps[0]).toHaveAttribute('aria-current', 'step')
    expect(steps[1]).not.toHaveAttribute('aria-current')
    expect(
      within(card).getByText(
        'Draft courses are not visible to members. Publishing makes the course available in the catalogue.',
      ),
    ).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Publish course' })).toBeInTheDocument()
    expect(within(card).getByText('Created')).toBeInTheDocument()
    expect(within(card).getByText('Last modified')).toBeInTheDocument()
    // The fixture was created and last modified the same day.
    expect(within(card).getAllByText('17 Sep 2026')).toHaveLength(2)
  })

  // FE-QA-FINAL-01 (G30): "Course published", named after the course.
  it('confirms a publication from the editor with a toast', async () => {
    await renderRoute({
      path: `${COURSES}/${DRAFT.id}`,
      as: 'admin',
      beforeMount: (harness) => {
        stub(harness, DRAFT)
        harness.http.on(`${COURSES}/${DRAFT.id}/publish`, { json: { ...DRAFT, status: 'PUBLISHED' } })
      },
    })
    await screen.findByRole('heading', { name: DRAFT.title, level: 1 })

    await userEvent.click(within(statusCard()).getByRole('button', { name: 'Publish course' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Publish course' }),
    )

    expect(await screen.findByText('Course published')).toBeInTheDocument()
    expect(screen.getByText(`“${DRAFT.title}” is now visible to members.`).closest('[role="status"]')).not.toBeNull()
  })

  it('moves the stepper on for a published course, and offers Archive', async () => {
    await open(PUBLISHED)
    const card = statusCard()

    const steps = within(card).getAllByRole('listitem')
    expect(steps[1]).toHaveAttribute('aria-current', 'step')
    expect(within(card).getByRole('button', { name: 'Archive course' })).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Publish course' })).toBeNull()
    expect(within(card).getByText('Published')).toBeInTheDocument()
  })

  it('fills the Course information card from the server, with only the board’s fields', async () => {
    await open(DRAFT_WITH_THUMB)
    const card = infoCard()

    expect(titleField()).toHaveValue(DRAFT.title)
    expect(titleField()).toBeRequired()
    expect(descriptionField()).toHaveValue(DRAFT.description)
    const thumbnail = within(card).getByRole('group', { name: 'Thumbnail' })
    expect(thumbnail.querySelector('img')).toHaveAttribute('src', THUMB)
    expect(within(thumbnail).getByRole('button', { name: 'Remove thumbnail' })).toBeInTheDocument()
    // Nothing the board does not draw. "Replace image" is the board's, and the
    // API now takes it (FE-THUMBNAIL-UPLOAD-01, see AdminThumbnailUpload.test).
    expect(within(card).queryByLabelText(/^Address/)).toBeNull()
    expect(within(card).queryByLabelText(/Thumbnail URL/)).toBeNull()
    expect(within(thumbnail).getByRole('button', { name: 'Replace image' })).toBeInTheDocument()
    expect(within(card).getAllByRole('textbox')).toHaveLength(2)
    // Nothing to save until something changes.
    expect(saveButton()).toBeDisabled()
  })

  it('shows the navy tile when the course has no thumbnail, and no Remove', async () => {
    await open(DRAFT)

    const thumbnail = within(infoCard()).getByRole('group', { name: 'Thumbnail' })
    expect(thumbnail.querySelector('img')).toBeNull()
    expect(within(thumbnail).queryByRole('button', { name: 'Remove thumbnail' })).toBeNull()
  })

  it('falls back to the tile when the image fails to load', async () => {
    await open(DRAFT_WITH_THUMB)

    const thumbnail = within(infoCard()).getByRole('group', { name: 'Thumbnail' })
    fireEvent.error(thumbnail.querySelector('img')!)
    expect(thumbnail.querySelector('img')).toBeNull()
  })

  it.each([
    ['PUBLISHED', PUBLISHED],
    ['ARCHIVED', ARCHIVED],
  ])('shows a %s course’s information read-only, with nothing to save', async (_status, course) => {
    await open(course)
    const card = infoCard()

    expect(within(card).getByLabelText(/^Title/)).toHaveAttribute('readonly')
    expect(within(card).getByLabelText(/^Title/)).toHaveValue(course.title)
    expect(within(card).getByLabelText(/^Description/)).toHaveAttribute('readonly')
    expect(within(card).queryByRole('button', { name: 'Save information' })).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Remove thumbnail' })).toBeNull()
    expect(within(card).getByText(/Only draft courses can be edited/)).toBeInTheDocument()
  })
})

describe('course editor - saving the information', () => {
  it('refuses an empty title or description before asking the server', async () => {
    const { harness } = await open()

    await userEvent.clear(titleField())
    await userEvent.clear(descriptionField())
    await userEvent.click(saveButton())

    expect(await screen.findByText('Enter a course title')).toBeInTheDocument()
    expect(screen.getByText('Enter a course description')).toBeInTheDocument()
    expect(titleField()).toHaveFocus()
    expect(patches(harness)).toEqual([])
  })

  it('sends only what changed, trimmed - never the address or the thumbnail untouched', async () => {
    const { harness } = await open()

    await userEvent.clear(titleField())
    await userEvent.type(titleField(), '  Excel Dashboards  ')
    await userEvent.type(descriptionField(), ' Now with pivots.')
    await userEvent.click(saveButton())

    await waitFor(() => expect(patches(harness)).toHaveLength(1))
    expect(patches(harness)[0]!.url).toMatch(new RegExp(`${COURSES}/${DRAFT.id}$`))
    expect(JSON.parse(patches(harness)[0]!.body ?? '{}')).toEqual({
      title: 'Excel Dashboards',
      description: `${DRAFT.description} Now with pivots.`,
    })
  })

  it('clears the thumbnail with Remove, sent as null on save', async () => {
    const { harness } = await open(DRAFT_WITH_THUMB)
    const thumbnail = within(infoCard()).getByRole('group', { name: 'Thumbnail' })

    await userEvent.click(within(thumbnail).getByRole('button', { name: 'Remove thumbnail' }))
    // Not yet sent: the card saves on "Save information", as the board draws.
    expect(thumbnail.querySelector('img')).toBeNull()
    expect(patches(harness)).toEqual([])
    expect(within(infoCard()).getByText('Unsaved changes')).toBeInTheDocument()

    await userEvent.click(saveButton())

    await waitFor(() => expect(patches(harness)).toHaveLength(1))
    expect(JSON.parse(patches(harness)[0]!.body ?? '{}')).toEqual({ thumbnail_url: null })
  })

  it('stays in the editor on success, showing what the server stored', async () => {
    const { router } = await open()

    await userEvent.clear(titleField())
    await userEvent.type(titleField(), 'Excel Dashboards')
    await userEvent.click(saveButton())

    expect(await screen.findByRole('heading', { name: 'Excel Dashboards', level: 1 })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`${COURSES}/${DRAFT.id}`)
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('Excel Dashboards')).toBeInTheDocument()
    expect(within(screen.getByRole('status')).getByText('Course information saved')).toBeInTheDocument()
    expect(titleField()).toHaveValue('Excel Dashboards')
    expect(saveButton()).toBeDisabled()
    expect(within(infoCard()).queryByText('Unsaved changes')).toBeNull()
    // The Status card carries the server's new modification date.
    expect(within(statusCard()).getByText('20 Sep 2026')).toBeInTheDocument()
  })

  it('explains a course published elsewhere since it was loaded', async () => {
    await open(DRAFT, {
      answer: () => ({ status: 409, json: { detail: 'Only DRAFT courses can be edited' } }),
    })

    await userEvent.type(titleField(), ' v2')
    await userEvent.click(saveButton())

    expect(await within(infoCard()).findByRole('alert')).toHaveTextContent(
      'This course is no longer a draft, so it can’t be edited any more.',
    )
    // Nothing is shown as saved.
    expect(screen.getByRole('heading', { name: DRAFT.title, level: 1 })).toBeInTheDocument()
    expect(titleField()).toHaveValue(`${DRAFT.title} v2`)
  })

  it('puts a 422 back on the field the server named', async () => {
    await open(DRAFT, {
      answer: () => ({
        status: 422,
        json: {
          detail: [{ loc: ['body', 'title'], msg: 'String should have at most 200 characters', type: 'string_too_long' }],
        },
      }),
    })

    await userEvent.type(titleField(), ' v2')
    await userEvent.click(saveButton())

    expect(await within(infoCard()).findByRole('alert')).toHaveTextContent(
      'Some of the details were rejected. Check the fields below.',
    )
    await waitFor(() => expect(titleField()).toHaveAttribute('aria-invalid', 'true'))
    expect(titleField()).toHaveFocus()
  })

  it('reports a dropped connection without claiming the save', async () => {
    const { harness } = await open()
    harness.http.failNetwork(`${COURSES}/${DRAFT.id}`)

    await userEvent.type(titleField(), ' v2')
    await userEvent.click(saveButton())

    expect(await within(infoCard()).findByRole('alert')).toHaveTextContent(
      'The course could not be saved. Check your connection and try again.',
    )
    expect(screen.queryByText('Course information saved')).toBeNull()
  })
})

describe('course editor - unsaved changes', () => {
  it('asks before leaving with unsaved changes, and keeps them on "Keep editing"', async () => {
    const { router } = await open()

    await userEvent.type(titleField(), ' v2')
    expect(within(infoCard()).getByText('Unsaved changes')).toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Courses' }))

    const dialog = await screen.findByRole('dialog', { name: 'Discard your changes?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))

    expect(router.state.location.pathname).toBe(`${COURSES}/${DRAFT.id}`)
    expect(titleField()).toHaveValue(`${DRAFT.title} v2`)
  })

  it('leaves on "Discard changes", sending nothing', async () => {
    const { router, harness } = await open()

    await userEvent.type(titleField(), ' v2')
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Courses' }))
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Discard your changes?' })).getByRole('button', {
        name: 'Discard changes',
      }),
    )

    await waitFor(() => expect(router.state.location.pathname).toBe(COURSES))
    expect(patches(harness)).toEqual([])
  })

  it('lets an untouched editor go without asking', async () => {
    const { router } = await open()

    await userEvent.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Courses' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(COURSES))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('course editor - at each width', () => {
  it.each([
    ['1440', viewports.wide],
    ['768', viewports.tablet],
    ['390', viewports.mobile],
  ])('keeps the structure, Status and Course information at %spx, and saves', async (_name, width) => {
    const { harness } = await open(DRAFT, { width })

    const structure = screen.getByRole('region', { name: 'Course structure' })
    // Reading order: the structure first, then the side cards, as the board.
    expect(structure.compareDocumentPosition(statusCard()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(statusCard().compareDocumentPosition(infoCard()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await userEvent.type(titleField(), ' v2')
    await userEvent.click(saveButton())
    await waitFor(() => expect(patches(harness)).toHaveLength(1))
  })
})
