import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AuthHarness } from '../../test/authHarness'
import type { MockResponse } from '../../test/fetchMock'
import { adminCourses, adminCoursesPage, membersPage } from '../../test/courseFixtures'
import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

import type { AdminCourse } from './api'

/**
 * FE-THUMBNAIL-UPLOAD-01 - "Replace image" in the course editor's Course
 * information card, wired to `PUT /admin/courses/{id}/thumbnail`
 * (BE-THUMBNAIL-UPLOAD-01): one multipart `file` part, answered with the whole
 * course, whose `thumbnail_url` then becomes the preview.
 */

const COURSES = '/admin/courses'
const DRAFT = adminCourses[0]!
const PUBLISHED = adminCourses[1]!
const ARCHIVED = adminCourses[2]!
const EXTERNAL = 'https://cdn.example.org/thumbs/excel.jpg'
const STORED = `http://localhost:8000/api/v1/course-thumbnails/${DRAFT.id}/5b0f4d1e-0c1a-4f7e-9a51-6f1d2c3b4a59.png`
const WITH_THUMB = { ...DRAFT, thumbnail_url: EXTERNAL }
const THUMBNAIL_PATH = `${COURSES}/${DRAFT.id}/thumbnail`

type Course = AdminCourse

const png = (name = 'cover.png', size = 64) => new File([new Uint8Array(size)], name, { type: 'image/png' })

function deferred() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

/**
 * The editor's reads, a PATCH that returns the row with the patch applied,
 * and the upload, answering by default the course with the stored address.
 */
function stub(
  harness: AuthHarness,
  course: Course,
  upload: (course: Course) => MockResponse | Promise<MockResponse> = (current) => ({
    json: { ...current, thumbnail_url: STORED, updated_at: '2026-09-22T10:00:00Z' },
  }),
) {
  let current = course
  harness.http.on('/admin/members', { json: membersPage() })
  harness.http.on(COURSES, { json: adminCoursesPage() })
  harness.http.on(`${COURSES}/${course.id}`, (call) => {
    if (call.method === 'PATCH') current = { ...current, ...(JSON.parse(call.body ?? '{}') as object) }
    return { json: current }
  })
  harness.http.on(`${COURSES}/${course.id}/thumbnail`, async () => {
    const answer = await upload(current)
    if (answer.status === undefined && answer.json) current = answer.json as Course
    return answer
  })
}

async function open(course: Course = WITH_THUMB, options: { width?: number; upload?: Parameters<typeof stub>[2] } = {}) {
  const result = await renderRoute({
    path: `${COURSES}/${course.id}`,
    as: 'admin',
    beforeMount: (harness) => stub(harness, course, options.upload),
    ...(options.width ? { width: options.width } : {}),
  })
  await screen.findByRole('heading', { name: course.title, level: 1 })
  return result
}

const infoCard = () => screen.getByRole('region', { name: 'Course information' })
const thumbnail = () => within(infoCard()).getByRole('group', { name: 'Thumbnail' })
const picker = () => infoCard().querySelector<HTMLInputElement>('input[type="file"]')!
const replaceButton = () => within(thumbnail()).getByRole('button', { name: /^(Replace image|Upload image|Uploading…)$/ })
const saveButton = () => within(infoCard()).getByRole('button', { name: 'Save information' })
const titleField = () => within(infoCard()).getByLabelText(/^Title/)
const preview = () => thumbnail().querySelector('img')
const uploads = (harness: AuthHarness) => harness.http.callsTo(THUMBNAIL_PATH)
const patches = (harness: AuthHarness) =>
  harness.http.calls.filter((call) => call.method === 'PATCH' && call.url.includes(COURSES))

/** Chooses files as the picker would, without the `accept` filter a browser applies. */
function choose(...files: File[]) {
  const list = Object.assign([...files], { item: (index: number) => files[index] ?? null })
  fireEvent.change(picker(), { target: { files: list } })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('thumbnail upload - the control', () => {
  it('offers "Replace image" beside the preview, and a picker limited to what the API takes', async () => {
    await open()

    expect(replaceButton()).toHaveTextContent('Replace image')
    expect(replaceButton()).toHaveAttribute('type', 'button')
    expect(picker().accept).toBe('image/png,image/jpeg')
    expect(picker().multiple).toBe(false)
    // The input is not a second control: hidden, out of the tab order and the tree.
    expect(picker()).not.toBeVisible()
    expect(within(infoCard()).queryByLabelText(/file/i)).toBeNull()
    expect(within(thumbnail()).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Replace image',
      'Remove',
    ])
    // The preview stays decorative.
    expect(preview()).toHaveAttribute('alt', '')
    expect(preview()).not.toHaveAttribute('tabindex')
  })

  it('reads "Upload image" when the course has no thumbnail yet', async () => {
    await open(DRAFT)

    expect(replaceButton()).toHaveTextContent('Upload image')
    expect(within(thumbnail()).queryByRole('button', { name: 'Remove thumbnail' })).toBeNull()
  })

  it('opens the file picker from the button, by click and by keyboard', async () => {
    await open()
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)

    await userEvent.click(replaceButton())
    expect(click).toHaveBeenCalledTimes(1)

    await userEvent.click(titleField())
    // Title, Description, then the thumbnail's first control.
    await userEvent.tab()
    await userEvent.tab()
    expect(replaceButton()).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    expect(click).toHaveBeenCalledTimes(3)
    expect(click.mock.contexts.every((input) => input === picker())).toBe(true)
  })

  it.each([
    ['PUBLISHED', PUBLISHED],
    ['ARCHIVED', ARCHIVED],
  ])('offers no upload on a %s course, which stays read-only', async (_status, course) => {
    await open(course)

    expect(within(infoCard()).queryByRole('button', { name: /image/i })).toBeNull()
    expect(infoCard().querySelector('input[type="file"]')).toBeNull()
  })
})

