import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { AuthHarness } from '../../test/authHarness'
import {
  adminCourses,
  adminLessons,
  adminModules,
  adminVideoResource,
  documentResourceAdmin,
  lessonsByModule,
  structurePage,
} from '../../test/courseFixtures'
import type { RecordedCall } from '../../test/fetchMock'
import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

/**
 * FE-LESSON-EDITOR-01 - the lesson editor (Admin-Lesson-Editor,
 * Admin-Lesson-Types) and the course structure around it (Admin-Course-Editor,
 * Admin-Editor-States): collapsing, reordering, the row's file line, the
 * editor's header, fields per type, validation, saving, deleting, the
 * unsaved-changes guard, the preview, and the routes' refusals.
 *
 * Every request body asserted here is one the backend accepts: `PATCH` with
 * only the changed fields, `position` unique per parent, `duration_seconds`
 * for VIDEO alone.
 */

const DRAFT = adminCourses[0]!
const PUBLISHED = adminCourses[1]!
const M1 = adminModules[0]!
const M2 = adminModules[1]!
const VIDEO = adminLessons[0]!
const DOCUMENT = adminLessons[1]!
const TEXT = adminLessons[2]!
const LINK = {
  ...TEXT,
  id: 'lll44444-4444-4444-8444-444444444444',
  title: 'Style guide (external)',
  description: 'The plain-language guidelines.',
  content_type: 'LINK' as const,
  content: 'https://www.plainlanguage.example/guidelines',
  position: 2,
}

const detailPath = (courseId = DRAFT.id) => `/admin/courses/${courseId}`
const editPath = (lessonId: string, courseId = DRAFT.id) =>
  `/admin/courses/${courseId}/lessons/${lessonId}/edit`
const newPath = (moduleId = M1.id, courseId = DRAFT.id) =>
  `/admin/courses/${courseId}/modules/${moduleId}/lessons/new`

interface StubOptions {
  course?: (typeof adminCourses)[number]
  resources?: unknown[]
  lessons?: Record<string, unknown[]>
}

/** Every read the structure and the editor make. */
function stub(harness: AuthHarness, { course = DRAFT, resources = [], lessons }: StubOptions = {}) {
  const byModule = lessons ?? { [M1.id]: lessonsByModule[M1.id]!, [M2.id]: [TEXT, LINK] }
  harness.http.on(`/admin/courses/${course.id}`, { json: course })
  harness.http.on(`/admin/courses/${course.id}/modules`, { json: structurePage(adminModules) })
  harness.http.on(`/admin/courses/${course.id}/resources`, { json: resources })
  for (const module of adminModules) {
    harness.http.on(`/admin/modules/${module.id}/lessons`, {
      json: structurePage(byModule[module.id] ?? []),
    })
  }
}

const open = (
  path: string,
  beforeMount: (h: AuthHarness) => void = (h) => stub(h),
  width?: number,
) => renderRoute({ path, as: 'admin', beforeMount, ...(width ? { width } : {}) })

const editor = () => screen.findByRole('heading', { name: 'Edit lesson', level: 1 })

const patches = (harness: AuthHarness, fragment = '/admin/lessons/'): RecordedCall[] =>
  harness.http.calls.filter((call) => call.method === 'PATCH' && call.url.includes(fragment))

const bodyOf = (call: RecordedCall) => JSON.parse(call.body ?? '{}') as Record<string, unknown>

/** The body of `PUT /admin/courses/{id}/structure`. */
interface StructureBody {
  modules: { id: string; lesson_ids: string[] }[]
}

const moduleSection = async (title: string) =>
  (await screen.findByRole('heading', { name: title, level: 3 })).closest('section')!

const lessonTitles = (section: HTMLElement) =>
  within(section)
    .getAllByRole('listitem')
    .map((item) => [VIDEO, DOCUMENT, TEXT, LINK].find((l) => within(item).queryByText(l.title))?.title)

/** A toast's text, and proof it sits in the polite live region. */
async function toast(text: string) {
  const node = await screen.findByText(text)
  expect(node.closest('[role="status"]')).not.toBeNull()
  return node
}

/** A response the test releases when it chooses. */
function deferred<Value>(value: Value) {
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return { release, respond: async () => (await gate, value) }
}

// ------------------------------------------------------------- the structure

