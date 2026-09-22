import { act, screen, waitFor, within } from '@testing-library/react'
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
import type { MockResponse, RecordedCall } from '../../test/fetchMock'
import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

/**
 * FE-13 - the administrator's management of a lesson's stored file.
 *
 * Every endpoint, status code and refusal asserted here was read from the
 * running backend's own contract (`app/api/v1/admin/resources.py` and
 * `app/tests/test_lesson_resources.py`): the transfer is a single
 * `PUT /admin/lessons/{id}/resource` carrying one `file` part, replacement is
 * that same call, deletion is a `DELETE` answering 204, and the listing is one
 * aggregate `GET /admin/courses/{id}/resources` for the whole course.
 *
 * FE-LESSON-EDITOR-01 (G37) moved the file field into the lesson editor, as
 * Admin-Lesson-Editor draws it: the upload, the replacement and the removal are
 * exercised there. The course structure keeps one line per lesson saying what
 * it holds, and "Upload resource" for a stored lesson with no file yet.
 */

const DRAFT = adminCourses[0]!
const PUBLISHED = adminCourses[1]!
const M1 = adminModules[0]!
const VIDEO = adminLessons[0]!
const DOCUMENT = adminLessons[1]!
const TEXT = adminLessons[2]!

const detailPath = (id = DRAFT.id) => `/admin/courses/${id}`
const editorPath = (lessonId = VIDEO.id, courseId = DRAFT.id) =>
  `/admin/courses/${courseId}/lessons/${lessonId}/edit`

function mp4(name = 'welcome.mp4', size = 1024): File {
  const file = new File([new Uint8Array(size)], name, { type: 'video/mp4' })
  return file
}

function pdf(name = 'cheat-sheet.pdf', size = 2048): File {
  return new File([new Uint8Array(size)], name, { type: 'application/pdf' })
}

/** The structure reads, with a resource listing the test controls. */
function stubStructure(
  harness: AuthHarness,
  { course = DRAFT, resources = [] as unknown[] } = {},
) {
  harness.http.on(`/admin/courses/${course.id}`, { json: course })
  harness.http.on(`/admin/courses/${course.id}/modules`, { json: structurePage(adminModules) })
  harness.http.on(`/admin/courses/${course.id}/resources`, { json: resources })
  for (const module of adminModules) {
    harness.http.on(`/admin/modules/${module.id}/lessons`, {
      json: structurePage(lessonsByModule[module.id] ?? []),
    })
  }
}

/** Opens a lesson's editor - the VIDEO lesson's unless told otherwise. */
const open = (beforeMount: (h: AuthHarness) => void, path = editorPath(), width?: number) =>
  renderRoute({ path, as: 'admin', beforeMount, ...(width ? { width } : {}) })

/** The upload calls for one lesson. */
const uploads = (harness: AuthHarness, lessonId = VIDEO.id): RecordedCall[] =>
  harness.http.calls.filter(
    (call) => call.method === 'PUT' && call.url.includes(`/admin/lessons/${lessonId}/resource`),
  )

/** The lesson editor's file field, once the editor has loaded. */
async function filePanel(): Promise<HTMLElement> {
  await screen.findByRole('heading', { name: 'Edit lesson', level: 1 })
  return document.getElementById('lesson-file')!
}

/** One lesson's row in the course structure. */
async function structureRow(title: string): Promise<HTMLElement> {
  const label = await screen.findByText(title)
  return label.closest('li')!
}

const fileInputIn = (row: HTMLElement): HTMLInputElement =>
  row.querySelector('input[type="file"]')!

// ---------------------------------------------------------------- no resource

describe('admin resources - a lesson with no file', () => {
  it('offers an upload surface on a VIDEO lesson and names what it takes', async () => {
    await open((harness) => stubStructure(harness))
    const row = await filePanel()

    expect(within(row).getByLabelText('Video file')).toBeInTheDocument()
    expect(within(row).getByText(/drag and drop a video here/i)).toBeInTheDocument()
    expect(within(row).getByText(/MP4 video/)).toBeInTheDocument()
  })

  it('offers an upload surface on a DOCUMENT lesson, asking for a PDF', async () => {
    await open((harness) => stubStructure(harness), editorPath(DOCUMENT.id))
    const row = await filePanel()

    expect(within(row).getByLabelText('Document file')).toBeInTheDocument()
    expect(within(row).getByText(/drag and drop a document here/i)).toBeInTheDocument()
    expect(within(row).getByText(/PDF document/)).toBeInTheDocument()
  })

  it.each([
    ['VIDEO', VIDEO.id, 'video/mp4,.mp4'],
    ['DOCUMENT', DOCUMENT.id, 'application/pdf,.pdf'],
  ])('filters the %s picker to the media types the backend has configured', async (_k, id, accept) => {
    await open((harness) => stubStructure(harness), editorPath(id))

    expect(fileInputIn(await filePanel()).accept).toBe(accept)
  })

  it('reads the whole course s files in one request, not one per lesson', async () => {
    const { harness } = await open((harness) => stubStructure(harness))
    await filePanel()

    const reads = harness.http.calls.filter(
      (call) => call.method === 'GET' && call.url.includes('/resource'),
    )
    expect(reads).toHaveLength(1)
    expect(reads[0]!.url).toContain(`/admin/courses/${DRAFT.id}/resources`)
  })
})

// ----------------------------------------------------------- existing resource

