import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { AuthHarness } from '../../test/authHarness'
import {
  adminCourses,
  adminLessons,
  adminModules,
  lessonsByModule,
  structurePage,
} from '../../test/courseFixtures'
import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

const DRAFT = adminCourses[0]!
const PUBLISHED = adminCourses[1]!
const ARCHIVED = adminCourses[2]!
const M1 = adminModules[0]!
const M2 = adminModules[1]!
const VIDEO = adminLessons[0]!
const DOCUMENT = adminLessons[1]!
const TEXT = adminLessons[2]!

const detailPath = (id = DRAFT.id) => `/admin/courses/${id}`

/** Every read the structure screen makes, for a course of a given status. */
function stubStructure(harness: AuthHarness, course = DRAFT, modules = adminModules) {
  harness.http.on(`/admin/courses/${course.id}`, { json: course })
  harness.http.on(`/admin/courses/${course.id}/modules`, { json: structurePage(modules) })
  // The course-wide file listing: empty by default, so a structure test that
  // says nothing about files sees lessons with no file, which is the real
  // state of a lesson that has never been uploaded to.
  harness.http.on(`/admin/courses/${course.id}/resources`, { json: [] })
  for (const module of adminModules) {
    harness.http.on(`/admin/modules/${module.id}/lessons`, {
      json: structurePage(lessonsByModule[module.id] ?? []),
    })
    harness.http.on(`/admin/modules/${module.id}`, { json: module })
  }
  for (const lesson of adminLessons) {
    harness.http.on(`/admin/lessons/${lesson.id}`, { json: lesson })
  }
}

const open = (path = detailPath(), beforeMount: (h: AuthHarness) => void = (h) => stubStructure(h), width?: number) =>
  renderRoute({ path, as: 'admin', beforeMount, ...(width ? { width } : {}) })

/**
 * Any call that would *transfer* a lesson's stored file.
 *
 * Reading file metadata is FE-13's business and is asserted separately; what
 * must never happen while editing structure is a transfer - a PUT that carries
 * bytes, or a DELETE that destroys them.
 */
const transferCalls = (harness: AuthHarness) =>
  harness.http.calls.filter(
    (call) => call.url.includes('/resource') && call.method !== 'GET',
  )

/** Reads of stored file metadata. */
const resourceReads = (harness: AuthHarness) =>
  harness.http.calls.filter((call) => call.url.includes('/resource') && call.method === 'GET')

const moduleSection = async (title: string) => {
  const heading = await screen.findByRole('heading', { name: title, level: 3 })
  return heading.closest('section')!
}

/** The lesson type is a segmented control: a radio group (DS 05, G23). */
const TYPE_NAME = { VIDEO: 'Video', DOCUMENT: 'Document', TEXT: 'Text', LINK: 'Link' } as const
const chooseType = (kind: keyof typeof TYPE_NAME) =>
  userEvent.click(screen.getByRole('radio', { name: TYPE_NAME[kind] }))