describe('course structure - collapsing a module', () => {
  it('hides and shows a module’s lessons, saying which state it is in', async () => {
    await open(detailPath())
    const section = await moduleSection(M1.title)
    const toggle = within(section).getByRole('button', { name: `Collapse module ${M1.title}` })

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const body = document.getElementById(toggle.getAttribute('aria-controls')!)!
    expect(within(body).getByText(VIDEO.title)).toBeVisible()

    await userEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAccessibleName(`Expand module ${M1.title}`)
    expect(body).not.toBeVisible()
    // The header stays: its title, its count and its actions.
    expect(within(section).getByText('2 lessons')).toBeVisible()

    // Keyboard: Enter and Space both toggle, as on any button.
    toggle.focus()
    await userEvent.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard(' ')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('collapses one module without touching the others', async () => {
    await open(detailPath())
    const first = await moduleSection(M1.title)
    const second = await moduleSection(M2.title)

    await userEvent.click(within(first).getByRole('button', { name: `Collapse module ${M1.title}` }))

    expect(within(second).getByText(TEXT.title)).toBeVisible()
  })

  it('is offered on a published course too: reading is not a write', async () => {
    await open(detailPath(PUBLISHED.id), (h) => stub(h, { course: PUBLISHED }))
    const section = await moduleSection(M1.title)

    expect(within(section).getByRole('button', { name: `Collapse module ${M1.title}` })).toBeEnabled()
  })
})

describe('course structure - what each lesson holds', () => {
  it('describes each lesson in one line, from what the server returned', async () => {
    await open(detailPath(), (h) => stub(h, { resources: [adminVideoResource, documentResourceAdmin] }))
    const first = await moduleSection(M1.title)
    const second = await moduleSection(M2.title)

    // VIDEO: its duration and file; DOCUMENT: its type and file.
    expect(within(first).getByText('02:00 · welcome.mp4')).toBeInTheDocument()
    expect(within(first).getByText('PDF · cheat-sheet.pdf')).toBeInTheDocument()
    // TEXT: counted words; LINK: the host it opens.
    expect(within(second).getByText('Text · 5 words')).toBeInTheDocument()
    expect(within(second).getByText('Link · plainlanguage.example')).toBeInTheDocument()
    expect(screen.queryByText(/uploaded yet/)).toBeNull()
  })

  it('says a stored lesson has no file yet, and offers the upload', async () => {
    await open(detailPath())
    const first = await moduleSection(M1.title)

    expect(within(first).getByText('No video uploaded yet')).toBeInTheDocument()
    expect(within(first).getByText('No document uploaded yet')).toBeInTheDocument()
    expect(
      within(first).getByRole('link', { name: `Upload resource for ${VIDEO.title}` }),
    ).toHaveAttribute('href', `${editPath(VIDEO.id)}#lesson-file`)
  })

  it('never shows a storage reference in a row', async () => {
    await open(detailPath(), (h) => stub(h, { resources: [adminVideoResource] }))
    await moduleSection(M1.title)

    expect(document.body.textContent).not.toMatch(/storage:\/\/|courses\/aaa/)
  })
})

describe('course structure - reordering with the arrows', () => {
  /**
   * FE-LESSON-REORDER-01: each press is one `PUT /admin/courses/{id}/structure`.
   *
   * The stubbed server behaves as BE-COURSE-REORDER-01 does: it applies the
   * order it was sent and answers with the stored structure, every field
   * included and each list renumbered 1..n. `answer` lets a test make it
   * answer something else, to prove the screen shows the server's word.
   */
  const ALL = [VIDEO, DOCUMENT, TEXT, LINK]
  const MODULES = [M1, M2]

  function structureServer(
    h: AuthHarness,
    { answer, hold }: { answer?: (order: StructureBody) => StructureBody; hold?: Promise<void> } = {},
  ) {
    h.http.on(`/admin/courses/${DRAFT.id}/structure`, async (call) => {
      if (hold) await hold
      const asked = JSON.parse(call.body ?? '{}') as StructureBody
      const order = answer ? answer(asked) : asked
      return {
        json: {
          course_id: DRAFT.id,
          modules: order.modules.map((item, index) => ({
            ...MODULES.find((module) => module.id === item.id)!,
            position: index + 1,
            updated_at: '2026-09-22T12:00:00Z',
            lessons: item.lesson_ids.map((id, lessonIndex) => ({
              ...ALL.find((lesson) => lesson.id === id)!,
              module_id: item.id,
              position: lessonIndex + 1,
              updated_at: '2026-09-22T12:00:00Z',
            })),
          })),
        },
      }
    })
  }

  const puts = (harness: AuthHarness) =>
    harness.http.calls.filter((call) => call.method === 'PUT' && call.url.endsWith(`/admin/courses/${DRAFT.id}/structure`))
  const anyPatch = (harness: AuthHarness) => harness.http.calls.filter((call) => call.method === 'PATCH')
  const sent = (call: RecordedCall) => JSON.parse(call.body ?? '{}') as StructureBody
  const moduleTitles = () => screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
  const rowOf = (section: HTMLElement, title: string) => within(section).getByText(title).closest('li')!
  const moduleArrow = async (title: string, direction: 'up' | 'down') =>
    within((await moduleSection(title)).querySelector('header')!).getByRole('button', {
      name: `Move module ${direction}`,
    })

  it('disables the arrows that lead nowhere', async () => {
    await open(detailPath())
    const first = await moduleSection(M1.title)
    const rows = within(first).getAllByRole('listitem')

    expect(within(rows[0]!).getByRole('button', { name: 'Move lesson up' })).toBeDisabled()
    expect(within(rows[0]!).getByRole('button', { name: 'Move lesson down' })).toBeEnabled()
    expect(within(rows[1]!).getByRole('button', { name: 'Move lesson down' })).toBeDisabled()
    const header = first.querySelector('header')!
    expect(within(header).getByRole('button', { name: 'Move module up' })).toBeDisabled()
    expect(within(header).getByRole('button', { name: 'Move module down' })).toBeEnabled()
  })

  // Rewritten for FE-LESSON-REORDER-01: it asserted three PATCH through a free
  // position; the same move is now one PUT of the whole structure.
  it('moves a lesson at once, then saves the whole order in one PUT', async () => {
    const pending = deferred(undefined)
    const { harness } = await open(detailPath(), (h) => {
      stub(h)
      structureServer(h, { hold: pending.respond() })
    })
    const first = await moduleSection(M1.title)

    await userEvent.click(within(rowOf(first, VIDEO.title)).getByRole('button', { name: 'Move lesson down' }))

    // The row has moved before the server has answered.
    expect(lessonTitles(first)).toEqual([DOCUMENT.title, VIDEO.title])
    pending.release()

    // Said to a screen reader, with the position the server stored.
    expect(await screen.findByText(`Lesson “${VIDEO.title}” moved to position 2.`)).toBeInTheDocument()
    expect(puts(harness)).toHaveLength(1)
    expect(anyPatch(harness)).toEqual([])
    expect(sent(puts(harness)[0]!)).toEqual({
      modules: [
        { id: M1.id, lesson_ids: [DOCUMENT.id, VIDEO.id] },
        { id: M2.id, lesson_ids: [TEXT.id, LINK.id] },
      ],
    })
    expect(within(first).getByText('#1').closest('li')).toHaveTextContent(DOCUMENT.title)
  })

  it('moves a lesson up, and sends exactly one PUT', async () => {
    const { harness } = await open(detailPath(), (h) => {
      stub(h)
      structureServer(h)
    })
    const second = await moduleSection(M2.title)

    await userEvent.click(within(rowOf(second, LINK.title)).getByRole('button', { name: 'Move lesson up' }))

    await waitFor(() => expect(lessonTitles(second)).toEqual([LINK.title, TEXT.title]))
    await screen.findByText(`Lesson “${LINK.title}” moved to position 1.`)
    expect(puts(harness)).toHaveLength(1)
    expect(sent(puts(harness)[0]!).modules[1]).toEqual({ id: M2.id, lesson_ids: [LINK.id, TEXT.id] })
    expect(anyPatch(harness)).toEqual([])
  })

  // Rewritten for FE-LESSON-REORDER-01: the handlers answered PATCH; the move is a PUT now.
  it('keeps focus on the arrows of the row that moved', async () => {
    await open(detailPath(), (h) => {
      stub(h)
      structureServer(h)
    })
    const first = await moduleSection(M1.title)
    const videoRow = rowOf(first, VIDEO.title)

    await userEvent.click(within(videoRow).getByRole('button', { name: 'Move lesson down' }))

    await screen.findByText(`Lesson “${VIDEO.title}” moved to position 2.`)
    // Now last, its "down" is disabled, so focus is on its "up".
    expect(within(rowOf(first, VIDEO.title)).getByRole('button', { name: 'Move lesson up' })).toHaveFocus()
  })

  // Rewritten for FE-LESSON-REORDER-01: three PATCH of `position` became one PUT.
  it('moves a module down with one PUT of every module and lesson', async () => {
    const { harness } = await open(detailPath(), (h) => {
      stub(h)
      structureServer(h)
    })

    await userEvent.click(await moduleArrow(M1.title, 'down'))

    expect(moduleTitles()).toEqual([M2.title, M1.title])
    expect(await screen.findByText(`Module “${M1.title}” moved to position 2.`)).toBeInTheDocument()
    expect(puts(harness)).toHaveLength(1)
    expect(sent(puts(harness)[0]!)).toEqual({
      modules: [
        { id: M2.id, lesson_ids: [TEXT.id, LINK.id] },
        { id: M1.id, lesson_ids: [VIDEO.id, DOCUMENT.id] },
      ],
    })
    expect(anyPatch(harness)).toEqual([])
  })

  it('moves a module up, and back, one PUT per press', async () => {
    const { harness } = await open(detailPath(), (h) => {
      stub(h)
      structureServer(h)
    })

    await userEvent.click(await moduleArrow(M2.title, 'up'))
    await screen.findByText(`Module “${M2.title}” moved to position 1.`)
    expect(moduleTitles()).toEqual([M2.title, M1.title])

    await userEvent.click(await moduleArrow(M2.title, 'down'))
    await screen.findByText(`Module “${M2.title}” moved to position 2.`)
    expect(moduleTitles()).toEqual([M1.title, M2.title])

    expect(puts(harness).map((call) => sent(call).modules.map((module) => module.id))).toEqual([
      [M2.id, M1.id],
      [M1.id, M2.id],
    ])
  })

  it('sends the whole course, every id once, and never a position', async () => {
    const { harness } = await open(detailPath(), (h) => {
      stub(h)
      structureServer(h)
    })

    await userEvent.click(await moduleArrow(M1.title, 'down'))
    await screen.findByText(`Module “${M1.title}” moved to position 2.`)

    const call = puts(harness)[0]!
    expect(call.method).toBe('PUT')
    expect(call.url).toBe(`http://localhost:8000/api/v1/admin/courses/${DRAFT.id}/structure`)
    const body = sent(call)
    expect(Object.keys(body)).toEqual(['modules'])
    for (const module of body.modules) expect(Object.keys(module).sort()).toEqual(['id', 'lesson_ids'])
    expect(call.body).not.toMatch(/position/)
    const modules = body.modules.map((module) => module.id)
    const lessons = body.modules.flatMap((module) => module.lesson_ids)
    expect([...modules].sort()).toEqual([M1.id, M2.id].sort())
    expect([...lessons].sort()).toEqual(ALL.map((lesson) => lesson.id).sort())
    expect(new Set(lessons).size).toBe(lessons.length)
  })

  it('shows the order the server stored, not the one it was asked for', async () => {
    // The server keeps VIDEO first - as if a concurrent reorganisation won.
    await open(detailPath(), (h) => {
      stub(h)
      structureServer(h, {
        answer: (asked) => ({
          modules: asked.modules.map((module) =>
            module.id === M1.id ? { ...module, lesson_ids: [VIDEO.id, DOCUMENT.id] } : module,
          ),
        }),
      })
    })
    const first = await moduleSection(M1.title)

    await userEvent.click(within(rowOf(first, VIDEO.title)).getByRole('button', { name: 'Move lesson down' }))

    expect(await screen.findByText(`Lesson “${VIDEO.title}” moved to position 1.`)).toBeInTheDocument()
    expect(lessonTitles(first)).toEqual([VIDEO.title, DOCUMENT.title])
    expect(within(first).getByText('#1').closest('li')).toHaveTextContent(VIDEO.title)
  })

  it('takes the server s positions and fields, whatever was on screen', async () => {
    // Stored with gaps (positions 1 and 5) until the server renumbers them.
    await open(detailPath(), (h) => {
      stub(h, { lessons: { [M1.id]: [VIDEO, { ...DOCUMENT, position: 5 }], [M2.id]: [TEXT, LINK] } })
      structureServer(h)
    })
    const first = await moduleSection(M1.title)
    expect(within(first).getByText('#5')).toBeInTheDocument()

    await userEvent.click(await moduleArrow(M2.title, 'up'))
    await screen.findByText(`Module “${M2.title}” moved to position 1.`)

    expect(within(await moduleSection(M1.title)).getByText('#2').closest('li')).toHaveTextContent(DOCUMENT.title)
    expect(within(await moduleSection(M1.title)).queryByText('#5')).toBeNull()
  })

  // Rewritten for FE-LESSON-REORDER-01: counted three PATCH; now there is one PUT to count.
  it('ignores a second press while a move is being written', async () => {
    const pending = deferred(undefined)
    const { harness } = await open(detailPath(), (h) => {
      stub(h)
      structureServer(h, { hold: pending.respond() })
    })
    const first = await moduleSection(M1.title)

    await userEvent.click(within(rowOf(first, VIDEO.title)).getByRole('button', { name: 'Move lesson down' }))
    await userEvent.click(within(rowOf(first, VIDEO.title)).getByRole('button', { name: 'Move lesson up' }))
    await userEvent.click(await moduleArrow(M1.title, 'down'))
    expect(puts(harness)).toHaveLength(1)
    pending.release()

    await screen.findByText(`Lesson “${VIDEO.title}” moved to position 2.`)
    expect(puts(harness)).toHaveLength(1)
    expect(lessonTitles(first)).toEqual([DOCUMENT.title, VIDEO.title])
    expect(moduleTitles()).toEqual([M1.title, M2.title])
  })

  // Rewritten for FE-LESSON-REORDER-01: the old flow undid its PATCH and re-read
  // the structure. The PUT is atomic: nothing to undo, nothing to re-read.
  it('snaps back to the order shown before, and says so, when the PUT fails', async () => {
    const { harness } = await open(detailPath(), (h) => {
      stub(h)
      h.http.on(`/admin/courses/${DRAFT.id}/structure`, { status: 500, json: { detail: 'Traceback' } })
    })
    const first = await moduleSection(M1.title)

    await userEvent.click(within(rowOf(first, VIDEO.title)).getByRole('button', { name: 'Move lesson down' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('We couldn’t save the new order')
    expect(alert).toHaveTextContent('The structure below is what the server holds. Try again in a moment.')
    expect(document.body.textContent).not.toContain('Traceback')
    await waitFor(() => expect(lessonTitles(first)).toEqual([VIDEO.title, DOCUMENT.title]))
    expect(within(first).getByText('#1').closest('li')).toHaveTextContent(VIDEO.title)
    // No repair write, and no re-read of the structure.
    expect(anyPatch(harness)).toEqual([])
    expect(harness.http.callsTo(`/admin/courses/${DRAFT.id}/modules`)).toHaveLength(1)
  })

  it.each([
    [409, 'Only DRAFT courses can be edited', 'The course is no longer a draft, so its structure can’t be changed.'],
    [
      409,
      'The submitted structure does not match the course; reload it and try again',
      'The course’s structure has changed since this page loaded. Reload the page, then try again.',
    ],
    [422, 'A lesson may appear only once', 'The structure below is what the server holds. Try again in a moment.'],
    [403, 'Admin privileges required', 'Your administrator access may have changed. Sign in again.'],
  ])('keeps the previous order and explains a %i (%s)', async (status, detail, sentence) => {
    await open(detailPath(), (h) => {
      stub(h)
      h.http.on(`/admin/courses/${DRAFT.id}/structure`, { status, json: { detail } })
    })

    await userEvent.click(await moduleArrow(M1.title, 'down'))

    expect(await screen.findByRole('alert')).toHaveTextContent(sentence)
    await waitFor(() => expect(moduleTitles()).toEqual([M1.title, M2.title]))
  })

  it('keeps the previous order when the connection drops, and lets the member retry', async () => {
    const { harness } = await open(detailPath(), (h) => {
      stub(h)
      structureServer(h)
      h.http.failNetwork(`/admin/courses/${DRAFT.id}/structure`)
    })

    await userEvent.click(await moduleArrow(M1.title, 'down'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in a moment.')
    await waitFor(() => expect(moduleTitles()).toEqual([M1.title, M2.title]))

    // The same press again: the arrows work again, and this time it lands.
    await userEvent.click(await moduleArrow(M1.title, 'down'))
    expect(await screen.findByText(`Module “${M1.title}” moved to position 2.`)).toBeInTheDocument()
    expect(moduleTitles()).toEqual([M2.title, M1.title])
    expect(puts(harness)).toHaveLength(2)
  })

  it('sends nothing, and says why, while a module s lessons could not be read', async () => {
    const { harness } = await open(detailPath(), (h) => {
      stub(h)
      structureServer(h)
      h.http.on(`/admin/modules/${M2.id}/lessons`, { status: 500, json: { detail: 'down' } })
    })

    await userEvent.click(await moduleArrow(M1.title, 'down'))

    expect(await screen.findByText(/Some lessons couldn’t be loaded, so the new order can’t be saved/)).toBeInTheDocument()
    expect(puts(harness)).toEqual([])
    expect(moduleTitles()).toEqual([M1.title, M2.title])
  })

  it('leaves adding, editing and deleting on their own endpoints', async () => {
    const { harness } = await open(detailPath(), (h) => {
      stub(h)
      structureServer(h)
    })
    await userEvent.click(await moduleArrow(M1.title, 'down'))
    await screen.findByText(`Module “${M1.title}” moved to position 2.`)

    // The structure the server answered keeps every field the rows need.
    const moved = await moduleSection(M1.title)
    expect(within(moved).getByRole('link', { name: `Edit lesson ${VIDEO.title}` })).toHaveAttribute(
      'href',
      editPath(VIDEO.id),
    )
    expect(within(moved).getByText('No video uploaded yet')).toBeInTheDocument()
    expect(harness.http.calls.filter((call) => call.method === 'PUT')).toHaveLength(1)
  })
})

describe('course structure - deleting a lesson', () => {
  it('asks with the board’s wording, removes the row, and keeps focus in the module', async () => {
    const { harness } = await open(detailPath(), (h) => {
      stub(h)
      h.http.on(`/admin/lessons/${DOCUMENT.id}`, { status: 204 })
    })
    const first = await moduleSection(M1.title)

    await userEvent.click(within(first).getByRole('button', { name: `Delete lesson ${DOCUMENT.title}` }))
    const dialog = await screen.findByRole('dialog', {
      name: `Delete the lesson “${DOCUMENT.title}”?`,
    })
    expect(
      within(dialog).getByText('This lesson will be removed from the module. This can’t be undone.'),
    ).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete lesson' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(harness.http.calls.filter((call) => call.method === 'DELETE')).toHaveLength(1)
    expect(within(first).queryByText(DOCUMENT.title)).toBeNull()
    expect(within(first).getByText('1 lesson')).toBeInTheDocument()
    await toast('Lesson deleted')
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: M1.title, level: 3 })).toHaveFocus(),
    )
  })
})

// ---------------------------------------------------------------- the editor

describe('lesson editor - header', () => {
  it('names the course, the lesson and its module, as the board does', async () => {
    await open(editPath(VIDEO.id))
    await editor()

    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByRole('link', { name: 'Courses' })).toHaveAttribute('href', '/admin/courses')
    expect(within(crumbs).getByRole('link', { name: DRAFT.title })).toHaveAttribute(
      'href',
      detailPath(),
    )
    expect(within(crumbs).getByText(VIDEO.title)).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText(`Module 1 · ${M1.title}`)).toBeInTheDocument()
    expect(screen.getByText('DRAFT')).toBeInTheDocument()
  })

  it('calls a lesson being created a new lesson, in its module', async () => {
    await open(newPath(M2.id))
    await screen.findByRole('heading', { name: 'Add lesson', level: 1 })

    expect(
      within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('New lesson'),
    ).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText(`Module 2 · ${M2.title}`)).toBeInTheDocument()
    // Positions 1 and 2 of that module are taken.
    expect(screen.getByLabelText(/^Position/)).toHaveValue(3)
    // Nothing to delete yet.
    expect(screen.queryByRole('button', { name: 'Delete lesson' })).toBeNull()
  })
})