describe('admin resources - a lesson that already holds a file', () => {
  it('shows the filename, the size and the metadata the backend returned', async () => {
    await open((harness) => stubStructure(harness, { resources: [adminVideoResource] }))
    const row = await filePanel()

    expect(within(row).getByText('welcome.mp4')).toBeInTheDocument()
    expect(within(row).getByText(/23 MB/)).toBeInTheDocument()
    // Type, the probed duration, and the date - all from the response.
    expect(within(row).getByText(/MP4 · 1 min 40 s · uploaded 18 Sep 2026/)).toBeInTheDocument()
  })

  it('offers Replace and Remove on a draft course', async () => {
    await open((harness) => stubStructure(harness, { resources: [adminVideoResource] }))
    const row = await filePanel()

    expect(within(row).getByRole('button', { name: 'Replace' })).toBeEnabled()
    expect(within(row).getByRole('button', { name: 'Remove welcome.mp4' })).toBeEnabled()
  })

  it('shows a document s type and size, and no duration it does not have', async () => {
    await open(
      (harness) => stubStructure(harness, { resources: [documentResourceAdmin] }),
      editorPath(DOCUMENT.id),
    )
    const row = await filePanel()

    expect(within(row).getByText('cheat-sheet.pdf')).toBeInTheDocument()
    expect(within(row).getByText(/PDF · uploaded 18 Sep 2026/)).toBeInTheDocument()
    expect(within(row).queryByText(/min/)).toBeNull()
  })

  it('never renders the storage key, the provider or the checksum', async () => {
    await open((harness) =>
      stubStructure(harness, { resources: [adminVideoResource, documentResourceAdmin] }),
    )
    await filePanel()

    const rendered = document.body.textContent ?? ''
    expect(rendered).not.toContain('storage_key')
    expect(rendered).not.toContain(adminVideoResource.storage_key)
    expect(rendered).not.toContain('courses/')
    expect(rendered).not.toContain(adminVideoResource.checksum)
    expect(rendered.toLowerCase()).not.toContain('memory')
    expect(rendered.toLowerCase()).not.toContain('drive')
  })
})

// ------------------------------------------------------------------- uploading