describe('admin structure - reading the tree', () => {
  it('holds the layout while the structure loads', async () => {
    await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/courses/${DRAFT.id}/modules`, () => new Promise(() => ({})))
    })

    expect(await screen.findByLabelText('Loading course structure')).toBeInTheDocument()
  })

  it('renders modules and their lessons, in backend position order', async () => {
    await open()
    await screen.findByRole('heading', { name: 'Course structure' })

    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
    expect(headings).toEqual([M1.title, M2.title])

    const first = await moduleSection(M1.title)
    const titles = within(first)
      .getAllByRole('listitem')
      .map((item) => within(item).getByText(/Welcome|Cheat sheet/).textContent)
    expect(titles).toEqual([VIDEO.title, DOCUMENT.title])
  })

  it('distinguishes the four lesson kinds with the shared badge', async () => {
    await open()
    const first = await moduleSection(M1.title)
    const second = await moduleSection(M2.title)

    expect(within(first).getByText('VIDEO')).toBeInTheDocument()
    expect(within(first).getByText('DOCUMENT')).toBeInTheDocument()
    expect(within(second).getByText('TEXT')).toBeInTheDocument()
  })

  it('shows the preview flag only where the backend set it', async () => {
    await open()
    const first = await moduleSection(M1.title)

    const videoRow = within(first).getByText(VIDEO.title).closest('li')!
    const documentRow = within(first).getByText(DOCUMENT.title).closest('li')!
    expect(within(videoRow).getByText('Preview')).toBeInTheDocument()
    expect(within(documentRow).queryByText('Preview')).toBeNull()
  })

  it('summarises with counted records, not invented ones', async () => {
    await open()
    await screen.findByRole('heading', { name: 'Course structure' })

    expect(screen.getByText('2 modules · 3 lessons')).toBeInTheDocument()
  })

  it('says so when a course has no module', async () => {
    await open(detailPath(), (harness) => stubStructure(harness, DRAFT, []))

    expect(
      await screen.findByRole('heading', { name: 'This course has no modules yet', level: 3 }),
    ).toBeInTheDocument()
    expect(screen.getByText('Add a module, then add videos, documents, text or links to it.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /add module/i }).length).toBeGreaterThan(0)
  })

  it('says so when a module has no lesson', async () => {
    await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/modules/${M2.id}/lessons`, { json: structurePage([]) })
    })

    const second = await moduleSection(M2.title)
    expect(within(second).getByText('No lessons yet.')).toBeInTheDocument()
  })

  it('keeps the other modules when one module’s lessons fail', async () => {
    await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/modules/${M2.id}/lessons`, { status: 500, json: { detail: 'boom' } })
    })

    const second = await moduleSection(M2.title)
    expect(within(second).getByText(/lessons couldn’t be read/i)).toBeInTheDocument()
    expect(within(await moduleSection(M1.title)).getByText(VIDEO.title)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('boom')
  })

  it('reports a failed structure load and retries it', async () => {
    const { harness } = await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.once(`/admin/courses/${DRAFT.id}/modules`, {
        status: 500,
        json: { detail: 'Traceback: internal' },
      })
    })

    expect(await screen.findByText('We couldn’t load the course structure')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Traceback')

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { name: M1.title, level: 3 })).toBeInTheDocument()
    expect(harness.http.callsTo(`/admin/courses/${DRAFT.id}/modules`).length).toBeGreaterThanOrEqual(2)
  })
})

describe('admin structure - the draft-only gate', () => {
  it('offers the structure actions on a draft', async () => {
    await open()
    await screen.findByRole('heading', { name: M1.title, level: 3 })

    expect(screen.getByRole('button', { name: 'Add module' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Edit module ${M1.title}` })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Delete module ${M1.title}` })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /add lesson/i }).length).toBe(2)
  })

  it.each([
    ['PUBLISHED', PUBLISHED],
    ['ARCHIVED', ARCHIVED],
  ])('offers none of them on a %s course, which the backend refuses anyway', async (_s, course) => {
    await open(detailPath(course.id), (harness) => stubStructure(harness, course))
    await screen.findByRole('heading', { name: M1.title, level: 3 })

    expect(screen.queryByRole('button', { name: /add module/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /add module/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /add lesson/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^(Delete|Edit) (module|lesson)/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /^Edit lesson/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Move (module|lesson)/ })).toBeNull()
    // Reading still works: only writes are gated.
    expect(screen.getByText(VIDEO.title)).toBeInTheDocument()
  })

  // Modules are added and edited in dialogs now; the old form paths are not
  // dead ends, and they open no form on a course that refuses one.
  it.each([
    ['modules/new', PUBLISHED],
    [`modules/${M1.id}/edit`, PUBLISHED],
    ['modules/new', DRAFT],
    [`modules/${M1.id}/edit`, DRAFT],
  ])('sends the old path %s to the course editor (%#)', async (tail, course) => {
    const { router } = await open(`/admin/courses/${course.id}/${tail}`, (harness) =>
      stubStructure(harness, course),
    )

    await waitFor(() => expect(router.state.location.pathname).toBe(detailPath(course.id)))
    expect(await screen.findByRole('heading', { name: course.title, level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByLabelText(/^Module title/)).toBeNull()
  })
})

describe('admin structure - modules', () => {
  const addDialog = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Add module' }))
    return screen.findByRole('dialog', { name: 'Add a module' })
  }
  const posts = (harness: AuthHarness) =>
    harness.http.calls.filter((c) => c.method === 'POST' && c.url.includes('/modules'))
  const created = { ...M1, id: 'mmm33333-3333-4333-8333-333333333333', title: 'Module 3', description: null, position: 3 }

  it('adds a module at the first free position, from a dialog', async () => {
    const { harness } = await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/courses/${DRAFT.id}/modules`, (call) =>
        call.method === 'POST' ? { status: 201, json: created } : { json: structurePage(adminModules) },
      )
    })
    await screen.findByRole('heading', { name: M1.title, level: 3 })

    const dialog = await addDialog()
    // Admin-Editor-States: the title field, focused, with its hint.
    const title = within(dialog).getByLabelText(/^Module title/)
    expect(title).toHaveFocus()
    expect(within(dialog).getByText('Shown to members in the course outline.')).toBeInTheDocument()

    await userEvent.type(title, 'Module 3')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add module' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Positions 1 and 2 are taken, so the first free one is sent.
    expect(JSON.parse(posts(harness)[0]!.body ?? '{}')).toEqual({ title: 'Module 3', position: 3 })
    // The server's module is on screen, focused, counted and confirmed.
    const heading = await screen.findByRole('heading', { name: 'Module 3', level: 3 })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByText('3 modules · 3 lessons')).toBeInTheDocument()
    expect(within(screen.getByRole('status')).getByText('Module added')).toBeInTheDocument()
    expect(screen.getByText('“Module 3” was added to the course.')).toBeInTheDocument()
  })

  it('sends a description only when one is written', async () => {
    const { harness } = await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/courses/${DRAFT.id}/modules`, (call) =>
        call.method === 'POST' ? { status: 201, json: created } : { json: structurePage(adminModules) },
      )
    })
    const dialog = await addDialog()

    await userEvent.type(within(dialog).getByLabelText(/^Module title/), 'Module 3')
    await userEvent.type(within(dialog).getByLabelText(/^Description/), 'Why it matters.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add module' }))

    await waitFor(() => expect(posts(harness)).toHaveLength(1))
    expect(JSON.parse(posts(harness)[0]!.body ?? '{}')).toEqual({
      title: 'Module 3',
      description: 'Why it matters.',
      position: 3,
    })
  })

  it('validates before asking the server, and moves focus to the field', async () => {
    const { harness } = await open()
    const dialog = await addDialog()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Add module' }))

    expect(await within(dialog).findByText('Enter a module title')).toBeInTheDocument()
    const title = within(dialog).getByLabelText(/^Module title/)
    await waitFor(() => expect(title).toHaveFocus())
    expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(posts(harness)).toEqual([])
  })

  it('explains a position taken in the meantime, keeping what was typed', async () => {
    await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/courses/${DRAFT.id}/modules`, (call) =>
        call.method === 'POST'
          ? { status: 409, json: { detail: 'Module position already in use in this course' } }
          : { json: structurePage(adminModules) },
      )
    })
    const dialog = await addDialog()

    await userEvent.type(within(dialog).getByLabelText(/^Module title/), 'Clash')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add module' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/took that place/i)
    expect(within(dialog).getByLabelText(/^Module title/)).toHaveValue('Clash')
  })

  it('reports a dropped connection and keeps the dialog open', async () => {
    await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/courses/${DRAFT.id}/modules`, (call) =>
        call.method === 'POST' ? { status: 500, json: { detail: 'Traceback' } } : { json: structurePage(adminModules) },
      )
    })
    const dialog = await addDialog()

    await userEvent.type(within(dialog).getByLabelText(/^Module title/), 'Module 3')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add module' }))

    expect(await within(dialog).findByText(/check your connection and try again/i)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Traceback')
    expect(screen.getByRole('dialog', { name: 'Add a module' })).toBeInTheDocument()
  })

  it('sends one request however often Add module is pressed', async () => {
    let answer: (() => void) | undefined
    const { harness } = await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/courses/${DRAFT.id}/modules`, async (call) => {
        if (call.method !== 'POST') return { json: structurePage(adminModules) }
        await new Promise<void>((resolve) => {
          answer = resolve
        })
        return { status: 201, json: created }
      })
    })
    const dialog = await addDialog()
    await userEvent.type(within(dialog).getByLabelText(/^Module title/), 'Module 3')

    const submit = within(dialog).getByRole('button', { name: 'Add module' })
    await userEvent.click(submit)
    await userEvent.click(submit)
    await userEvent.type(within(dialog).getByLabelText(/^Module title/), '{Enter}')

    // Busy while the request runs: named for what it is doing.
    expect(within(dialog).getByRole('button', { name: 'Adding…' })).toBeInTheDocument()
    answer?.()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(posts(harness)).toHaveLength(1)
  })

  it('populates the edit dialog and patches only what changed', async () => {
    const { harness } = await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/modules/${M1.id}`, (call) =>
        call.method === 'PATCH' ? { json: { ...M1, title: 'Renamed' } } : { json: M1 },
      )
    })
    await screen.findByRole('heading', { name: M1.title, level: 3 })

    await userEvent.click(screen.getByRole('button', { name: `Edit module ${M1.title}` }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit module' })
    const title = within(dialog).getByLabelText(/^Module title/)
    expect(title).toHaveValue(M1.title)
    expect(within(dialog).getByLabelText(/^Description/)).toHaveValue(M1.description)
    // Nothing to save until something changes.
    expect(within(dialog).getByRole('button', { name: 'Save module' })).toBeDisabled()

    await userEvent.clear(title)
    await userEvent.type(title, 'Renamed')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save module' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const patch = harness.http.calls.find((call) => call.method === 'PATCH')!
    expect(JSON.parse(patch.body ?? '{}')).toEqual({ title: 'Renamed' })
    expect(screen.getByRole('heading', { name: 'Renamed', level: 3 })).toBeInTheDocument()
    expect(within(screen.getByRole('status')).getByText('Module saved')).toBeInTheDocument()
    // Focus returns to the control that opened the dialog.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit module Renamed' })).toHaveFocus(),
    )
  })

  it('reports an unknown module', async () => {
    await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/modules/${M1.id}`, { status: 404, json: { detail: 'Module not found' } })
    })
    await userEvent.click(await screen.findByRole('button', { name: `Edit module ${M1.title}` }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit module' })

    await userEvent.type(within(dialog).getByLabelText(/^Module title/), '!')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save module' }))

    expect(await within(dialog).findByText(/no longer exists/i)).toBeInTheDocument()
  })

  it('closes on Escape without writing, and returns focus', async () => {
    const { harness } = await open()
    const edit = await screen.findByRole('button', { name: `Edit module ${M1.title}` })
    await userEvent.click(edit)
    await screen.findByRole('dialog', { name: 'Edit module' })

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(edit).toHaveFocus()
    expect(harness.http.calls.filter((call) => call.method === 'PATCH')).toEqual([])
  })

  it('asks before deleting, then removes it from the structure', async () => {
    const { harness } = await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/modules/${M2.id}`, (call) =>
        call.method === 'DELETE' ? { status: 204 } : { json: M2 },
      )
    })
    await screen.findByRole('heading', { name: M2.title, level: 3 })

    await userEvent.click(screen.getByRole('button', { name: `Delete module ${M2.title}` }))
    const dialog = await screen.findByRole('dialog', { name: `Delete the module “${M2.title}”?` })
    // Admin-Editor-States' cascade wording, counted, and Cancel focused first.
    expect(
      within(dialog).getByText(
        'The module and the 1 lesson it contains will be removed from the course. This can’t be undone.',
      ),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete module' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(harness.http.calls.filter((call) => call.method === 'DELETE' && call.url.includes(M2.id))).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: M2.title, level: 3 })).toBeNull()
    expect(screen.getByText('1 module · 2 lessons')).toBeInTheDocument()
    expect(within(screen.getByRole('status')).getByText('Module deleted')).toBeInTheDocument()
    // Focus lands on the module that is left, not on the page body.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: M1.title, level: 3 })).toHaveFocus(),
    )
  })

  it('cancels a deletion without writing', async () => {
    const { harness } = await open()
    await screen.findByRole('heading', { name: M2.title, level: 3 })

    await userEvent.click(screen.getByRole('button', { name: `Delete module ${M2.title}` }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    )

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(harness.http.calls.filter((call) => call.method === 'DELETE')).toEqual([])
  })

  it('explains the backend’s still-referenced refusal', async () => {
    await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/modules/${M1.id}`, (call) =>
        call.method === 'DELETE'
          ? { status: 409, json: { detail: 'Module is still referenced' } }
          : { json: M1 },
      )
    })
    await screen.findByRole('heading', { name: M1.title, level: 3 })

    await userEvent.click(screen.getByRole('button', { name: `Delete module ${M1.title}` }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete module' }))

    expect(await within(dialog).findByText(/a file is still attached/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: M1.title, level: 3 })).toBeInTheDocument()
  })
})