describe('lesson editor - the fields each type has', () => {
  it.each([
    ['VIDEO', VIDEO.id, { file: 'Video file', duration: true, content: null }],
    ['DOCUMENT', DOCUMENT.id, { file: 'Document file', duration: false, content: null }],
    ['TEXT', TEXT.id, { file: null, duration: false, content: /^Content/ }],
    ['LINK', LINK.id, { file: null, duration: false, content: /^URL/ }],
  ])('shows a %s lesson the board’s field matrix', async (kind, id, expected) => {
    await open(editPath(id))
    await editor()

    // Title, description, position and the preview flag, for every type.
    expect(screen.getByLabelText(/^Title/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Description/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Position/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /mark as preview/i })).toBeInTheDocument()

    if (expected.file) expect(screen.getByLabelText(expected.file)).toBeInTheDocument()
    else expect(document.querySelector('input[type="file"]')).toBeNull()
    expect(screen.queryByLabelText(/^Duration/) !== null).toBe(expected.duration)
    if (expected.content) expect(screen.getByLabelText(expected.content)).toBeInTheDocument()
    else expect(screen.queryByLabelText(/^(Content|URL)/)).toBeNull()
    expect(screen.getByRole('radio', { name: kind.charAt(0) + kind.slice(1).toLowerCase() })).toBeChecked()
  })

  it.each([
    ['TEXT', TEXT, /^Content/, TEXT.content],
    ['LINK', LINK, /^URL/, LINK.content],
  ])('starts a %s lesson from the values the server holds', async (_k, lesson, label, content) => {
    await open(editPath(lesson.id))
    await editor()

    expect(screen.getByLabelText(/^Title/)).toHaveValue(lesson.title)
    expect(screen.getByLabelText(/^Description/)).toHaveValue(lesson.description ?? '')
    expect(screen.getByLabelText(label)).toHaveValue(content)
    expect(screen.getByLabelText(/^Position/)).toHaveValue(lesson.position)
  })

  it('takes a URL for a LINK, with the board’s hint', async () => {
    await open(editPath(LINK.id))
    await editor()

    const url = screen.getByLabelText(/^URL/)
    expect(url).toHaveAttribute('type', 'url')
    expect(url).toHaveAttribute('placeholder', 'https://')
    expect(url).toHaveAccessibleDescription('Members open this address in a new tab.')
  })

  it('changes type from the keyboard, as a radio group does', async () => {
    await open(newPath())
    await screen.findByRole('heading', { name: 'Add lesson', level: 1 })

    // One tab stop for the group: the selected option.
    const video = screen.getByRole('radio', { name: 'Video' })
    expect(video).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: 'Text' })).toHaveAttribute('tabindex', '-1')

    video.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Document' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Document' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByLabelText(/^Content/)).toBeInTheDocument()
    await userEvent.keyboard('{End}')
    expect(screen.getByLabelText(/^URL/)).toBeInTheDocument()
  })

  // G15: a VIDEO lesson with a file turned into TEXT would hide the file and
  // make the lesson impossible to delete.
  it('fixes the type of a lesson that holds a file, and frees it when the file goes', async () => {
    await open(editPath(VIDEO.id), (h) => {
      stub(h, { resources: [adminVideoResource] })
      h.http.on(`/admin/lessons/${VIDEO.id}/resource`, { status: 204 })
    })
    await editor()

    expect(screen.getByRole('radio', { name: 'Video' })).toBeChecked()
    for (const other of ['Document', 'Text', 'Link']) {
      expect(screen.getByRole('radio', { name: other })).toBeDisabled()
    }
    expect(screen.getByRole('radiogroup', { name: 'Lesson type' })).toHaveAccessibleDescription(
      'This lesson holds a file, so its type is fixed. Remove the file to change it.',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Remove welcome.mp4' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove file' }),
    )

    await waitFor(() => expect(screen.getByRole('radio', { name: 'Text' })).toBeEnabled())
  })

  it('does not offer a file until a new type has been saved', async () => {
    await open(editPath(TEXT.id))
    await editor()

    await userEvent.click(screen.getByRole('radio', { name: 'Video' }))

    expect(screen.getByText('Video file')).toBeInTheDocument()
    expect(
      screen.getByText('Save the new lesson type first. The file can be added afterwards.'),
    ).toBeInTheDocument()
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })
})