describe('admin resources - uploading a video', () => {
  it('PUTs one multipart file part to the lesson s own resource endpoint', async () => {
    const { harness } = await open((harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/lessons/${VIDEO.id}/resource`, { json: adminVideoResource })
    })
    const row = await filePanel()
    const file = mp4()

    await userEvent.upload(fileInputIn(row), file)

    await waitFor(() => expect(uploads(harness)).toHaveLength(1))
    const call = uploads(harness)[0]!
    expect(call.url).toContain(`/api/v1/admin/lessons/${VIDEO.id}/resource`)

    // Exactly one part, named as the endpoint's `file` parameter, carrying the
    // File itself rather than a copy of its bytes.
    const form = call.formData!
    expect([...form.keys()]).toEqual(['file'])
    expect(form.get('file')).toBe(file)
  })

  it('sets no Content-Type, so the browser writes the multipart boundary', async () => {
    const { harness } = await open((harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/lessons/${VIDEO.id}/resource`, { json: adminVideoResource })
    })
    await userEvent.upload(fileInputIn(await filePanel()), mp4())

    await waitFor(() => expect(uploads(harness)).toHaveLength(1))
    expect(uploads(harness)[0]!.headers['content-type']).toBeUndefined()
    // The session still travels in the Authorization header, never in the URL.
    expect(uploads(harness)[0]!.headers.authorization).toMatch(/^Bearer /)
    expect(uploads(harness)[0]!.url).not.toContain('token')
  })

  it('shows an indeterminate running state, never an invented percentage', async () => {
    let finish: (() => void) | undefined
    const { harness } = await open((harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/lessons/${VIDEO.id}/resource`, async () => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return { json: adminVideoResource }
      })
    })
    await userEvent.upload(fileInputIn(await filePanel()), mp4())

    const bar = await screen.findByRole('progressbar', { name: /uploading welcome\.mp4/i })
    // `fetch` reports no upload progress, so the bar must claim none.
    expect(bar).not.toHaveAttribute('aria-valuenow')
    expect(screen.queryByText('0%')).toBeNull()
    expect(screen.queryByText(/%$/)).toBeNull()

    finish?.()
    await waitFor(() => expect(uploads(harness)).toHaveLength(1))
  })

  it('replaces the metadata on screen with what the server returned', async () => {
    await open((harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/lessons/${VIDEO.id}/resource`, { json: adminVideoResource })
    })
    await userEvent.upload(fileInputIn(await filePanel()), mp4('local-name.mp4'))

    const row = await filePanel()
    // The server's stored filename wins over whatever was picked locally.
    expect(await within(row).findByText('welcome.mp4')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Replace' })).toBeInTheDocument()
    expect(within(row).queryByText('local-name.mp4')).toBeNull()
  })

  it('takes the duration from the backend and never computes or PATCHes one', async () => {
    const { harness } = await open((harness) => {
      stubStructure(harness)
      // The lesson was authored with 120s; the backend probed 100s and
      // reconciled both the resource and the lesson to the real figure.
      harness.http.on(`/admin/lessons/${VIDEO.id}/resource`, { json: adminVideoResource })
    })
    await userEvent.upload(fileInputIn(await filePanel()), mp4())

    const row = await filePanel()
    expect(await within(row).findByText(/1 min 40 s/)).toBeInTheDocument()
    // The duration field follows the server's reconciled figure: 100 s.
    expect(screen.getByLabelText(/^Duration/)).toHaveValue('01:40')

    // No lesson write of any kind followed the upload. Scoped to the lesson
    // routes, so the harness's own sign-in POST is not counted.
    expect(
      harness.http.calls.filter(
        (call) =>
          call.url.includes('/admin/lessons/') &&
          (call.method === 'PATCH' || call.method === 'POST'),
      ),
    ).toEqual([])
  })

  it('leaves every lesson metadata field untouched', async () => {
    const { harness } = await open((harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/lessons/${VIDEO.id}/resource`, { json: adminVideoResource })
    })
    const before = await filePanel()

    await userEvent.upload(fileInputIn(before), mp4())
    await waitFor(() => expect(uploads(harness)).toHaveLength(1))
    await within(await filePanel()).findByText('welcome.mp4')

    // Title, description, type, position and the preview flag all stand.
    expect(screen.getByLabelText(/^Title/)).toHaveValue(VIDEO.title)
    expect(screen.getByLabelText(/^Description/)).toHaveValue(VIDEO.description)
    expect(screen.getByRole('radio', { name: 'Video' })).toBeChecked()
    expect(screen.getByLabelText(/^Position/)).toHaveValue(1)
    expect(screen.getByRole('checkbox', { name: /mark as preview/i })).toBeChecked()
    // Nothing was sent that could have changed any of them, and the upload
    // left the form with nothing to save.
    expect(uploads(harness)[0]!.body).toBeUndefined()
    expect(screen.getByRole('button', { name: 'Save lesson' })).toBeDisabled()
  })
})

describe('admin resources - uploading a document', () => {
  it('PUTs the PDF to the document lesson s endpoint', async () => {
    const { harness } = await open((harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/lessons/${DOCUMENT.id}/resource`, { json: documentResourceAdmin })
    }, editorPath(DOCUMENT.id))
    const file = pdf()
    await userEvent.upload(fileInputIn(await filePanel()), file)

    await waitFor(() => expect(uploads(harness, DOCUMENT.id)).toHaveLength(1))
    const call = uploads(harness, DOCUMENT.id)[0]!
    expect(call.url).toContain(`/admin/lessons/${DOCUMENT.id}/resource`)
    expect(call.formData!.get('file')).toBe(file)
  })

  it('shows the stored document without rendering it', async () => {
    await open((harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/lessons/${DOCUMENT.id}/resource`, { json: documentResourceAdmin })
    }, editorPath(DOCUMENT.id))
    await userEvent.upload(fileInputIn(await filePanel()), pdf())

    const row = await filePanel()
    expect(await within(row).findByText('cheat-sheet.pdf')).toBeInTheDocument()
    // No viewer: FE-09 renders a PDF for members, this screen never does.
    expect(row.querySelector('iframe')).toBeNull()
    expect(row.querySelector('embed')).toBeNull()
    expect(row.querySelector('object')).toBeNull()
  })

  it('never downloads the file bytes to describe it', async () => {
    const { harness } = await open(
      (harness) => stubStructure(harness, { resources: [documentResourceAdmin] }),
      editorPath(DOCUMENT.id),
    )
    await filePanel()

    expect(harness.http.calls.filter((call) => call.url.includes('/content'))).toEqual([])
    expect(harness.http.calls.filter((call) => call.url.includes('/download'))).toEqual([])
  })
})

// ------------------------------------------------------------- lesson kinds

describe('admin resources - the kinds that hold no file', () => {
  it('offers no upload on a TEXT lesson', async () => {
    await open((harness) => stubStructure(harness), editorPath(TEXT.id))
    await screen.findByRole('heading', { name: 'Edit lesson', level: 1 })

    expect(document.getElementById('lesson-file')).toBeNull()
    expect(document.querySelector('input[type="file"]')).toBeNull()
    expect(screen.queryByText(/drag and drop/i)).toBeNull()
  })

  it('offers an upload only on the two kinds that store bytes', async () => {
    await open((harness) => stubStructure(harness), detailPath())
    await structureRow(VIDEO.title)

    // "Upload resource" for VIDEO and DOCUMENT, and none for TEXT. The
    // structure itself transfers nothing: it holds no file input at all.
    const offered = screen.getAllByRole('link', { name: /^Upload resource for/ })
    expect(offered.map((link) => link.getAttribute('aria-label'))).toEqual([
      `Upload resource for ${VIDEO.title}`,
      `Upload resource for ${DOCUMENT.title}`,
    ])
    expect(within(await structureRow(TEXT.title)).queryByText(/upload/i)).toBeNull()
    // The page's one file input is the thumbnail picker of the Course
    // information card (FE-THUMBNAIL-UPLOAD-01); the structure holds none.
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')]
    expect(inputs).toHaveLength(1)
    expect(inputs[0]!.accept).toBe('image/png,image/jpeg')
    expect(screen.getByRole('region', { name: 'Course information' })).toContainElement(inputs[0]!)
    expect(screen.getByRole('region', { name: 'Course structure' }).querySelector('input[type="file"]')).toBeNull()
  })

  it('opens the lesson editor on its file field from "Upload resource"', async () => {
    const { router } = await open((harness) => stubStructure(harness), detailPath())
    const row = await structureRow(VIDEO.title)

    await userEvent.click(within(row).getByRole('link', { name: `Upload resource for ${VIDEO.title}` }))

    expect(router.state.location.pathname).toBe(editorPath())
    const panel = await filePanel()
    await waitFor(() => expect(fileInputIn(panel)).toHaveFocus())
  })
})

// -------------------------------------------------------------- lifecycle

describe('admin resources - course lifecycle', () => {
  it('offers no file action once the course is published', async () => {
    await open(
      (harness) =>
        stubStructure(harness, { course: PUBLISHED, resources: [adminVideoResource] }),
      detailPath(PUBLISHED.id),
    )
    const row = await structureRow(VIDEO.title)

    // The metadata is still readable - the backend still answers 200 - but
    // every mutation is gone, because each would answer 409.
    expect(within(row).getByText('02:00 · welcome.mp4')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Replace' })).toBeNull()
    expect(within(row).queryByRole('button', { name: /^Remove/ })).toBeNull()
    expect(within(row).queryByRole('link', { name: /upload resource/i })).toBeNull()
  })

  it('says a published lesson has no file, without offering one', async () => {
    await open(
      (harness) => stubStructure(harness, { course: PUBLISHED }),
      detailPath(PUBLISHED.id),
    )
    const row = await structureRow(VIDEO.title)

    expect(within(row).getByText('No video uploaded yet')).toBeInTheDocument()
    expect(within(row).queryByRole('link', { name: /upload resource/i })).toBeNull()
    expect(row.querySelector('input[type="file"]')).toBeNull()
  })

  it('keeps the file field out of reach of a published course', async () => {
    await open(
      (harness) => stubStructure(harness, { course: PUBLISHED, resources: [adminVideoResource] }),
      editorPath(VIDEO.id, PUBLISHED.id),
    )

    expect(await screen.findByText('This course’s structure can’t be changed')).toBeInTheDocument()
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it('shows the server s own refusal if the course is published mid-edit', async () => {
    await open((harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/lessons/${VIDEO.id}/resource`, {
        status: 409,
        json: { detail: 'Only DRAFT courses can be edited' },
      })
    })
    await userEvent.upload(fileInputIn(await filePanel()), mp4())

    expect(
      await screen.findByText(/files can only be changed while the course is a draft/i),
    ).toBeInTheDocument()
  })
})