describe('thumbnail upload - sending the file', () => {
  it('sends the chosen file alone, as multipart, to PUT /admin/courses/{id}/thumbnail', async () => {
    const { harness } = await open()
    const file = png()

    await userEvent.upload(picker(), file)

    await waitFor(() => expect(uploads(harness)).toHaveLength(1))
    const call = uploads(harness)[0]!
    expect(call.method).toBe('PUT')
    expect(new URL(call.url).pathname).toBe(`/api/v1${THUMBNAIL_PATH}`)
    expect([...call.formData!.keys()]).toEqual(['file'])
    expect(call.formData!.get('file')).toBe(file)
    expect(call.body).toBeUndefined()
    // The browser writes the multipart boundary; nothing claims JSON.
    expect(new Headers(call.headers).get('Content-Type')).toBeNull()
    // Never through the information PATCH.
    expect(patches(harness)).toEqual([])
  })

  it('shows the thumbnail the server stored, at once, and announces it', async () => {
    await open()

    await userEvent.upload(picker(), png())

    await waitFor(() => expect(preview()).toHaveAttribute('src', STORED))
    const toast = screen.getByText('Thumbnail uploaded').closest('[role="status"]')
    expect(toast).not.toBeNull()
    expect(toast).toHaveTextContent(`“${WITH_THUMB.title}” has a new thumbnail.`)
    expect(replaceButton()).toHaveTextContent('Replace image')
    expect(within(thumbnail()).getByRole('button', { name: 'Remove thumbnail' })).toBeEnabled()
    // Stored already: nothing to save, and nothing to warn about.
    expect(saveButton()).toBeDisabled()
    expect(within(infoCard()).queryByText('Unsaved changes')).toBeNull()
  })

  it('takes the address from the answer, not from the request', async () => {
    const elsewhere = `http://localhost:8000/api/v1/course-thumbnails/${DRAFT.id}/other.jpg`
    await open(DRAFT, { upload: (current) => ({ json: { ...current, thumbnail_url: elsewhere } }) })

    await userEvent.upload(picker(), png('mine.png'))

    await waitFor(() => expect(preview()).toHaveAttribute('src', elsewhere))
    expect(replaceButton()).toHaveTextContent('Replace image')
  })

  it('updates the Status card with the server’s modification date', async () => {
    await open(DRAFT)
    const status = screen.getByRole('region', { name: 'Status' })
    expect(within(status).getAllByText('17 Sep 2026')).toHaveLength(2)

    await userEvent.upload(picker(), png())

    expect(await within(status).findByText('22 Sep 2026')).toBeInTheDocument()
  })
})

