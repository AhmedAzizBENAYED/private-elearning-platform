import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { AuthHarness } from '../../test/authHarness'
import { adminCourses, adminCoursesPage, membersPage } from '../../test/courseFixtures'
import { renderRoute } from '../../test/renderRoute'

const COURSES = '/admin/courses'
const DRAFT = adminCourses[0]!
const PUBLISHED = adminCourses[1]!
const ARCHIVED = adminCourses[2]!

function stubAdmin(harness: AuthHarness) {
  harness.http.on('/admin/members', { json: membersPage() })
  harness.http.on('/admin/courses', { json: adminCoursesPage() })
}

const open = (path: string, beforeMount: (harness: AuthHarness) => void = stubAdmin) =>
  renderRoute({ path, as: 'admin', beforeMount })

/** Writes to the course API, ignoring the sign-in the harness performs. */
const writes = (harness: AuthHarness, method: string) =>
  harness.http.calls.filter(
    (call) => call.method === method && call.url.includes('/admin/courses'),
  )

const fillCreate = async (title: string, description: string) => {
  await userEvent.type(screen.getByLabelText(/^Title/), title)
  await userEvent.type(screen.getByLabelText(/^Description/), description)
}

describe('admin courses - create', () => {
  it('renders the four fields the backend accepts, and nothing else', async () => {
    await open(`${COURSES}/new`)
    await screen.findByRole('heading', { name: 'Create course', level: 1 })

    expect(screen.getByLabelText(/^Title/)).toBeRequired()
    expect(screen.getByLabelText(/^Description/)).toBeRequired()
    expect(screen.getByLabelText(/^Address/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Thumbnail URL/)).toBeInTheDocument()
    // Status is never a client input: the service sets DRAFT itself.
    expect(screen.queryByLabelText(/status/i)).toBeNull()
  })

  it('refuses to submit without the required fields, and sends nothing', async () => {
    const { harness } = await open(`${COURSES}/new`)
    await screen.findByRole('heading', { name: 'Create course', level: 1 })

    await userEvent.click(screen.getByRole('button', { name: 'Create course' }))

    expect(await screen.findByText('Enter a course title')).toBeInTheDocument()
    expect(screen.getByText('Enter a course description')).toBeInTheDocument()
    expect(writes(harness, 'POST')).toEqual([])
  })

  it('rejects a malformed address before asking the server', async () => {
    const { harness } = await open(`${COURSES}/new`)
    await screen.findByRole('heading', { name: 'Create course', level: 1 })

    await fillCreate('FE-11 Test Course', 'A course for the ticket.')
    await userEvent.type(screen.getByLabelText(/^Address/), 'Not A Slug')
    await userEvent.click(screen.getByRole('button', { name: 'Create course' }))

    expect(await screen.findByText(/lowercase letters, digits and single hyphens/i)).toBeInTheDocument()
    expect(writes(harness, 'POST')).toEqual([])
  })

  it('rejects a thumbnail that is not an http address', async () => {
    await open(`${COURSES}/new`)
    await screen.findByRole('heading', { name: 'Create course', level: 1 })

    await fillCreate('FE-11 Test Course', 'A course for the ticket.')
    await userEvent.type(screen.getByLabelText(/^Thumbnail URL/), 'javascript:alert(1)')
    await userEvent.click(screen.getByRole('button', { name: 'Create course' }))

    expect(await screen.findByText('Enter a full http(s) address')).toBeInTheDocument()
  })

  it('sends only the fields that were filled, then opens the new course', async () => {
    const created = { ...DRAFT, title: 'FE-11 Test Course' }
    const { harness, router } = await open(`${COURSES}/new`, (harness) => {
      stubAdmin(harness)
      harness.http.on('/admin/courses', (call) =>
        call.method === 'POST'
          ? { status: 201, json: created }
          : { json: adminCoursesPage() },
      )
      harness.http.on(`/admin/courses/${created.id}`, { json: created })
    })
    await screen.findByRole('heading', { name: 'Create course', level: 1 })

    await fillCreate('FE-11 Test Course', 'A course for the ticket.')
    await userEvent.click(screen.getByRole('button', { name: 'Create course' }))

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`${COURSES}/${created.id}`),
    )

    const post = writes(harness, 'POST')[0]!
    // Slug and thumbnail were left blank, so they are omitted rather than sent
    // empty: the backend generates the slug itself.
    expect(JSON.parse(post.body ?? '{}')).toEqual({
      title: 'FE-11 Test Course',
      description: 'A course for the ticket.',
    })
  })

  it('shows a taken address against the field the server named', async () => {
    await open(`${COURSES}/new`, (harness) => {
      stubAdmin(harness)
      harness.http.on('/admin/courses', (call) =>
        call.method === 'POST'
          ? { status: 409, json: { detail: 'Course slug already in use' } }
          : { json: adminCoursesPage() },
      )
    })
    await screen.findByRole('heading', { name: 'Create course', level: 1 })

    await fillCreate('FE-11 Test Course', 'A course for the ticket.')
    await userEvent.click(screen.getByRole('button', { name: 'Create course' }))

    expect(await screen.findByText(/already uses that address/i)).toBeInTheDocument()
  })

  it('maps a 422 back onto its fields', async () => {
    await open(`${COURSES}/new`, (harness) => {
      stubAdmin(harness)
      harness.http.on('/admin/courses', (call) =>
        call.method === 'POST'
          ? {
              status: 422,
              json: {
                detail: [
                  { loc: ['body', 'title'], msg: 'String should have at most 200 characters', type: 'x' },
                ],
              },
            }
          : { json: adminCoursesPage() },
      )
    })
    await screen.findByRole('heading', { name: 'Create course', level: 1 })

    await fillCreate('FE-11 Test Course', 'A course for the ticket.')
    await userEvent.click(screen.getByRole('button', { name: 'Create course' }))

    expect(await screen.findByText('String should have at most 200 characters')).toBeInTheDocument()
  })

  it('reports a server failure without repeating its words', async () => {
    await open(`${COURSES}/new`, (harness) => {
      stubAdmin(harness)
      harness.http.on('/admin/courses', (call) =>
        call.method === 'POST'
          ? { status: 500, json: { detail: 'Traceback: internal' } }
          : { json: adminCoursesPage() },
      )
    })
    await screen.findByRole('heading', { name: 'Create course', level: 1 })

    await fillCreate('FE-11 Test Course', 'A course for the ticket.')
    await userEvent.click(screen.getByRole('button', { name: 'Create course' }))

    expect(await screen.findByText(/could not be saved/i)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Traceback')
  })

  it('cancels back to the list', async () => {
    await open(`${COURSES}/new`)
    await screen.findByRole('heading', { name: 'Create course', level: 1 })

    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', COURSES)
  })
})