describe('lesson editor - duration as mm:ss (G16)', () => {
  it.each([
    ['8:3', 'Use the mm:ss format, for example 08:30'],
    ['8 minutes', 'Use the mm:ss format, for example 08:30'],
    ['01:60', 'Use the mm:ss format, for example 08:30'],
    ['00:00', 'Enter a duration of at least 00:01'],
  ])('refuses %s before sending, with the field focused', async (typed, message) => {
    const { harness } = await open(editPath(VIDEO.id))
    await editor()
    const duration = screen.getByLabelText(/^Duration/)

    await userEvent.clear(duration)
    await userEvent.type(duration, typed)
    await userEvent.click(screen.getByRole('button', { name: 'Save lesson' }))

    expect(await screen.findByText(message)).toBeInTheDocument()
    await waitFor(() => expect(duration).toHaveFocus())
    expect(duration).toHaveAttribute('aria-invalid', 'true')
    expect(duration).toHaveAccessibleDescription(message)
    expect(patches(harness)).toEqual([])
  })

  it('sends the whole seconds the backend stores', async () => {
    const { harness } = await open(editPath(VIDEO.id), (h) => {
      stub(h)
      h.http.on(`/admin/lessons/${VIDEO.id}`, { json: { ...VIDEO, duration_seconds: 510 } })
    })
    await editor()
    const duration = screen.getByLabelText(/^Duration/)
    expect(duration).toHaveAccessibleDescription('Format mm:ss')

    await userEvent.clear(duration)
    await userEvent.type(duration, '08:30')
    await userEvent.click(screen.getByRole('button', { name: 'Save lesson' }))

    await waitFor(() => expect(patches(harness)).toHaveLength(1))
    expect(bodyOf(patches(harness)[0]!)).toEqual({ duration_seconds: 510 })
  })

  it('clears the duration when the field is emptied', async () => {
    const { harness } = await open(editPath(VIDEO.id), (h) => {
      stub(h)
      h.http.on(`/admin/lessons/${VIDEO.id}`, { json: { ...VIDEO, duration_seconds: null } })
    })
    await editor()

    await userEvent.clear(screen.getByLabelText(/^Duration/))
    await userEvent.click(screen.getByRole('button', { name: 'Save lesson' }))

    await waitFor(() => expect(patches(harness)).toHaveLength(1))
    expect(bodyOf(patches(harness)[0]!)).toEqual({ duration_seconds: null })
  })
})