describe('thumbnail upload - while it is being sent', () => {
  it('is busy, blocks a second upload and the actions that would race it, and leaves the fields usable', async () => {
    const gate = deferred()
    const { harness } = await open(WITH_THUMB, {
      upload: async (current) => {
        await gate.promise
        return { json: { ...current, thumbnail_url: STORED } }
      },
    })
    await userEvent.type(titleField(), ' v2')

    await userEvent.upload(picker(), png('first.png'))

    await waitFor(() => expect(replaceButton()).toHaveTextContent('Uploading…'))
    expect(replaceButton()).toHaveAttribute('aria-busy', 'true')
    expect(replaceButton()).toBeDisabled()
    expect(thumbnail().querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(within(thumbnail()).getByRole('button', { name: 'Remove thumbnail' })).toBeDisabled()
    expect(saveButton()).toBeDisabled()
    // A second file chosen meanwhile sends nothing.
    choose(png('second.png'))
    await userEvent.click(replaceButton())
    // The fields stay editable.
    await userEvent.type(titleField(), '!')
    expect(titleField()).toHaveValue(`${WITH_THUMB.title} v2!`)
    expect(uploads(harness)).toHaveLength(1)

    gate.release()

    await waitFor(() => expect(preview()).toHaveAttribute('src', STORED))
    expect(uploads(harness)).toHaveLength(1)
    expect((uploads(harness)[0]!.formData!.get('file') as File).name).toBe('first.png')
    expect(replaceButton()).toBeEnabled()
    expect(saveButton()).toBeEnabled()
  })

  it('does not ask to discard anything merely because an upload is under way', async () => {
    const gate = deferred()
    const { router } = await open(WITH_THUMB, {
      upload: async (current) => {
        await gate.promise
        return { json: { ...current, thumbnail_url: STORED } }
      },
    })

    await userEvent.upload(picker(), png())
    await waitFor(() => expect(replaceButton()).toHaveTextContent('Uploading…'))
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Courses' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(COURSES))
    expect(screen.queryByRole('dialog')).toBeNull()
    gate.release()
  })

  it('does not ask after an upload either, the image being stored already', async () => {
    const { router } = await open()

    await userEvent.upload(picker(), png())
    await waitFor(() => expect(preview()).toHaveAttribute('src', STORED))
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Courses' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(COURSES))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('thumbnail upload - refusals', () => {
  it.each([
    ['a GIF', new File([new Uint8Array(8)], 'cover.gif', { type: 'image/gif' }), 'Choose a PNG or JPEG image.'],
    ['a WebP', new File([new Uint8Array(8)], 'cover.webp', { type: 'image/webp' }), 'Choose a PNG or JPEG image.'],
    ['an SVG', new File(['<svg/>'], 'cover.svg', { type: 'image/svg+xml' }), 'Choose a PNG or JPEG image.'],
    ['a PDF', new File(['%PDF-1.7'], 'cover.pdf', { type: 'application/pdf' }), 'Choose a PNG or JPEG image.'],
    ['a file of no type', new File(['x'], 'cover', { type: '' }), 'Choose a PNG or JPEG image.'],
    ['one byte over 5 MiB', png('big.png', 5 * 1024 * 1024 + 1), 'Choose an image of 5 MB or less.'],
    ['an empty file', png('empty.png', 0), 'That file is empty. Choose another image.'],
  ])('refuses %s before sending it, as the server would', async (_name, file, message) => {
    const { harness } = await open()

    choose(file)

    const alert = await within(infoCard()).findByRole('alert')
    expect(alert).toHaveTextContent(message)
    expect(replaceButton()).toHaveAccessibleDescription(message)
    expect(uploads(harness)).toEqual([])
    expect(preview()).toHaveAttribute('src', EXTERNAL)
  })

  it('sends an image of exactly 5 MiB, the server’s own limit', async () => {
    const { harness } = await open()

    choose(png('limit.png', 5 * 1024 * 1024))

    await waitFor(() => expect(uploads(harness)).toHaveLength(1))
    expect(within(infoCard()).queryByRole('alert')).toBeNull()
  })

  it.each([
    [413, 'Thumbnail exceeds the maximum size of 5 MiB', 'Choose an image of 5 MB or less.'],
    [415, 'Thumbnail must be a PNG or JPEG image', 'Choose a PNG or JPEG image.'],
    [422, 'File content is not a valid image/png image', 'That file isn’t a valid PNG or JPEG image. Choose another one.'],
    [422, 'Uploaded file is empty', 'That file is empty. Choose another image.'],
    [422, 'Thumbnail dimensions are too large', 'That image is too large. Use one at most 16,384 pixels on a side.'],
    [409, 'Only DRAFT courses can be edited', 'This course is no longer a draft, so it can’t be edited any more.'],
    [503, 'Storage temporarily unavailable', 'The image could not be uploaded. Try again in a moment.'],
  ])('explains a %i "%s" and keeps the thumbnail shown before', async (status, detail, message) => {
    await open(WITH_THUMB, { upload: () => ({ status, json: { detail } }) })

    await userEvent.upload(picker(), png())

    expect(await within(infoCard()).findByRole('alert')).toHaveTextContent(message)
    expect(preview()).toHaveAttribute('src', EXTERNAL)
    expect(replaceButton()).toBeEnabled()
    expect(screen.queryByText('Thumbnail uploaded')).toBeNull()
  })

  it('reports a dropped connection, then clears the error when a retry succeeds', async () => {
    const { harness } = await renderRoute({
      path: `${COURSES}/${WITH_THUMB.id}`,
      as: 'admin',
      beforeMount: (h) => {
        stub(h, WITH_THUMB)
        h.http.failNetwork(THUMBNAIL_PATH)
      },
    })
    await screen.findByRole('heading', { name: WITH_THUMB.title, level: 1 })

    await userEvent.upload(picker(), png())
    expect(await within(infoCard()).findByRole('alert')).toHaveTextContent(
      'The image could not be uploaded. Check your connection and try again.',
    )
    expect(preview()).toHaveAttribute('src', EXTERNAL)

    await userEvent.upload(picker(), png())

    await waitFor(() => expect(preview()).toHaveAttribute('src', STORED))
    expect(within(infoCard()).queryByRole('alert')).toBeNull()
    expect(replaceButton()).not.toHaveAttribute('aria-describedby')
    expect(uploads(harness)).toHaveLength(2)
  })

  it('clears a local refusal once a valid image is chosen', async () => {
    await open()

    choose(new File(['x'], 'cover.gif', { type: 'image/gif' }))
    await within(infoCard()).findByRole('alert')
    await userEvent.upload(picker(), png())

    await waitFor(() => expect(preview()).toHaveAttribute('src', STORED))
    expect(within(infoCard()).queryByRole('alert')).toBeNull()
  })
})

describe('thumbnail upload - with the rest of the card', () => {
  it('keeps Title and Description edits, which still save alone afterwards', async () => {
    const { harness } = await open()
    await userEvent.clear(titleField())
    await userEvent.type(titleField(), 'Excel Dashboards')

    await userEvent.upload(picker(), png())

    await waitFor(() => expect(preview()).toHaveAttribute('src', STORED))
    expect(titleField()).toHaveValue('Excel Dashboards')
    expect(within(infoCard()).getByText('Unsaved changes')).toBeInTheDocument()

    await userEvent.click(saveButton())

    await waitFor(() => expect(patches(harness)).toHaveLength(1))
    // The uploaded address is stored already, so the PATCH does not carry it.
    expect(JSON.parse(patches(harness)[0]!.body ?? '{}')).toEqual({ title: 'Excel Dashboards' })
    expect(preview()).toHaveAttribute('src', STORED)
  })

  it('still removes the thumbnail after an upload: null on save, gone after a reload', async () => {
    const { harness, router } = await open()

    await userEvent.upload(picker(), png())
    await waitFor(() => expect(preview()).toHaveAttribute('src', STORED))
    await userEvent.click(within(thumbnail()).getByRole('button', { name: 'Remove thumbnail' }))

    expect(preview()).toBeNull()
    expect(replaceButton()).toHaveTextContent('Upload image')
    await userEvent.click(saveButton())

    await waitFor(() => expect(patches(harness)).toHaveLength(1))
    expect(JSON.parse(patches(harness)[0]!.body ?? '{}')).toEqual({ thumbnail_url: null })

    // A fresh read of the course, as a reload does.
    await router.navigate(COURSES)
    await router.navigate(`${COURSES}/${WITH_THUMB.id}`)
    await screen.findByRole('heading', { name: WITH_THUMB.title, level: 1 })
    expect(preview()).toBeNull()
    expect(replaceButton()).toHaveTextContent('Upload image')
  })

  it('keeps an uploaded thumbnail across a reload', async () => {
    const { router } = await open(DRAFT)

    await userEvent.upload(picker(), png())
    await waitFor(() => expect(preview()).toHaveAttribute('src', STORED))

    await router.navigate(COURSES)
    await router.navigate(`${COURSES}/${DRAFT.id}`)
    await screen.findByRole('heading', { name: DRAFT.title, level: 1 })
    expect(preview()).toHaveAttribute('src', STORED)
  })

  it('does not offer the upload while the information is being saved', async () => {
    const gate = deferred()
    const { harness } = await renderRoute({
      path: `${COURSES}/${WITH_THUMB.id}`,
      as: 'admin',
      beforeMount: (h) => {
        stub(h, WITH_THUMB)
        h.http.on(`${COURSES}/${WITH_THUMB.id}`, async (call) => {
          if (call.method === 'PATCH') await gate.promise
          return { json: WITH_THUMB }
        })
      },
    })
    await screen.findByRole('heading', { name: WITH_THUMB.title, level: 1 })
    await userEvent.type(titleField(), ' v2')

    await userEvent.click(saveButton())
    await waitFor(() => expect(replaceButton()).toBeDisabled())
    choose(png())
    expect(uploads(harness)).toEqual([])

    gate.release()
    await waitFor(() => expect(replaceButton()).toBeEnabled())
  })
})

describe('thumbnail upload - at each width', () => {
  it.each([
    ['1440', viewports.wide],
    ['1024', viewports.laptop],
    ['768', viewports.tablet],
    ['390', viewports.mobile],
  ])('uploads and shows the new thumbnail at %spx', async (_name, width) => {
    const { harness } = await open(WITH_THUMB, { width })

    expect(replaceButton()).toBeVisible()
    await userEvent.upload(picker(), png())

    await waitFor(() => expect(preview()).toHaveAttribute('src', STORED))
    expect(uploads(harness)).toHaveLength(1)
  })
})