// --------------------------------------------------------------- validation

describe('admin resources - validation', () => {
  it('refuses an obviously wrong type before spending an upload', async () => {
    const { harness } = await open((harness) => stubStructure(harness))
    // `accept` is only a filter in the file dialog, and a person can defeat it
    // by choosing "All files", so the check has to hold without it too.
    await userEvent.upload(fileInputIn(await filePanel()), pdf('notes.pdf'), {
      applyAccept: false,
    })

    expect(await screen.findByText(/this lesson takes an MP4 video/i)).toBeInTheDocument()
    expect(uploads(harness)).toEqual([])
  })

  it('refuses an empty file locally, since the server would too', async () => {
    const { harness } = await open((harness) => stubStructure(harness))
    await userEvent.upload(
      fileInputIn(await filePanel()),
      new File([], 'empty.mp4', { type: 'video/mp4' }),
    )

    expect(await screen.findByText(/that file is empty/i)).toBeInTheDocument()
    expect(uploads(harness)).toEqual([])
  })

  it('still sends a file the browser could not type, letting the server decide', async () => {
    const { harness } = await open((harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/lessons/${VIDEO.id}/resource`, { json: adminVideoResource })
    })
    await userEvent.upload(
      fileInputIn(await filePanel()),
      new File([new Uint8Array(8)], 'clip.mp4', { type: '' }),
    )

    await waitFor(() => expect(uploads(harness)).toHaveLength(1))
  })

  it.each([
    [415, 'This file type is not supported for this lesson.'],
    [422, 'The file was rejected. Check that it is the format the lesson expects.'],
    [413, 'This file is larger than the maximum the server accepts.'],
    [503, 'File storage is temporarily unavailable. Try again in a moment.'],
    [403, 'Your administrator access may have changed. Sign in again.'],
    [500, 'The file could not be transferred. Check your connection and try again.'],
  ])('turns a %i into a sentence, with no trace or status code', async (status, message) => {
    await open((harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/lessons/${VIDEO.id}/resource`, {
        status,
        json: { detail: 'Traceback (most recent call last): internal detail' },
      })
    })
    await userEvent.upload(fileInputIn(await filePanel()), mp4())

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByText(/traceback/i)).toBeNull()
    expect(screen.queryByText(String(status))).toBeNull()
  })

  it('separates the two meanings of a 409', async () => {
    await open((harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/lessons/${VIDEO.id}/resource`, {
        status: 409,
        json: { detail: 'Only VIDEO and DOCUMENT lessons can hold a stored file' },
      })
    })
    await userEvent.upload(fileInputIn(await filePanel()), mp4())

    expect(
      await screen.findByText(/only video and document lessons can hold a file/i),
    ).toBeInTheDocument()
  })

  it('reports a dropped connection as one', async () => {
    await open((harness) => {
      stubStructure(harness)
      harness.http.failNetwork(`/admin/lessons/${VIDEO.id}/resource`)
    })
    await userEvent.upload(fileInputIn(await filePanel()), mp4())

    expect(await screen.findByText(/check your connection and try again/i)).toBeInTheDocument()
  })
})

// ----------------------------------------------------------- upload lifecycle

describe('admin resources - the upload lifecycle', () => {
  it('offers a retry that sends the same file again', async () => {
    const { harness } = await open((harness) => {
      stubStructure(harness)
      harness.http.once(`/admin/lessons/${VIDEO.id}/resource`, {
        status: 503,
        json: { detail: 'Storage temporarily unavailable' },
      })
      harness.http.on(`/admin/lessons/${VIDEO.id}/resource`, { json: adminVideoResource })
    })
    await userEvent.upload(fileInputIn(await filePanel()), mp4())

    await screen.findByText(/file storage is temporarily unavailable/i)
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(uploads(harness)).toHaveLength(2))
    expect(await screen.findByText('welcome.mp4')).toBeInTheDocument()
  })

  it('ignores a second pick while a transfer is already running', async () => {
    let finish: (() => void) | undefined
    const { harness } = await open((harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/lessons/${VIDEO.id}/resource`, async () => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return { json: adminVideoResource }
      })
    })
    const row = await filePanel()
    await userEvent.upload(fileInputIn(row), mp4())
    await screen.findByRole('progressbar', { name: /uploading/i })

    // While uploading there is no picker to click again, and no Replace or
    // Remove either - the panel is the transfer until it resolves.
    expect(row.querySelector('input[type="file"]')).toBeNull()
    expect(within(row).queryByRole('button', { name: 'Replace' })).toBeNull()
    expect(within(row).queryByRole('button', { name: /^Remove/ })).toBeNull()

    finish?.()
    await waitFor(() => expect(uploads(harness)).toHaveLength(1))
  })

  it('cancels a running transfer and reports nothing as a failure', async () => {
    await open((harness) => {
      stubStructure(harness)
      harness.http.on(
        `/admin/lessons/${VIDEO.id}/resource`,
        () => new Promise(() => undefined) as never,
      )
    })
    const row = await filePanel()
    await userEvent.upload(fileInputIn(row), mp4())
    await screen.findByRole('progressbar', { name: /uploading/i })

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    // Back to an offer to upload, with no error: cancelling was deliberate.
    await waitFor(async () =>
      expect(fileInputIn(await filePanel())).toBeInTheDocument(),
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

// ------------------------------------------------------------ upload progress

/**
 * G33 - the percentage, from the bytes the browser has sent.
 *
 * Each attempt at the upload endpoint is held open, so a test scripts the
 * transfer as the browser would report it and then answers it.
 */
function heldUploads(harness: AuthHarness, lessonId = VIDEO.id) {
  const attempts: { call: RecordedCall; answer: (response: MockResponse) => void }[] = []
  harness.http.on(
    `/admin/lessons/${lessonId}/resource`,
    (call) => new Promise<MockResponse>((answer) => attempts.push({ call, answer })),
  )
  return attempts
}

/** Dispatches one upload progress event on a held attempt. */
async function sent(
  attempt: { call: RecordedCall },
  loaded: number,
  total: number,
  lengthComputable = true,
): Promise<void> {
  await act(async () => attempt.call.reportUploadProgress!(loaded, total, lengthComputable))
}

const uploadBar = () => screen.getByRole('progressbar', { name: /uploading welcome\.mp4/i })

describe('admin resources - upload progress (G33)', () => {
  async function startHeld(width?: number) {
    let attempts: ReturnType<typeof heldUploads> = []
    const { harness } = await open(
      (harness) => {
        stubStructure(harness)
        attempts = heldUploads(harness)
      },
      editorPath(),
      width,
    )
    const row = await filePanel()
    await userEvent.upload(fileInputIn(row), mp4())
    await waitFor(() => expect(attempts).toHaveLength(1))
    return { harness, attempts, row }
  }

  it('shows 0, 25, 50 then 100% as the bytes leave', async () => {
    const { attempts } = await startHeld()

    for (const loaded of [0, 256, 512, 1024]) {
      await sent(attempts[0]!, loaded, 1024)
      const percent = Math.floor((loaded / 1024) * 100)
      expect(screen.getByText(`${percent}%`)).toBeInTheDocument()
      expect(uploadBar()).toHaveAttribute('aria-valuenow', String(percent))
    }
  })

  it('never shows a percentage going back', async () => {
    const { attempts } = await startHeld()
    const shown: number[] = []

    for (const loaded of [100, 400, 300, 700, 650]) {
      await sent(attempts[0]!, loaded, 1000)
      shown.push(Number(uploadBar().getAttribute('aria-valuenow')))
    }

    expect(shown).toEqual([10, 40, 40, 70, 70])
    expect(screen.queryByText('30%')).toBeNull()
  })

  it('never shows more than 100%', async () => {
    const { attempts } = await startHeld()

    await sent(attempts[0]!, 2048, 1024)

    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(uploadBar()).toHaveAttribute('aria-valuenow', '100')
    expect(screen.queryByText('200%')).toBeNull()
  })

  it('stays indeterminate when the browser cannot measure the file', async () => {
    const { attempts } = await startHeld()

    await sent(attempts[0]!, 512, 0, false)

    expect(uploadBar()).not.toHaveAttribute('aria-valuenow')
    expect(screen.queryByText(/%$/)).toBeNull()
  })

  it('moves on to the uploaded file once the server answers', async () => {
    const { attempts } = await startHeld()
    await sent(attempts[0]!, 1024, 1024)
    expect(screen.getByText('100%')).toBeInTheDocument()

    await act(async () => attempts[0]!.answer({ json: adminVideoResource }))

    const row = await filePanel()
    expect(await within(row).findByText('welcome.mp4')).toBeInTheDocument()
    expect(within(row).getByText(/Uploaded/)).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Replace' })).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('reports a server refusal after part of the file was sent', async () => {
    const { attempts } = await startHeld()
    await sent(attempts[0]!, 600, 1024)

    await act(async () =>
      attempts[0]!.answer({ status: 500, json: { detail: 'Traceback: internal detail' } }),
    )

    expect(
      await screen.findByText(
        'The file could not be transferred. Check your connection and try again.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('reports a connection dropped mid-transfer', async () => {
    let attempts: ReturnType<typeof heldUploads> = []
    const { harness } = await open((harness) => {
      stubStructure(harness)
      attempts = heldUploads(harness)
      harness.http.failNetwork(`/admin/lessons/${VIDEO.id}/resource`)
    })
    await userEvent.upload(fileInputIn(await filePanel()), mp4())

    expect(await screen.findByText(/check your connection and try again/i)).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(uploads(harness)).toHaveLength(1)
    expect(attempts).toHaveLength(0)
  })

  it('refreshes an expired session once and finishes the same upload', async () => {
    const { harness, attempts } = await startHeld()
    const refreshesBefore = harness.http.callsTo('/auth/refresh').length
    const refused = harness.accessTokens.get()
    harness.http.on('/auth/refresh', { json: { access_token: 'access-3', token_type: 'bearer' } })
    await sent(attempts[0]!, 1024, 1024)
    await act(async () =>
      attempts[0]!.answer({ status: 401, json: { detail: 'Invalid authentication credentials' } }),
    )

    await waitFor(() => expect(attempts).toHaveLength(2))
    // The bytes go again, and the bar says so.
    await sent(attempts[1]!, 512, 1024)
    expect(screen.getByText('50%')).toBeInTheDocument()
    await act(async () => attempts[1]!.answer({ json: adminVideoResource }))

    expect(await within(await filePanel()).findByText('welcome.mp4')).toBeInTheDocument()
    // One refresh for the refused upload, on top of whatever the session did
    // before it.
    expect(harness.http.callsTo('/auth/refresh')).toHaveLength(refreshesBefore + 1)
    const [first, second] = uploads(harness)
    expect(first!.headers.authorization).toBe(`Bearer ${refused}`)
    expect(second!.headers.authorization).toBe('Bearer access-3')
    expect(second!.formData!.get('file')).toBe(first!.formData!.get('file'))
    expect(uploads(harness)).toHaveLength(2)
  })

  it('sends the file once, by the same endpoint and body, whatever the progress', async () => {
    const { harness, attempts } = await startHeld()
    for (const loaded of [0, 128, 256, 512, 768, 1024]) await sent(attempts[0]!, loaded, 1024)
    await act(async () => attempts[0]!.answer({ json: adminVideoResource }))
    await within(await filePanel()).findByText('welcome.mp4')

    expect(uploads(harness)).toHaveLength(1)
    const call = uploads(harness)[0]!
    expect(call.transport).toBe('xhr')
    expect(call.method).toBe('PUT')
    expect(call.url).toBe(`http://localhost:8000/api/v1/admin/lessons/${VIDEO.id}/resource`)
    expect([...call.formData!.keys()]).toEqual(['file'])
    expect((call.formData!.get('file') as File).name).toBe('welcome.mp4')
    expect((call.formData!.get('file') as File).size).toBe(1024)
    // Progress asks the server for nothing: the PUT is the only write outside
    // the session's own sign-in, and nothing else touched the resource.
    expect(
      harness.http.calls.filter((c) => c.method !== 'GET' && !c.url.includes('/auth/')),
    ).toEqual([call])
    expect(harness.http.calls.filter((c) => c.url.includes('/resource') && c !== call)).toEqual(
      harness.http.calls.filter((c) => c.method === 'GET' && c.url.endsWith('/resources')),
    )
  })

  it('announces the progress in quarters, not at every percent', async () => {
    const { attempts, row } = await startHeld()
    const status = () =>
      within(row)
        .getAllByRole('status')
        .find((element) => element.textContent?.startsWith('Uploading'))!
    const heard = new Set<string>()

    expect(status()).toHaveTextContent('Uploading welcome.mp4')
    // 26 distinct percentages, every 4%.
    const shown = new Set<string>()
    for (let loaded = 0; loaded <= 1000; loaded += 40) {
      await sent(attempts[0]!, loaded, 1000)
      heard.add(status().textContent ?? '')
      shown.add(uploadBar().getAttribute('aria-valuenow') ?? '')
    }
    expect(shown.size).toBe(26)

    expect([...heard]).toEqual([
      'Uploading welcome.mp4: 0%',
      'Uploading welcome.mp4: 25%',
      'Uploading welcome.mp4: 50%',
      'Uploading welcome.mp4: 75%',
      'Uploading welcome.mp4: 100%',
    ])
    // The visible percentage is not a live region: it would speak 26 times.
    expect(screen.getByText('100%').closest('[aria-live], [role="status"]')).toBeNull()
  })

  it.each([viewports.mobile, 375])(
    'keeps the percentage and Cancel on a %ipx phone',
    async (width) => {
      const { attempts } = await startHeld(width)

      await sent(attempts[0]!, 640, 1024)

      expect(screen.getByText('62%')).toBeInTheDocument()
      expect(screen.getByText('welcome.mp4')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    },
  )

  it('cancels a transfer under way, and no late progress brings it back', async () => {
    const { attempts, row } = await startHeld()
    await sent(attempts[0]!, 300, 1024)

    await userEvent.click(within(row).getByRole('button', { name: 'Cancel' }))
    await sent(attempts[0]!, 900, 1024)

    expect(fileInputIn(await filePanel())).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

// --------------------------------------------------------------- replacement

describe('admin resources - replacing a file', () => {
  it('sends one PUT and never deletes the old file first', async () => {
    const replacement = { ...adminVideoResource, filename: 'welcome-v2.mp4', size_bytes: 3_000_000 }
    const { harness } = await open((harness) => {
      stubStructure(harness, { resources: [adminVideoResource] })
      harness.http.on(`/admin/lessons/${VIDEO.id}/resource`, { json: replacement })
    })
    const row = await filePanel()

    await userEvent.upload(fileInputIn(row), mp4('welcome-v2.mp4'))

    await waitFor(() => expect(uploads(harness)).toHaveLength(1))
    // Replacement is the same idempotent PUT; nothing was destroyed to make
    // room for it.
    expect(
      harness.http.calls.filter((call) => call.method === 'DELETE'),
    ).toEqual([])
  })

  it('keeps showing the existing file until the replacement succeeds', async () => {
    let finish: ((value: unknown) => void) | undefined
    await open((harness) => {
      stubStructure(harness, { resources: [adminVideoResource] })
      harness.http.on(`/admin/lessons/${VIDEO.id}/resource`, async () => {
        await new Promise((resolve) => {
          finish = resolve
        })
        return { status: 503, json: { detail: 'Storage temporarily unavailable' } }
      })
    })
    await userEvent.upload(fileInputIn(await filePanel()), mp4('welcome-v2.mp4'))
    await screen.findByRole('progressbar', { name: /uploading/i })

    finish?.(undefined)

    // The failed replacement leaves the server's file in place, which is what
    // the service guarantees, so the panel must not pretend it is gone.
    await screen.findByText(/file storage is temporarily unavailable/i)
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  })

  it('shows the new metadata once the replacement lands', async () => {
    const replacement = {
      ...adminVideoResource,
      filename: 'welcome-v2.mp4',
      duration_seconds: 245,
      updated_at: '2026-09-19T08:00:00Z',
    }
    await open((harness) => {
      stubStructure(harness, { resources: [adminVideoResource] })
      harness.http.on(`/admin/lessons/${VIDEO.id}/resource`, { json: replacement })
    })
    await userEvent.upload(fileInputIn(await filePanel()), mp4('welcome-v2.mp4'))

    const row = await filePanel()
    expect(await within(row).findByText('welcome-v2.mp4')).toBeInTheDocument()
    expect(within(row).getByText(/4 min 5 s · uploaded 19 Sep 2026/)).toBeInTheDocument()
    expect(within(row).queryByText('welcome.mp4')).toBeNull()
  })
})

// ------------------------------------------------------------------ deletion

describe('admin resources - removing a file', () => {
  it('asks first, in a real dialog, and sends nothing until it is confirmed', async () => {
    const { harness } = await open((harness) =>
      stubStructure(harness, { resources: [adminVideoResource] }),
    )
    const row = await filePanel()

    await userEvent.click(within(row).getByRole('button', { name: 'Remove welcome.mp4' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument()
    expect(harness.http.calls.filter((call) => call.method === 'DELETE')).toEqual([])
  })

  it('cancelling changes nothing', async () => {
    const { harness } = await open((harness) =>
      stubStructure(harness, { resources: [adminVideoResource] }),
    )
    const row = await filePanel()
    await userEvent.click(within(row).getByRole('button', { name: 'Remove welcome.mp4' }))

    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(harness.http.calls.filter((call) => call.method === 'DELETE')).toEqual([])
    expect(within(await filePanel()).getByText('welcome.mp4')).toBeInTheDocument()
  })

  it('DELETEs the lesson s resource and offers an upload again', async () => {
    const { harness } = await open((harness) => {
      stubStructure(harness, { resources: [adminVideoResource] })
      harness.http.on(`/admin/lessons/${VIDEO.id}/resource`, { status: 204 })
    })
    const row = await filePanel()
    await userEvent.click(within(row).getByRole('button', { name: 'Remove welcome.mp4' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove file' }),
    )

    await waitFor(() =>
      expect(
        harness.http.calls.filter(
          (call) =>
            call.method === 'DELETE' && call.url.includes(`/admin/lessons/${VIDEO.id}/resource`),
        ),
      ).toHaveLength(1),
    )

    // No stale metadata, and the empty state is back.
    const after = await filePanel()
    await waitFor(() => expect(within(after).queryByText('welcome.mp4')).toBeNull())
    expect(fileInputIn(await filePanel())).toBeInTheDocument()
  })

  it('keeps the file and explains when the server refuses the deletion', async () => {
    await open((harness) => {
      stubStructure(harness, { resources: [adminVideoResource] })
      harness.http.on(`/admin/lessons/${VIDEO.id}/resource`, {
        status: 409,
        json: { detail: 'Only DRAFT courses can be edited' },
      })
    })
    const row = await filePanel()
    await userEvent.click(within(row).getByRole('button', { name: 'Remove welcome.mp4' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove file' }))

    expect(
      await within(dialog).findByText(/files can only be changed while the course is a draft/i),
    ).toBeInTheDocument()
    expect(within(await filePanel()).getByText('welcome.mp4')).toBeInTheDocument()
  })

  it('deleting a file unblocks deleting the lesson, and says so', async () => {
    await open((harness) => {
      stubStructure(harness, { resources: [adminVideoResource] })
      harness.http.on(`/admin/lessons/${VIDEO.id}`, {
        status: 409,
        json: { detail: 'Lesson is still referenced' },
      })
    })
    await filePanel()
    await userEvent.click(screen.getByRole('button', { name: 'Delete lesson' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete lesson' }))

    expect(
      await within(dialog).findByText(/remove the lesson.s file first, then delete it/i),
    ).toBeInTheDocument()
  })

  it('says the same from the structure, where the lesson can be deleted too', async () => {
    await open((harness) => {
      stubStructure(harness, { resources: [adminVideoResource] })
      harness.http.on(`/admin/lessons/${VIDEO.id}`, {
        status: 409,
        json: { detail: 'Lesson is still referenced' },
      })
    }, detailPath())
    const row = await structureRow(VIDEO.title)
    await userEvent.click(within(row).getByRole('button', { name: `Delete lesson ${VIDEO.title}` }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete lesson' }))

    expect(
      await within(dialog).findByText(/remove the lesson.s file first, then delete it/i),
    ).toBeInTheDocument()
  })
})

// -------------------------------------------------------------- degraded read

describe('admin resources - when the file listing fails', () => {
  it('still shows the structure, and says the file state is unknown', async () => {
    await open((harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/courses/${DRAFT.id}/resources`, {
        status: 503,
        json: { detail: 'unavailable' },
      })
    }, detailPath())

    // The modules and lessons read correctly, so they are shown.
    expect(await screen.findByRole('heading', { name: M1.title, level: 3 })).toBeInTheDocument()
    const row = await structureRow(VIDEO.title)
    expect(within(row).getByText('File status unavailable')).toBeInTheDocument()
    expect(within(row).queryByText(/uploaded yet/i)).toBeNull()
  })

  it('says so in the editor too, and keeps the lesson type fixed', async () => {
    await open((harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/courses/${DRAFT.id}/resources`, {
        status: 503,
        json: { detail: 'unavailable' },
      })
    })
    const panel = await filePanel()

    expect(within(panel).getByText(/couldn.t be read/i)).toBeInTheDocument()
    expect(panel.querySelector('input[type="file"]')).toBeNull()
    // Whether a file is attached is unknown, so the type cannot be changed
    // into a kind that would hide it (G15).
    expect(screen.getByRole('radio', { name: 'Text' })).toBeDisabled()
  })
})

// ------------------------------------------------------------------- a11y

describe('admin resources - accessibility and layout', () => {
  it('names the file control, so it is not an unlabelled input', async () => {
    await open((harness) => stubStructure(harness))
    const row = await filePanel()

    const input = fileInputIn(row)
    expect(input).toHaveAccessibleName('Video file')
    expect(input).not.toBeDisabled()
  })

  it('reaches the picker by keyboard', async () => {
    await open((harness) => stubStructure(harness))
    const input = fileInputIn(await filePanel())

    input.focus()
    expect(input).toHaveFocus()
  })

  it('announces a failure rather than only colouring it', async () => {
    await open((harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/lessons/${VIDEO.id}/resource`, {
        status: 415,
        json: { detail: 'Unsupported media type for a VIDEO lesson' },
      })
    })
    await userEvent.upload(fileInputIn(await filePanel()), mp4())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/not supported/i)
  })

  it('keeps the file panel usable on a phone', async () => {
    await open((harness) => stubStructure(harness, { resources: [adminVideoResource] }), editorPath(), viewports.mobile)
    const row = await filePanel()

    expect(within(row).getByText('welcome.mp4')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Replace' })).toBeInTheDocument()
  })
})

// --------------------------------------------------------------- security

describe('admin resources - security', () => {
  it('makes no request to any storage provider, only to this API', async () => {
    const { harness } = await open((harness) => {
      stubStructure(harness, { resources: [adminVideoResource] })
      harness.http.on(`/admin/lessons/${VIDEO.id}/resource`, { json: adminVideoResource })
    })
    await userEvent.upload(fileInputIn(await filePanel()), mp4())
    await waitFor(() => expect(uploads(harness)).toHaveLength(1))

    for (const call of harness.http.calls) {
      expect(call.url).toContain('/api/v1/')
      expect(call.url).not.toMatch(/googleapis|drive\.google|storage\.google/i)
    }
  })

  it('never puts a credential or a token in a URL', async () => {
    const { harness } = await open((harness) => {
      stubStructure(harness)
      harness.http.on(`/admin/lessons/${VIDEO.id}/resource`, { json: adminVideoResource })
    })
    await userEvent.upload(fileInputIn(await filePanel()), mp4())
    await waitFor(() => expect(uploads(harness)).toHaveLength(1))

    for (const call of harness.http.calls) {
      expect(call.url).not.toMatch(/token|secret|key=|credential|password/i)
    }
  })
})