describe('admin courses - edit', () => {
  const editPath = `${COURSES}/${DRAFT.id}/edit`

  function stubDraft(harness: AuthHarness, course = DRAFT) {
    stubAdmin(harness)
    harness.http.on(`/admin/courses/${course.id}`, { json: course })
  }

  it('holds the layout while the course loads', async () => {
    await open(editPath, (harness) => {
      stubAdmin(harness)
      harness.http.on(`/admin/courses/${DRAFT.id}`, () => new Promise(() => ({})))
    })

    expect(await screen.findByLabelText('Loading course')).toBeInTheDocument()
  })

  it('populates the form from the backend', async () => {
    await open(editPath, (harness) => stubDraft(harness))
    await screen.findByRole('heading', { name: 'Edit course', level: 1 })

    expect(screen.getByLabelText(/^Title/)).toHaveValue(DRAFT.title)
    expect(screen.getByLabelText(/^Description/)).toHaveValue(DRAFT.description)
    expect(screen.getByLabelText(/^Address/)).toHaveValue(DRAFT.slug)
  })

  it('sends only what changed', async () => {
    const { harness, router } = await open(editPath, (harness) => {
      stubDraft(harness)
      harness.http.on(`/admin/courses/${DRAFT.id}`, (call) =>
        call.method === 'PATCH'
          ? { json: { ...DRAFT, title: 'Renamed course' } }
          : { json: DRAFT },
      )
    })
    await screen.findByRole('heading', { name: 'Edit course', level: 1 })

    await userEvent.clear(screen.getByLabelText(/^Title/))
    await userEvent.type(screen.getByLabelText(/^Title/), 'Renamed course')
    await userEvent.click(screen.getByRole('button', { name: 'Save information' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`${COURSES}/${DRAFT.id}`))

    const patch = writes(harness, 'PATCH')[0]!
    expect(JSON.parse(patch.body ?? '{}')).toEqual({ title: 'Renamed course' })
  })

  it('refuses an unchanged form rather than sending an empty patch', async () => {
    const { harness } = await open(editPath, (harness) => stubDraft(harness))
    await screen.findByRole('heading', { name: 'Edit course', level: 1 })

    await userEvent.click(screen.getByRole('button', { name: 'Save information' }))

    expect(await screen.findByText('Nothing has changed yet.')).toBeInTheDocument()
    expect(writes(harness, 'PATCH')).toEqual([])
  })

  it('validates before asking the server', async () => {
    const { harness } = await open(editPath, (harness) => stubDraft(harness))
    await screen.findByRole('heading', { name: 'Edit course', level: 1 })

    await userEvent.clear(screen.getByLabelText(/^Title/))
    await userEvent.click(screen.getByRole('button', { name: 'Save information' }))

    expect(await screen.findByText('Enter a course title')).toBeInTheDocument()
    expect(writes(harness, 'PATCH')).toEqual([])
  })

  it.each([
    ['PUBLISHED', PUBLISHED],
    ['ARCHIVED', ARCHIVED],
  ])('explains that a %s course cannot be edited, instead of showing a doomed form', async (_s, course) => {
    await open(`${COURSES}/${course.id}/edit`, (harness) => stubDraft(harness, course))

    expect(await screen.findByText('This course can’t be edited')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save information' })).toBeNull()
  })

  it('explains a 409 if the course is published between load and save', async () => {
    await open(editPath, (harness) => {
      stubDraft(harness)
      harness.http.on(`/admin/courses/${DRAFT.id}`, (call) =>
        call.method === 'PATCH'
          ? { status: 409, json: { detail: 'Only DRAFT courses can be edited' } }
          : { json: DRAFT },
      )
    })
    await screen.findByRole('heading', { name: 'Edit course', level: 1 })

    await userEvent.type(screen.getByLabelText(/^Title/), ' updated')
    await userEvent.click(screen.getByRole('button', { name: 'Save information' }))

    expect(await screen.findByText(/no longer a draft/i)).toBeInTheDocument()
  })

  it('reports an unknown course', async () => {
    await open(editPath, (harness) => {
      stubAdmin(harness)
      harness.http.on(`/admin/courses/${DRAFT.id}`, {
        status: 404,
        json: { detail: 'Course not found' },
      })
    })

    expect(await screen.findByText('Course not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to courses/i })).toHaveAttribute('href', COURSES)
  })

  it('reports a refused read', async () => {
    await open(editPath, (harness) => {
      stubAdmin(harness)
      harness.http.on(`/admin/courses/${DRAFT.id}`, {
        status: 403,
        json: { detail: 'Insufficient privileges' },
      })
    })

    expect(await screen.findByText('We couldn’t load this course')).toBeInTheDocument()
  })
})

describe('admin courses - the management page', () => {
  const detailPath = (id: string) => `${COURSES}/${id}`

  function stubCourse(harness: AuthHarness, course = DRAFT) {
    stubAdmin(harness)
    harness.http.on(`/admin/courses/${course.id}`, { json: course })
  }

  it('shows the record the backend returned', async () => {
    await open(detailPath(PUBLISHED.id), (harness) => stubCourse(harness, PUBLISHED))

    expect(
      await screen.findByRole('heading', { name: PUBLISHED.title, level: 1 }),
    ).toBeInTheDocument()
    // Admin-Course-Editor shows the course's title, description and thumbnail,
    // not its address (FE-ADMIN-COURSE-EDITOR-01); a published course's are
    // read-only.
    expect(screen.queryByText(PUBLISHED.slug)).toBeNull()
    expect(screen.getByLabelText(/^Title/)).toHaveValue(PUBLISHED.title)
    expect(screen.getByLabelText(/^Description/)).toHaveValue(PUBLISHED.description)
    expect(screen.getAllByText('PUBLISHED').length).toBeGreaterThan(0)
    expect(screen.getAllByText('02 Sep 2026').length).toBeGreaterThan(0)
  })

  it('shows the structure section, counted from records it actually read', async () => {
    // FE-12 filled this section in. The figures are counted rows, not a field
    // on `CourseResponse`, which carries no module or lesson count.
    await open(detailPath(DRAFT.id), (harness) => {
      stubCourse(harness)
      harness.http.on(`/admin/courses/${DRAFT.id}/modules`, {
        json: { items: [], total: 0, page: 1, page_size: 100 },
      })
    })
    await screen.findByRole('heading', { name: DRAFT.title, level: 1 })

    expect(screen.getByRole('heading', { name: 'Course structure' })).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { name: 'This course has no modules yet', level: 3 }),
    ).toBeInTheDocument()
  })

  it('offers no delete action, because the API has none', async () => {
    await open(detailPath(DRAFT.id), (harness) => stubCourse(harness))
    await screen.findByRole('heading', { name: DRAFT.title, level: 1 })

    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
  })

  it.each([
    ['DRAFT', DRAFT, 'Publish course', 'Archive course'],
    ['PUBLISHED', PUBLISHED, 'Archive course', 'Publish course'],
  ])('offers only the transition %s allows', async (_s, course, offered, absent) => {
    await open(detailPath(course.id), (harness) => stubCourse(harness, course))
    await screen.findByRole('heading', { name: course.title, level: 1 })

    expect(screen.getByRole('button', { name: offered })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: absent })).toBeNull()
  })

  it('offers nothing at all on an archived course', async () => {
    await open(detailPath(ARCHIVED.id), (harness) => stubCourse(harness, ARCHIVED))
    await screen.findByRole('heading', { name: ARCHIVED.title, level: 1 })

    expect(screen.queryByRole('button', { name: /^(Publish|Archive) course$/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /edit information/i })).toBeNull()
    expect(screen.getByText(/can no longer be published or edited/i)).toBeInTheDocument()
  })

  it('publishes after confirmation and shows the status the server returned', async () => {
    const { harness } = await open(detailPath(DRAFT.id), (harness) => {
      stubCourse(harness)
      harness.http.on(`/admin/courses/${DRAFT.id}/publish`, {
        json: { ...DRAFT, status: 'PUBLISHED', published_at: '2026-09-20T10:00:00Z' },
      })
    })
    await screen.findByRole('heading', { name: DRAFT.title, level: 1 })

    await userEvent.click(screen.getByRole('button', { name: 'Publish course' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: `Publish “${DRAFT.title}”?` })).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish course' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByRole('button', { name: 'Archive course' })).toBeInTheDocument()
    expect(harness.http.callsTo(`/admin/courses/${DRAFT.id}/publish`)[0]!.method).toBe('POST')
  })

  it('warns that archiving is terminal, and archives on confirmation', async () => {
    await open(detailPath(PUBLISHED.id), (harness) => {
      stubCourse(harness, PUBLISHED)
      harness.http.on(`/admin/courses/${PUBLISHED.id}/archive`, {
        json: { ...PUBLISHED, status: 'ARCHIVED', archived_at: '2026-09-20T10:00:00Z' },
      })
    })
    await screen.findByRole('heading', { name: PUBLISHED.title, level: 1 })

    await userEvent.click(screen.getByRole('button', { name: 'Archive course' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/can’t be published again/i)).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive course' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByRole('button', { name: /^(Publish|Archive) course$/ })).toBeNull()
  })

  it('cancels a transition without writing', async () => {
    const { harness } = await open(detailPath(DRAFT.id), (harness) => stubCourse(harness))
    await screen.findByRole('heading', { name: DRAFT.title, level: 1 })

    await userEvent.click(screen.getByRole('button', { name: 'Publish course' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    )

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(harness.http.callsTo(`/admin/courses/${DRAFT.id}/publish`)).toHaveLength(0)
  })

  it('keeps the dialog open and explains a refused transition', async () => {
    await open(detailPath(DRAFT.id), (harness) => {
      stubCourse(harness)
      harness.http.on(`/admin/courses/${DRAFT.id}/publish`, {
        status: 409,
        json: { detail: 'Cannot transition ARCHIVED to PUBLISHED' },
      })
    })
    await screen.findByRole('heading', { name: DRAFT.title, level: 1 })

    await userEvent.click(screen.getByRole('button', { name: 'Publish course' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish course' }))

    expect(await within(dialog).findByText(/no longer in a state that allows/i)).toBeInTheDocument()
    // The badge still says DRAFT: nothing is shown as done that was refused.
    expect(screen.getAllByText('DRAFT').length).toBeGreaterThan(0)
  })
})