describe('admin structure - lessons', () => {
  const newLessonPath = `/admin/courses/${DRAFT.id}/modules/${M1.id}/lessons/new`

  // FE-QA-FIX-01 (G14) - Admin-Lesson-Editor: "The UI never shows a
  // storage-provider URL or name". The placeholder is still sent, unseen.
  it('starts a lesson as a VIDEO without showing any storage reference', async () => {
    await open(newLessonPath)
    await screen.findByRole('heading', { name: 'Add lesson', level: 1 })

    expect(screen.getByRole('radiogroup', { name: 'Lesson type' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Video' })).toBeChecked()
    expect(screen.getByLabelText(/^Position/)).toHaveValue(3)
    expect(screen.queryByLabelText(/Storage reference/)).toBeNull()
    expect(screen.queryByDisplayValue(/storage:\/\//)).toBeNull()
    expect(document.body.textContent).not.toMatch(/storage:\/\/|storage reference/i)
  })

  it.each([
    ['VIDEO', 'storage://videos/pending'],
    ['DOCUMENT', 'storage://documents/pending'],
  ])('swaps the unseen placeholder when the kind becomes %s', async (kind, expected) => {
    const { harness } = await open(newLessonPath, (harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/modules/${M1.id}/lessons`, (call) =>
        call.method === 'POST'
          ? { status: 201, json: { ...VIDEO, id: 'new' } }
          : { json: structurePage(lessonsByModule[M1.id] ?? []) },
      )
    })
    await screen.findByRole('heading', { name: 'Add lesson', level: 1 })

    await userEvent.type(screen.getByLabelText(/^Title/), 'Swapped')
    // Through another kind and back, so the swap itself is exercised.
    await chooseType(kind === 'VIDEO' ? 'DOCUMENT' : 'VIDEO')
    await chooseType(kind as 'VIDEO' | 'DOCUMENT')
    expect(screen.queryByDisplayValue(/storage:\/\//)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Add lesson' }))

    await waitFor(() =>
      expect(
        harness.http.calls.some((call) => call.method === 'POST' && call.url.includes('/lessons')),
      ).toBe(true),
    )
    const post = harness.http.calls.find(
      (call) => call.method === 'POST' && call.url.includes('/lessons'),
    )!
    expect(JSON.parse(post.body ?? '{}').content).toBe(expected)
  })

  it('clears the storage reference when the kind stops being a stored one', async () => {
    await open(newLessonPath)
    await screen.findByRole('heading', { name: 'Add lesson', level: 1 })

    await chooseType('LINK')

    expect(screen.getByLabelText(/^URL/)).toHaveValue('')
    expect(screen.queryByLabelText(/^Duration/)).toBeNull()
  })

  it('offers a duration for a VIDEO and for nothing else', async () => {
    await open(newLessonPath)
    await screen.findByRole('heading', { name: 'Add lesson', level: 1 })

    expect(screen.getByLabelText(/^Duration/)).toBeInTheDocument()

    for (const kind of ['DOCUMENT', 'TEXT', 'LINK'] as const) {
      await chooseType(kind)
      expect(screen.queryByLabelText(/^Duration/)).toBeNull()
    }
  })

  it.each([
    ['VIDEO', 'storage://videos/pending', { duration_seconds: 90 }],
    ['DOCUMENT', 'storage://documents/pending', {}],
    ['TEXT', 'Read this first.', {}],
    ['LINK', 'https://docs.python.org/3/', {}],
  ])('sends the body the backend accepts for a %s lesson', async (kind, content, extra) => {
    const { harness } = await open(newLessonPath, (harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/modules/${M1.id}/lessons`, (call) =>
        call.method === 'POST'
          ? { status: 201, json: { ...VIDEO, id: 'new' } }
          : { json: structurePage(lessonsByModule[M1.id] ?? []) },
      )
    })
    await screen.findByRole('heading', { name: 'Add lesson', level: 1 })

    await userEvent.type(screen.getByLabelText(/^Title/), `${kind} lesson`)
    await chooseType(kind as keyof typeof TYPE_NAME)

    // Only TEXT and LINK have a content field; a stored kind sends its
    // placeholder without showing it.
    if (kind === 'TEXT' || kind === 'LINK') {
      const contentField = screen.getByLabelText(kind === 'TEXT' ? /^Content/ : /^URL/)
      await userEvent.clear(contentField)
      await userEvent.type(contentField, content)
    }
    // G16: typed as mm:ss, sent as the whole seconds the backend stores.
    if (kind === 'VIDEO') await userEvent.type(screen.getByLabelText(/^Duration/), '01:30')

    await userEvent.click(screen.getByRole('button', { name: 'Add lesson' }))

    await waitFor(() =>
      expect(
        harness.http.calls.some((call) => call.method === 'POST' && call.url.includes('/lessons')),
      ).toBe(true),
    )
    const post = harness.http.calls.find(
      (call) => call.method === 'POST' && call.url.includes('/lessons'),
    )!
    expect(JSON.parse(post.body ?? '{}')).toEqual({
      title: `${kind} lesson`,
      content_type: kind,
      content,
      position: 3,
      is_preview: false,
      ...extra,
    })
  })

  it('records the preview flag', async () => {
    const { harness } = await open(newLessonPath, (harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/modules/${M1.id}/lessons`, (call) =>
        call.method === 'POST'
          ? { status: 201, json: VIDEO }
          : { json: structurePage(lessonsByModule[M1.id] ?? []) },
      )
    })
    await screen.findByRole('heading', { name: 'Add lesson', level: 1 })

    await userEvent.type(screen.getByLabelText(/^Title/), 'Preview lesson')
    await userEvent.click(screen.getByRole('checkbox', { name: /mark as preview/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Add lesson' }))

    await waitFor(() =>
      expect(
        harness.http.calls.some((call) => call.method === 'POST' && call.url.includes('/lessons')),
      ).toBe(true),
    )
    const post = harness.http.calls.find(
      (call) => call.method === 'POST' && call.url.includes('/lessons'),
    )!
    expect(JSON.parse(post.body ?? '{}').is_preview).toBe(true)
  })

  it.each([
    ['LINK', 'storage://videos/x', /full http\(s\) address/i],
    ['TEXT', '   ', /must not be blank/i],
  ])('refuses %s content the backend would reject, before sending it', async (kind, content, message) => {
    const { harness } = await open(newLessonPath)
    await screen.findByRole('heading', { name: 'Add lesson', level: 1 })

    await userEvent.type(screen.getByLabelText(/^Title/), 'Bad content')
    await chooseType(kind as 'TEXT' | 'LINK')
    const field = screen.getByLabelText(kind === 'TEXT' ? /^Content/ : /^URL/)
    await userEvent.clear(field)
    if (content.trim() !== '') await userEvent.type(field, content)

    await userEvent.click(screen.getByRole('button', { name: 'Add lesson' }))

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(
      harness.http.calls.filter((call) => call.method === 'POST' && call.url.includes('/lessons')),
    ).toEqual([])
  })

  // FE-QA-FIX-01 (G36): the old "Lesson files" stub is gone; the path the
  // Data-Needs board gives the lesson editor opens the editor.
  it('sends the bare lesson path to the lesson editor, never to a stub', async () => {
    const { router } = await open(`/admin/courses/${DRAFT.id}/lessons/${VIDEO.id}`)

    expect(await screen.findByRole('heading', { name: 'Edit lesson', level: 1 })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/admin/courses/${DRAFT.id}/lessons/${VIDEO.id}/edit`)
    expect(document.body.textContent).not.toMatch(/Not implemented yet|FE-13/)
  })

  it('populates the edit form from the backend', async () => {
    await open(`/admin/courses/${DRAFT.id}/lessons/${VIDEO.id}/edit`)
    await screen.findByRole('heading', { name: 'Edit lesson', level: 1 })

    expect(screen.getByLabelText(/^Title/)).toHaveValue(VIDEO.title)
    expect(screen.getByRole('radio', { name: 'Video' })).toBeChecked()
    // The stored reference is kept, but never shown (G14).
    expect(screen.queryByLabelText(/Storage reference/)).toBeNull()
    expect(screen.queryByDisplayValue(VIDEO.content)).toBeNull()
    // 120 seconds, shown in the board's mm:ss (G16).
    expect(screen.getByLabelText(/^Duration/)).toHaveValue('02:00')
    expect(screen.getByRole('checkbox', { name: /mark as preview/i })).toBeChecked()
  })

  it('patches only the changed field, leaving the stored reference alone', async () => {
    const { harness } = await open(
      `/admin/courses/${DRAFT.id}/lessons/${VIDEO.id}/edit`,
      (harness) => {
        stubStructure(harness)
        harness.http.on(`/admin/lessons/${VIDEO.id}`, (call) =>
          call.method === 'PATCH' ? { json: { ...VIDEO, title: 'Renamed' } } : { json: VIDEO },
        )
      },
    )
    await screen.findByRole('heading', { name: 'Edit lesson', level: 1 })

    await userEvent.clear(screen.getByLabelText(/^Title/))
    await userEvent.type(screen.getByLabelText(/^Title/), 'Renamed')
    await userEvent.click(screen.getByRole('button', { name: 'Save lesson' }))

    await waitFor(() =>
      expect(harness.http.calls.some((call) => call.method === 'PATCH')).toBe(true),
    )
    const patch = harness.http.calls.find((call) => call.method === 'PATCH')!
    // `content` is absent: a rename cannot rewrite the stored reference.
    expect(JSON.parse(patch.body ?? '{}')).toEqual({ title: 'Renamed' })
  })

  it('clears the duration when a VIDEO becomes another kind', async () => {
    const { harness } = await open(
      `/admin/courses/${DRAFT.id}/lessons/${VIDEO.id}/edit`,
      (harness) => {
        stubStructure(harness)
        harness.http.on(`/admin/lessons/${VIDEO.id}`, (call) =>
          call.method === 'PATCH' ? { json: { ...VIDEO, content_type: 'TEXT' } } : { json: VIDEO },
        )
      },
    )
    await screen.findByRole('heading', { name: 'Edit lesson', level: 1 })

    await chooseType('TEXT')
    await userEvent.type(screen.getByLabelText(/^Content/), 'Now some text.')
    await userEvent.click(screen.getByRole('button', { name: 'Save lesson' }))

    await waitFor(() =>
      expect(harness.http.calls.some((call) => call.method === 'PATCH')).toBe(true),
    )
    const body = JSON.parse(
      harness.http.calls.find((call) => call.method === 'PATCH')!.body ?? '{}',
    )
    // The server validates the resulting lesson, so the duration must go.
    expect(body.duration_seconds).toBeNull()
    expect(body.content_type).toBe('TEXT')
  })

  it('keeps Save disabled while nothing has changed, and sends no empty patch', async () => {
    const { harness } = await open(`/admin/courses/${DRAFT.id}/lessons/${TEXT.id}/edit`)
    await screen.findByRole('heading', { name: 'Edit lesson', level: 1 })

    const save = screen.getByRole('button', { name: 'Save lesson' })
    expect(save).toBeDisabled()
    await userEvent.click(save)
    expect(harness.http.calls.filter((call) => call.method === 'PATCH')).toEqual([])

    // A change enables it; undoing the change disables it again.
    await userEvent.type(screen.getByLabelText(/^Title/), '!')
    expect(save).toBeEnabled()
    await userEvent.type(screen.getByLabelText(/^Title/), '{Backspace}')
    expect(save).toBeDisabled()
  })

  it('reports a lesson that is not in this course', async () => {
    await open(`/admin/courses/${DRAFT.id}/lessons/${VIDEO.id}/edit`, (harness) => {
      stubStructure(harness)
      // Deleted meanwhile, or never part of this course.
      harness.http.on(`/admin/modules/${M1.id}/lessons`, { json: structurePage([DOCUMENT]) })
    })

    expect(await screen.findByRole('heading', { name: 'Lesson not found' })).toBeInTheDocument()
    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.queryByLabelText(/^Title/)).toBeNull()
  })

  it('deletes a lesson after confirmation', async () => {
    const { harness } = await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/lessons/${DOCUMENT.id}`, (call) =>
        call.method === 'DELETE' ? { status: 204 } : { json: DOCUMENT },
      )
    })
    await screen.findByRole('heading', { name: M1.title, level: 3 })

    await userEvent.click(screen.getByRole('button', { name: `Delete lesson ${DOCUMENT.title}` }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete lesson' }),
    )

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(
      harness.http.calls.filter(
        (call) => call.method === 'DELETE' && call.url.includes(DOCUMENT.id),
      ),
    ).toHaveLength(1)
  })

  it('explains a lesson that still holds a file', async () => {
    await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/lessons/${VIDEO.id}`, (call) =>
        call.method === 'DELETE'
          ? { status: 409, json: { detail: 'Lesson is still referenced' } }
          : { json: VIDEO },
      )
    })
    await screen.findByRole('heading', { name: M1.title, level: 3 })

    await userEvent.click(screen.getByRole('button', { name: `Delete lesson ${VIDEO.title}` }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete lesson' }))

    expect(await within(dialog).findByText(/a file is still attached/i)).toBeInTheDocument()
  })
})

describe('admin structure - the resource boundary', () => {
  it('reads file metadata once for the whole course, and transfers nothing', async () => {
    const { harness } = await open()
    await screen.findByRole('heading', { name: M1.title, level: 3 })

    // One aggregate read, not one per lesson, and no file bytes either way.
    const reads = resourceReads(harness)
    expect(reads).toHaveLength(1)
    expect(reads[0]!.url).toContain(`/admin/courses/${DRAFT.id}/resources`)
    expect(transferCalls(harness)).toEqual([])
  })

  it('uploads nothing when a VIDEO lesson is created', async () => {
    const { harness } = await open(
      `/admin/courses/${DRAFT.id}/modules/${M1.id}/lessons/new`,
      (harness) => {
        stubStructure(harness)
        harness.http.on(`/admin/modules/${M1.id}/lessons`, (call) =>
          call.method === 'POST'
            ? { status: 201, json: VIDEO }
            : { json: structurePage(lessonsByModule[M1.id] ?? []) },
        )
      },
    )
    await screen.findByRole('heading', { name: 'Add lesson', level: 1 })
    // The lesson does not exist yet, so there is nothing to upload to: the
    // form offers no file input, and says the file comes once it is saved.
    expect(document.querySelector('input[type="file"]')).toBeNull()
    expect(screen.getByText('The file can be added once the lesson is saved.')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/^Title/), 'A video lesson')
    await userEvent.click(screen.getByRole('button', { name: 'Add lesson' }))

    await waitFor(() =>
      expect(
        harness.http.calls.some((call) => call.method === 'POST' && call.url.includes('/lessons')),
      ).toBe(true),
    )
    // No file body of any kind left the page.
    expect(transferCalls(harness)).toEqual([])
    expect(harness.http.calls.filter((call) => call.method === 'PUT')).toEqual([])
  })

  it('uploads nothing when a DOCUMENT lesson is created', async () => {
    const { harness } = await open(
      `/admin/courses/${DRAFT.id}/modules/${M1.id}/lessons/new`,
      (harness) => {
        stubStructure(harness)
        harness.http.on(`/admin/modules/${M1.id}/lessons`, (call) =>
          call.method === 'POST'
            ? { status: 201, json: DOCUMENT }
            : { json: structurePage(lessonsByModule[M1.id] ?? []) },
        )
      },
    )
    await screen.findByRole('heading', { name: 'Add lesson', level: 1 })

    await userEvent.type(screen.getByLabelText(/^Title/), 'A document lesson')
    await chooseType('DOCUMENT')
    await userEvent.click(screen.getByRole('button', { name: 'Add lesson' }))

    await waitFor(() =>
      expect(
        harness.http.calls.some((call) => call.method === 'POST' && call.url.includes('/lessons')),
      ).toBe(true),
    )
    expect(transferCalls(harness)).toEqual([])
    expect(harness.http.calls.filter((call) => call.method === 'PUT')).toEqual([])
  })

  it('offers no file input on the lesson form: creating a lesson never uploads', async () => {
    await open(`/admin/courses/${DRAFT.id}/modules/${M1.id}/lessons/new`, (harness) => {
      stubStructure(harness)
    })
    await screen.findByRole('heading', { name: 'Add lesson', level: 1 })

    expect(document.querySelector('input[type="file"]')).toBeNull()
  })
})

describe('admin structure - navigation and viewport', () => {
  it('walks course -> add lesson -> cancel -> course', async () => {
    const { router } = await open()
    await screen.findByRole('heading', { name: M1.title, level: 3 })

    const first = await moduleSection(M1.title)
    await userEvent.click(within(first).getByRole('link', { name: /add lesson/i }))

    expect(router.state.location.pathname).toBe(
      `/admin/courses/${DRAFT.id}/modules/${M1.id}/lessons/new`,
    )
    await screen.findByRole('heading', { name: 'Add lesson', level: 1 })

    await userEvent.click(screen.getByRole('link', { name: 'Cancel' }))

    expect(router.state.location.pathname).toBe(detailPath())
    expect(await screen.findByRole('heading', { name: M1.title, level: 3 })).toBeInTheDocument()
  })

  it('edits a module without leaving the course editor', async () => {
    const { router } = await open()
    await screen.findByRole('heading', { name: M1.title, level: 3 })

    await userEvent.click(screen.getByRole('button', { name: `Edit module ${M1.title}` }))
    expect(await screen.findByRole('dialog', { name: 'Edit module' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(detailPath())

    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('heading', { name: M1.title, level: 3 })).toBeInTheDocument()
  })

  it('keeps the structure usable on a phone', async () => {
    await open(detailPath(), (harness) => stubStructure(harness), viewports.mobile)

    expect(await screen.findByRole('heading', { name: M1.title, level: 3 })).toBeInTheDocument()
    expect(screen.getByText(VIDEO.title)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /add lesson/i }).length).toBe(2)
  })
})

// ------------------------------------------------- rejections nobody handles

/**
 * Collects the rejections Node had to report because no handler took them.
 *
 * `useCourseStructure` reads the modules and the course's files side by side
 * and only awaits the files once the modules have arrived. A promise created
 * there and never consumed would surface here - in the browser it is the
 * "Uncaught (in promise) AbortError" the developer sees on every StrictMode
 * mount - so these cases assert on the rejection itself, not on what the screen
 * happens to show.
 */
/**
 * The runner reports these on `process`. Typed here rather than by pulling in
 * ambient Node types, which this project deliberately does not carry.
 */
interface RejectionHost {
  on: (event: 'unhandledRejection', listener: (reason: unknown) => void) => void
  off: (event: 'unhandledRejection', listener: (reason: unknown) => void) => void
}

function watchRejections() {
  const seen: unknown[] = []
  const record = (reason: unknown) => seen.push(reason)
  const host = (globalThis as unknown as { process: RejectionHost }).process
  host.on('unhandledRejection', record)

  return async function settle(): Promise<unknown[]> {
    // Node reports an unhandled rejection a turn after it happens, so the check
    // has to let one pass before concluding.
    await new Promise((resolve) => setTimeout(resolve, 20))
    host.off('unhandledRejection', record)
    return seen
  }
}

const aborted = () => new DOMException('Aborted', 'AbortError')

describe('admin structure - no promise is left rejected', () => {
  it('loads the structure and leaves nothing rejected', async () => {
    const settle = watchRejections()
    await open()

    expect(await screen.findByRole('heading', { name: M1.title, level: 3 })).toBeInTheDocument()
    expect(await settle()).toEqual([])
  })

  it('reports a failed module read and leaves nothing rejected', async () => {
    const settle = watchRejections()
    await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/courses/${DRAFT.id}/modules`, { status: 500, json: { detail: 'boom' } })
    })

    expect(await screen.findByText('We couldn’t load the course structure')).toBeInTheDocument()
    expect(await settle()).toEqual([])
  })

  it('keeps the structure when the file listing fails, and leaves nothing rejected', async () => {
    const settle = watchRejections()
    await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/courses/${DRAFT.id}/resources`, { status: 500, json: { detail: 'boom' } })
    })

    // The modules and lessons were read correctly, so they are shown: only the
    // file panels say they could not be read.
    expect(await screen.findByRole('heading', { name: M1.title, level: 3 })).toBeInTheDocument()
    expect(await settle()).toEqual([])
  })

  it('leaves nothing rejected when the module read fails while the file read is aborted', async () => {
    // The reported case: the modules reject first, so the file promise - whose
    // own handler rethrows an abort - would be left with no consumer.
    const settle = watchRejections()
    await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.failNetwork(`/admin/courses/${DRAFT.id}/resources`, aborted())
      harness.http.failNetwork(`/admin/courses/${DRAFT.id}/modules`, new TypeError('Failed to fetch'))
    })

    expect(await screen.findByText('We couldn’t load the course structure')).toBeInTheDocument()
    expect(await settle()).toEqual([])
  })

  it('leaves nothing rejected when the file read is aborted after the modules loaded', async () => {
    const settle = watchRejections()
    await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.failNetwork(`/admin/courses/${DRAFT.id}/resources`, aborted())
    })

    // An abort is a cancellation, not a failure: the screen keeps waiting
    // rather than accusing the server, exactly as before this fix.
    expect(await screen.findByLabelText('Loading course structure')).toBeInTheDocument()
    expect(screen.queryByText('We couldn’t load the course structure')).toBeNull()
    expect(await settle()).toEqual([])
  })

  it('leaves nothing rejected when the module read is aborted', async () => {
    const settle = watchRejections()
    await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.failNetwork(`/admin/courses/${DRAFT.id}/modules`, aborted())
    })

    expect(await screen.findByLabelText('Loading course structure')).toBeInTheDocument()
    expect(screen.queryByText('We couldn’t load the course structure')).toBeNull()
    expect(await settle()).toEqual([])
  })

  it('leaves nothing rejected when both reads are aborted', async () => {
    const settle = watchRejections()
    await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.failNetwork(`/admin/courses/${DRAFT.id}/resources`, aborted())
      harness.http.failNetwork(`/admin/courses/${DRAFT.id}/modules`, aborted())
    })

    expect(await screen.findByLabelText('Loading course structure')).toBeInTheDocument()
    expect(await settle()).toEqual([])
  })

  it('leaves nothing rejected when a lesson read is aborted', async () => {
    const settle = watchRejections()
    await open(detailPath(), (harness) => {
      stubStructure(harness)
      harness.http.failNetwork(`/admin/modules/${M2.id}/lessons`, aborted())
    })

    expect(await screen.findByLabelText('Loading course structure')).toBeInTheDocument()
    expect(await settle()).toEqual([])
  })

  it('mounts twice under StrictMode without leaving anything rejected', async () => {
    const settle = watchRejections()
    await renderRoute({
      path: detailPath(),
      as: 'admin',
      strict: true,
      beforeMount: (harness) => stubStructure(harness),
    })

    expect(await screen.findByRole('heading', { name: M1.title, level: 3 })).toBeInTheDocument()
    expect(await settle()).toEqual([])
  })
})