describe('lesson editor - saving', () => {
  it.each([
    ['TEXT', TEXT, /^Content/, 'Line one.\nLine two.', { content: 'Line one.\nLine two.' }],
    ['LINK', LINK, /^URL/, 'https://docs.python.org/3/', { content: 'https://docs.python.org/3/' }],
  ])('patches only the changed %s content', async (_k, lesson, label, typed, body) => {
    const { harness } = await open(editPath(lesson.id), (h) => {
      stub(h)
      h.http.on(`/admin/lessons/${lesson.id}`, { json: { ...lesson, content: typed } })
    })
    await editor()
    const field = screen.getByLabelText(label)

    await userEvent.clear(field)
    await userEvent.type(field, typed)
    await userEvent.click(screen.getByRole('button', { name: 'Save lesson' }))

    await waitFor(() => expect(patches(harness)).toHaveLength(1))
    expect(patches(harness)[0]!.url).toContain(`/api/v1/admin/lessons/${lesson.id}`)
    expect(bodyOf(patches(harness)[0]!)).toEqual(body)
  })

  it('returns to the course editor and confirms the save there', async () => {
    const { router } = await open(editPath(TEXT.id), (h) => {
      stub(h)
      h.http.on(`/admin/lessons/${TEXT.id}`, { json: { ...TEXT, title: 'Practice notes v2' } })
    })
    await editor()

    await userEvent.type(screen.getByLabelText(/^Title/), ' v2')
    await userEvent.click(screen.getByRole('button', { name: 'Save lesson' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(detailPath()))
    await toast('Lesson saved')
    await toast('“Practice notes v2” was updated.')
    // Read once: the history entry no longer carries the notice.
    await waitFor(() => expect(router.state.location.state).toBeNull())
  })

  it('creates a lesson and confirms it in the course editor', async () => {
    const created = { ...TEXT, id: 'lll55555-5555-4555-8555-555555555555', title: 'Tone checklist', module_id: M1.id, position: 3 }
    const { harness, router } = await open(newPath(), (h) => {
      stub(h)
      h.http.on(`/admin/modules/${M1.id}/lessons`, (call) =>
        call.method === 'POST'
          ? { status: 201, json: created }
          : { json: structurePage(lessonsByModule[M1.id]!) },
      )
    })
    await screen.findByRole('heading', { name: 'Add lesson', level: 1 })

    await userEvent.click(screen.getByRole('radio', { name: 'Text' }))
    await userEvent.type(screen.getByLabelText(/^Title/), 'Tone checklist')
    await userEvent.type(screen.getByLabelText(/^Content/), 'Open with the point.')
    await userEvent.click(screen.getByRole('button', { name: 'Add lesson' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(detailPath()))
    const post = harness.http.calls.find((call) => call.method === 'POST' && call.url.includes('/lessons'))!
    expect(post.url).toContain(`/admin/modules/${M1.id}/lessons`)
    expect(bodyOf(post)).toEqual({
      title: 'Tone checklist',
      content_type: 'TEXT',
      content: 'Open with the point.',
      position: 3,
      is_preview: false,
    })
    await toast('Lesson added')
    await toast(`“Tone checklist” was added to “${M1.title}”.`)
  })

  it('sends one request however often Save is pressed, and says it is saving', async () => {
    const pending = deferred({ json: { ...TEXT, title: 'Renamed' } })
    const { harness } = await open(editPath(TEXT.id), (h) => {
      stub(h)
      h.http.on(`/admin/lessons/${TEXT.id}`, () => pending.respond())
    })
    await editor()

    await userEvent.type(screen.getByLabelText(/^Title/), '!')
    await userEvent.click(screen.getByRole('button', { name: 'Save lesson' }))

    const busy = screen.getByRole('button', { name: 'Saving…' })
    expect(busy).toBeInTheDocument()
    await userEvent.click(busy)
    // Enter in a field is a submission too.
    await userEvent.type(screen.getByLabelText(/^Position/), '{Enter}')
    pending.release()

    await waitFor(() => expect(patches(harness)).toHaveLength(1))
  })

  it('sends one request for two submissions in the same tick, before any re-render', async () => {
    const pending = deferred({ json: { ...TEXT, title: 'Renamed' } })
    const { harness } = await open(editPath(TEXT.id), (h) => {
      stub(h)
      h.http.on(`/admin/lessons/${TEXT.id}`, () => pending.respond())
    })
    await editor()
    await userEvent.type(screen.getByLabelText(/^Title/), '!')

    // Nothing is disabled yet between these two: only the in-flight guard holds.
    const form = screen.getByLabelText(/^Title/).closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    pending.release()

    await waitFor(() => expect(patches(harness)).toHaveLength(1))
  })

  it('maps a 422 onto the field it names, and focuses it', async () => {
    await open(editPath(TEXT.id), (h) => {
      stub(h)
      h.http.on(`/admin/lessons/${TEXT.id}`, {
        status: 422,
        json: { detail: [{ loc: ['body', 'title'], msg: 'Title is too long', type: 'string_too_long' }] },
      })
    })
    await editor()
    const title = screen.getByLabelText(/^Title/)

    await userEvent.type(title, '!')
    await userEvent.click(screen.getByRole('button', { name: 'Save lesson' }))

    expect(await screen.findByText('Title is too long')).toBeInTheDocument()
    await waitFor(() => expect(title).toHaveFocus())
    expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Some of the details were rejected')
  })

  it('puts a position collision on the position field', async () => {
    await open(editPath(TEXT.id), (h) => {
      stub(h)
      h.http.on(`/admin/lessons/${TEXT.id}`, {
        status: 409,
        json: { detail: 'Lesson position already in use in this module' },
      })
    })
    await editor()
    const position = screen.getByLabelText(/^Position/)

    await userEvent.clear(position)
    await userEvent.type(position, '2')
    await userEvent.click(screen.getByRole('button', { name: 'Save lesson' }))

    expect(await screen.findByText('That position is already taken in this module')).toBeInTheDocument()
    await waitFor(() => expect(position).toHaveFocus())
  })

  it.each([
    [403, { detail: 'Admin role required' }, 'Your administrator access may have changed. Sign in again.'],
    [404, { detail: 'Lesson not found' }, 'This lesson or its module no longer exists. Go back to the course.'],
    [409, { detail: 'Only DRAFT courses can be edited' }, 'The course is no longer a draft, so its lessons can’t be changed.'],
    [500, { detail: 'Traceback (most recent call last)' }, 'It could not be saved. Check your connection and try again.'],
  ])('explains a %i and keeps what was typed', async (status, json, message) => {
    const { router } = await open(editPath(TEXT.id), (h) => {
      stub(h)
      h.http.on(`/admin/lessons/${TEXT.id}`, { status, json })
    })
    await editor()

    await userEvent.type(screen.getByLabelText(/^Title/), ' (draft)')
    await userEvent.click(screen.getByRole('button', { name: 'Save lesson' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByLabelText(/^Title/)).toHaveValue(`${TEXT.title} (draft)`)
    expect(screen.getByRole('button', { name: 'Save lesson' })).toBeEnabled()
    expect(router.state.location.pathname).toBe(editPath(TEXT.id))
    expect(document.body.textContent).not.toMatch(/Traceback|DRAFT courses/)
  })

  it('explains a dropped connection', async () => {
    await open(editPath(TEXT.id), (h) => {
      stub(h)
      h.http.failNetwork(`/admin/lessons/${TEXT.id}`)
    })
    await editor()

    await userEvent.type(screen.getByLabelText(/^Title/), '!')
    await userEvent.click(screen.getByRole('button', { name: 'Save lesson' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/check your connection and try again/i)
    expect(screen.getByLabelText(/^Title/)).toHaveValue(`${TEXT.title}!`)
  })
})

describe('lesson editor - deleting from the editor', () => {
  it('asks, deletes, and returns to the structure with a confirmation', async () => {
    const { harness, router } = await open(editPath(TEXT.id), (h) => {
      stub(h)
      h.http.on(`/admin/lessons/${TEXT.id}`, { status: 204 })
    })
    await editor()
    // Even with an unsaved edit, deleting is not "leaving with changes".
    await userEvent.type(screen.getByLabelText(/^Title/), '!')

    await userEvent.click(screen.getByRole('button', { name: 'Delete lesson' }))
    const dialog = await screen.findByRole('dialog', { name: `Delete the lesson “${TEXT.title}”?` })
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete lesson' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(detailPath()))
    expect(
      harness.http.calls.filter((call) => call.method === 'DELETE' && call.url.includes(TEXT.id)),
    ).toHaveLength(1)
    await toast('Lesson deleted')
    expect(screen.queryByRole('dialog', { name: 'Discard your changes?' })).toBeNull()
  })

  it('cancelling deletes nothing and returns focus', async () => {
    const { harness } = await open(editPath(TEXT.id))
    await editor()
    const remove = screen.getByRole('button', { name: 'Delete lesson' })

    await userEvent.click(remove)
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(remove).toHaveFocus()
    expect(harness.http.calls.filter((call) => call.method === 'DELETE')).toEqual([])
  })
})

describe('lesson editor - leaving with unsaved changes', () => {
  async function dirtyEditor() {
    const result = await open(editPath(TEXT.id))
    await editor()
    await userEvent.type(screen.getByLabelText(/^Title/), ' edited')
    return result
  }

  it('asks before following a link, and keeps the edit on "Keep editing"', async () => {
    const { router } = await dirtyEditor()

    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: DRAFT.title }),
    )

    const dialog = await screen.findByRole('dialog', { name: 'Discard your changes?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect(router.state.location.pathname).toBe(editPath(TEXT.id))
    expect(screen.getByLabelText(/^Title/)).toHaveValue(`${TEXT.title} edited`)
  })

  it('leaves on "Discard changes", writing nothing', async () => {
    const { router, harness } = await dirtyEditor()

    await userEvent.click(screen.getByRole('link', { name: 'Cancel' }))
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Discard your changes?' })).getByRole('button', {
        name: 'Discard changes',
      }),
    )

    await waitFor(() => expect(router.state.location.pathname).toBe(detailPath()))
    expect(patches(harness)).toEqual([])
  })

  it('holds the browser’s Back and the sidebar the same way', async () => {
    // Arrive from the course editor, so there is a page to go back to.
    const { router } = await open(detailPath())
    await userEvent.click(await screen.findByRole('link', { name: `Edit lesson ${TEXT.title}` }))
    await editor()
    await userEvent.type(screen.getByLabelText(/^Title/), ' edited')

    await router.navigate(-1)
    expect(await screen.findByRole('dialog', { name: 'Discard your changes?' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))

    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Admin' })).getByRole('link', { name: /Members/ }),
    )
    expect(await screen.findByRole('dialog', { name: 'Discard your changes?' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(editPath(TEXT.id))
  })

  it('asks the browser to confirm a reload or a closed tab only while there are changes', async () => {
    await open(editPath(TEXT.id))
    await editor()

    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    await userEvent.type(screen.getByLabelText(/^Title/), '!')
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })

  it('does not ask after a successful save', async () => {
    const { router } = await open(editPath(TEXT.id), (h) => {
      stub(h)
      h.http.on(`/admin/lessons/${TEXT.id}`, { json: TEXT })
    })
    await editor()

    await userEvent.type(screen.getByLabelText(/^Title/), '!')
    await userEvent.click(screen.getByRole('button', { name: 'Save lesson' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(detailPath()))
    expect(screen.queryByRole('dialog', { name: 'Discard your changes?' })).toBeNull()
  })
})

describe('lesson editor - preview (G07)', () => {
  const preview = () => screen.getByRole('region', { name: 'Preview' })

  it('follows the form as it is typed', async () => {
    await open(editPath(VIDEO.id))
    await editor()

    expect(within(preview()).getByText('As members will see it')).toBeInTheDocument()
    expect(within(preview()).getByText(VIDEO.title)).toBeInTheDocument()
    expect(within(preview()).getByText('Video · 02:00')).toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText(/^Title/))
    await userEvent.type(screen.getByLabelText(/^Title/), 'Structuring a message')
    await userEvent.clear(screen.getByLabelText(/^Duration/))
    await userEvent.type(screen.getByLabelText(/^Duration/), '08:30')

    expect(within(preview()).getByText('Structuring a message')).toBeInTheDocument()
    expect(within(preview()).getByText('Video · 08:30')).toBeInTheDocument()
  })

  it.each([
    ['TEXT', TEXT, 'Read this before the exercises.', null],
    ['LINK', LINK, 'plainlanguage.example', 'Open link'],
  ])('draws a %s lesson as a member meets it, without acting', async (_k, lesson, line, action) => {
    await open(editPath(lesson.id))
    await editor()

    expect(within(preview()).getByText(line)).toBeInTheDocument()
    if (action) expect(within(preview()).getByRole('button', { name: action })).toBeDisabled()
    // Nothing in the preview can be pressed.
    expect(within(preview()).queryAllByRole('link')).toEqual([])
  })

  it('names a stored document by its filename, never by where it is stored', async () => {
    await open(editPath(DOCUMENT.id), (h) => stub(h, { resources: [documentResourceAdmin] }))
    await editor()

    expect(within(preview()).getByText('Document · cheat-sheet.pdf')).toBeInTheDocument()
    expect(within(preview()).getByRole('button', { name: 'Open document' })).toBeDisabled()
    expect(document.body.textContent).not.toMatch(/storage:\/\/|documents\/1a2b|memory/)
  })
})

describe('lesson editor - routes and refusals', () => {
  it('sends a visitor to sign in', async () => {
    const { router } = await renderRoute({ path: editPath(VIDEO.id) })

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('shows a member the 403 page, never the editor', async () => {
    await renderRoute({ path: editPath(VIDEO.id), as: 'member' })

    expect(
      await screen.findByRole('heading', { name: 'You don’t have access to this page' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Edit lesson' })).toBeNull()
  })

  it.each([
    [404, 'Course not found'],
    [403, 'Access denied'],
    [500, 'We couldn’t load this course'],
  ])('explains a %i on the course', async (status, title) => {
    await open(editPath(VIDEO.id), (h) => {
      stub(h)
      h.http.on(`/admin/courses/${DRAFT.id}`, { status, json: { detail: 'no' } })
    })

    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Title/)).toBeNull()
  })

  it('does not edit a lesson under another course’s name', async () => {
    const OTHER = adminCourses[2]!
    await open(editPath(VIDEO.id, OTHER.id), (h) => {
      stub(h)
      h.http.on(`/admin/courses/${OTHER.id}`, { json: { ...OTHER, status: 'DRAFT' } })
      h.http.on(`/admin/courses/${OTHER.id}/modules`, { json: structurePage([]) })
      h.http.on(`/admin/courses/${OTHER.id}/resources`, { json: [] })
    })

    expect(await screen.findByRole('heading', { name: 'Lesson not found' })).toBeInTheDocument()
  })

  it('does not create a lesson in a module of another course', async () => {
    await open(newPath('mmm99999-9999-4999-8999-999999999999'))

    expect(await screen.findByRole('heading', { name: 'Module not found' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add lesson' })).toBeNull()
  })

  it('offers a retry when the structure cannot be read', async () => {
    const { harness } = await open(editPath(VIDEO.id), (h) => {
      stub(h)
      h.http.once(`/admin/courses/${DRAFT.id}/modules`, { status: 500, json: { detail: 'boom' } })
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await editor()).toBeInTheDocument()
    expect(harness.http.callsTo(`/admin/courses/${DRAFT.id}/modules`).length).toBe(2)
  })

  it('opens no form on a course that is no longer a draft', async () => {
    await open(editPath(VIDEO.id, PUBLISHED.id), (h) => stub(h, { course: PUBLISHED }))

    expect(await screen.findByText('This course’s structure can’t be changed')).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })
})

describe('lesson editor and structure - widths', () => {
  it.each([
    ['390', viewports.mobile],
    ['768', viewports.tablet],
    ['1440', viewports.wide],
  ])('keeps every control of the editor reachable at %spx', async (_w, width) => {
    await open(editPath(VIDEO.id), (h) => stub(h, { resources: [adminVideoResource] }), width)
    await editor()

    for (const name of ['Video', 'Document', 'Text', 'Link']) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete lesson' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save lesson' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Preview' })).toBeInTheDocument()
  })

  it.each([
    ['390', viewports.mobile, 'sheet'],
    ['768', viewports.tablet, 'center'],
    ['1440', viewports.wide, 'center'],
  ])('places the module dialog for %spx', async (_w, width, placement) => {
    await open(detailPath(), (h) => stub(h), width)
    await userEvent.click(await screen.findByRole('button', { name: 'Add module' }))

    const dialog = await screen.findByRole('dialog', { name: 'Add a module' })
    expect(dialog.parentElement).toHaveAttribute('data-placement', placement)
  })

  it('keeps the arrows, edit and delete of every row on a phone', async () => {
    await open(detailPath(), (h) => stub(h), viewports.mobile)
    const first = await moduleSection(M1.title)

    for (const row of within(first).getAllByRole('listitem')) {
      expect(within(row).getByRole('button', { name: 'Move lesson up' })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: 'Move lesson down' })).toBeInTheDocument()
      expect(within(row).getByRole('link', { name: /^Edit lesson/ })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: /^Delete lesson/ })).toBeInTheDocument()
    }
  })
})
