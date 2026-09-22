import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthHarness } from '../../test/authHarness'
import {
  courseProgressResponse,
  documentResource,
  learningContent,
  learningLessonIds,
  linkLessonDetail,
  pdfBytes,
  progressResponse,
  textLessonDetail,
  unsupportedDocumentResource,
  videoResource,
} from '../../test/courseFixtures'
import { objectUrls } from '../../test/objectUrls'
import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

const COURSE_ID = learningContent.course_id
const DOCUMENT = learningLessonIds.document
const VIDEO = learningLessonIds.introduction

const lessonPath = (lessonId: string) => `/courses/${COURSE_ID}/lessons/${lessonId}`

const metadataPath = `/lessons/${DOCUMENT}/resource`
const contentPath = `/lessons/${DOCUMENT}/resource/content`

/**
 * The full learning surface, so a test can walk between all four lesson kinds
 * without restating every route.
 */
function stubLearning(harness: AuthHarness) {
  harness.http.on(`/courses/${COURSE_ID}/content`, { json: learningContent })
  harness.http.on(`/courses/${COURSE_ID}/progress`, { json: courseProgressResponse() })
  harness.http.on(`/lessons/${learningLessonIds.text}`, { json: textLessonDetail })
  harness.http.on(`/lessons/${learningLessonIds.link}`, { json: linkLessonDetail })
  harness.http.on(`/lessons/${VIDEO}/resource`, { json: videoResource })
  harness.http.on(`/lessons/${VIDEO}/progress`, { json: progressResponse() })
  harness.http.on(metadataPath, { json: documentResource })
  harness.http.on(contentPath, { bytes: pdfBytes, contentType: 'application/pdf' })
}

/** Waits for the viewer to finish both of its requests. */
const documentReady = () =>
  screen.findByRole('region', { name: `Document: ${documentResource.filename}` })

const openDocument = () => renderRoute({ path: lessonPath(DOCUMENT), as: 'member', beforeMount: stubLearning })

describe('DocumentViewer', () => {
  beforeEach(() => {
    // jsdom's `window.open` only logs "not implemented"; the tests assert the
    // member's click reaches it with the object URL.
    vi.stubGlobal('open', vi.fn())
  })

  afterEach(() => vi.unstubAllGlobals())

  describe('rendering a PDF', () => {
    it('shows the filename, its kind and its size', async () => {
      await openDocument()
      const viewer = await documentReady()

      expect(within(viewer).getByText(documentResource.filename)).toBeInTheDocument()
      expect(within(viewer).getByText('PDF')).toBeInTheDocument()
      // 248 120 bytes, as the design system formats it.
      expect(within(viewer).getByText(/242|248/)).toBeInTheDocument()
    })

    it('renders the lesson title in the page header, not the filename', async () => {
      await openDocument()
      await documentReady()

      expect(
        screen.getByRole('heading', { name: 'Python cheat sheet', level: 1 }),
      ).toBeInTheDocument()
    })

    it('renders the browser’s own viewer in a titled frame', async () => {
      await openDocument()
      await documentReady()

      const frame = screen.getByTitle(`Preview of ${documentResource.filename}`)
      expect(frame.tagName).toBe('IFRAME')
      // The frame reads the bytes already fetched, never the API URL: that URL
      // carries no token and would answer 401 to an iframe.
      expect(frame).toHaveAttribute('src', objectUrls.created[0])
      expect(frame.getAttribute('src')).toMatch(/^blob:/)
    })

    it('offers the two document actions', async () => {
      await openDocument()
      const viewer = await documentReady()

      expect(within(viewer).getByRole('button', { name: 'Open document' })).toBeEnabled()
      expect(within(viewer).getByRole('link', { name: 'Download' })).toBeInTheDocument()
    })

    it('downloads under the server’s own filename', async () => {
      await openDocument()
      const viewer = await documentReady()

      const download = within(viewer).getByRole('link', { name: 'Download' })
      expect(download).toHaveAttribute('download', documentResource.filename)
      expect(download.getAttribute('href')).toMatch(/^blob:/)
    })

    it('opens the document in a new tab only when the member asks', async () => {
      await openDocument()
      const viewer = await documentReady()

      expect(globalThis.open).not.toHaveBeenCalled()

      await userEvent.click(within(viewer).getByRole('button', { name: 'Open document' }))

      expect(globalThis.open).toHaveBeenCalledWith(
        objectUrls.created[0],
        '_blank',
        'noopener,noreferrer',
      )
    })

    it('says documents do not count toward course progress', async () => {
      await openDocument()
      await documentReady()

      expect(
        screen.getByText('Documents don’t count toward your course progress.'),
      ).toBeInTheDocument()
    })
  })

  describe('resource retrieval', () => {
    it('reads the metadata, then the bytes, once each', async () => {
      const { harness } = await openDocument()
      await documentReady()

      expect(harness.http.callsTo(metadataPath)).toHaveLength(1)
      expect(harness.http.callsTo(contentPath)).toHaveLength(1)
    })

    it('fetches the bytes at the URL the backend gave, through the authenticated client', async () => {
      const { harness } = await openDocument()
      await documentReady()

      const call = harness.http.callsTo(contentPath)[0]
      expect(call?.method).toBe('GET')
      expect(call?.headers.authorization).toMatch(/^Bearer /)
      // No credential of any kind in the URL: a DOCUMENT gets no playback token
      // and the session's own tokens never appear in one.
      expect(call?.url).not.toContain('token')
      expect(new URL(call?.url ?? '').search).toBe('')
    })

    it('keeps the fetched bytes as their real media type', async () => {
      await openDocument()
      await documentReady()

      const blob = objectUrls.blobFor(objectUrls.created[0] ?? '')
      expect(blob?.type).toBe('application/pdf')
    })

    it('shows an accessible loading state while the document is on its way', async () => {
      // Held open until the test releases it, so the loading state is
      // observable rather than a race.
      let release: () => void = () => undefined
      const { harness } = await renderRoute({
        path: lessonPath(DOCUMENT),
        as: 'member',
        beforeMount: (h) => {
          stubLearning(h)
          h.http.on(contentPath, async () => {
            await new Promise<void>((resolve) => {
              release = resolve
            })
            return { bytes: pdfBytes, contentType: 'application/pdf' }
          })
        },
      })

      expect(await screen.findByLabelText('Loading document')).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: /^Document:/ })).not.toBeInTheDocument()

      release()
      await documentReady()
      expect(harness.http.callsTo(contentPath)).toHaveLength(1)
    })

    it('never asks for a file the backend says does not exist', async () => {
      const { harness } = await renderRoute({
        path: lessonPath(DOCUMENT),
        as: 'member',
        beforeMount: (h) => {
          stubLearning(h)
          h.http.on(`/courses/${COURSE_ID}/content`, {
            json: {
              ...learningContent,
              modules: learningContent.modules.map((module) => ({
                ...module,
                lessons: module.lessons.map((lesson) =>
                  lesson.id === DOCUMENT ? { ...lesson, has_resource: false } : lesson,
                ),
              })),
            },
          })
        },
      })

      expect(
        await screen.findByText('No document has been uploaded for this lesson yet.'),
      ).toBeInTheDocument()
      expect(harness.http.callsTo(metadataPath)).toHaveLength(0)
      expect(harness.http.callsTo(contentPath)).toHaveLength(0)
    })
  })

  describe('failures', () => {
    const failing = (response: { status: number; json: unknown }) =>
      renderRoute({
        path: lessonPath(DOCUMENT),
        as: 'member',
        beforeMount: (h) => {
          stubLearning(h)
          h.http.on(contentPath, response)
        },
      })

    it('reports an expired session on 401', async () => {
      await failing({ status: 401, json: { detail: 'Invalid authentication credentials' } })
      expect(await screen.findByText('Your session has expired')).toBeInTheDocument()
    })

    it('reports lost access on 403', async () => {
      await failing({ status: 403, json: { detail: 'Insufficient privileges' } })
      expect(await screen.findByText('You can’t open this document')).toBeInTheDocument()
    })

    it('reports a removed file on 404', async () => {
      await failing({ status: 404, json: { detail: 'Lesson resource is no longer available' } })
      expect(
        await screen.findByText('This document is no longer available'),
      ).toBeInTheDocument()
    })

    it('reports a generic failure on 500 without repeating the server’s words', async () => {
      await failing({ status: 500, json: { detail: 'Traceback: storage_key=courses/x/y.pdf' } })

      expect(await screen.findByText('We couldn’t load this document')).toBeInTheDocument()
      expect(document.body.textContent).not.toContain('storage_key')
      expect(document.body.textContent).not.toContain('Traceback')
    })

    it('reports a dropped connection', async () => {
      await renderRoute({
        path: lessonPath(DOCUMENT),
        as: 'member',
        beforeMount: (h) => {
          stubLearning(h)
          h.http.failNetwork(contentPath)
        },
      })

      expect(await screen.findByText('We couldn’t load this document')).toBeInTheDocument()
    })

    it('retries both requests when asked', async () => {
      const { harness } = await renderRoute({
        path: lessonPath(DOCUMENT),
        as: 'member',
        beforeMount: (h) => {
          stubLearning(h)
          h.http.once(contentPath, { status: 503, json: { detail: 'Storage unavailable' } })
        },
      })

      await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))

      await documentReady()
      expect(harness.http.callsTo(contentPath)).toHaveLength(2)
    })
  })

  describe('media types the browser cannot render', () => {
    const unsupported = () =>
      renderRoute({
        path: lessonPath(DOCUMENT),
        as: 'member',
        beforeMount: (h) => {
          stubLearning(h)
          h.http.on(metadataPath, { json: unsupportedDocumentResource })
        },
      })

    it('shows no frame at all rather than a broken one', async () => {
      await unsupported()
      await screen.findByRole('region', { name: /^Document:/ })

      expect(screen.queryByTitle(/^Preview of/)).not.toBeInTheDocument()
      expect(await screen.findByText(/A preview isn’t available/)).toBeInTheDocument()
    })

    it('still offers the download', async () => {
      await unsupported()
      const viewer = await screen.findByRole('region', { name: /^Document:/ })

      expect(within(viewer).getByRole('link', { name: 'Download' })).toHaveAttribute(
        'download',
        unsupportedDocumentResource.filename,
      )
    })
  })

  describe('on a phone', () => {
    it('drops the inline frame and keeps the actions', async () => {
      await renderRoute({
        path: lessonPath(DOCUMENT),
        as: 'member',
        width: viewports.mobile,
        beforeMount: stubLearning,
      })
      const viewer = await documentReady()

      expect(screen.queryByTitle(/^Preview of/)).not.toBeInTheDocument()
      expect(within(viewer).getByRole('button', { name: 'Open document' })).toBeInTheDocument()
      expect(within(viewer).getByRole('link', { name: 'Download' })).toBeInTheDocument()
    })
  })

  describe('navigation between lesson kinds', () => {
    it('releases the document’s bytes when the member opens the video', async () => {
      const { router } = await openDocument()
      await documentReady()

      const url = objectUrls.created[0]
      expect(objectUrls.live()).toEqual([url])

      await router.navigate(lessonPath(VIDEO))

      await waitFor(() => expect(objectUrls.revoked).toContain(url))
      expect(objectUrls.live()).toEqual([])
    })

    it('leaves the video working and comes back to a fresh document', async () => {
      const { router, harness } = await renderRoute({
        path: lessonPath(VIDEO),
        as: 'member',
        beforeMount: stubLearning,
      })

      const video = await screen.findByLabelText('Video lesson: Introduction')
      expect(video).toHaveAttribute('src', expect.stringContaining('playback_token='))

      await router.navigate(lessonPath(DOCUMENT))
      await documentReady()

      await router.navigate(lessonPath(VIDEO))
      expect(await screen.findByLabelText('Video lesson: Introduction')).toBeInTheDocument()

      await router.navigate(lessonPath(DOCUMENT))
      await documentReady()

      // Two visits, two retrievals - nothing stale was reused.
      expect(harness.http.callsTo(contentPath)).toHaveLength(2)
      expect(objectUrls.created).toHaveLength(2)
      expect(objectUrls.live()).toHaveLength(1)
    })

    it.each([
      ['text', learningLessonIds.text, 'Before you start'],
      ['link', learningLessonIds.link, 'https://docs.python.org/3/tutorial/'],
    ])('survives a round trip through the %s lesson', async (_kind, lessonId, marker) => {
      const { router } = await openDocument()
      await documentReady()

      await router.navigate(lessonPath(lessonId))
      expect(await screen.findByText(marker)).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: /^Document:/ })).not.toBeInTheDocument()

      await router.navigate(lessonPath(DOCUMENT))
      await documentReady()
    })

    it('never shows the previous document under the next lesson’s title', async () => {
      const { router } = await openDocument()
      await documentReady()

      await router.navigate(lessonPath(learningLessonIds.text))

      await waitFor(() =>
        expect(screen.queryByText(documentResource.filename)).not.toBeInTheDocument(),
      )
    })
  })

  describe('browser history and refresh', () => {
    it('restores the document after a reload of the same URL', async () => {
      await openDocument()
      await documentReady()

      // A refresh is a fresh mount at the same location, with the session
      // restored from its refresh token.
      await openDocument()
      const viewers = await screen.findAllByRole('region', { name: /^Document:/ })
      expect(viewers.length).toBeGreaterThan(0)
    })

    it('follows back and forward to the right lesson', async () => {
      const { router } = await openDocument()
      await documentReady()

      await router.navigate(lessonPath(VIDEO))
      await screen.findByLabelText('Video lesson: Introduction')

      await router.navigate(-1)
      await documentReady()

      await router.navigate(1)
      expect(await screen.findByLabelText('Video lesson: Introduction')).toBeInTheDocument()
    })
  })

  describe('progress and security', () => {
    it('writes no progress for a document lesson', async () => {
      const { harness } = await openDocument()
      await documentReady()

      expect(harness.http.calls.filter((call) => call.method === 'PUT')).toEqual([])
      expect(harness.http.callsTo(`/lessons/${DOCUMENT}/progress`)).toHaveLength(0)
    })

    it('exposes no storage key, provider URL or credential', async () => {
      const { harness } = await openDocument()
      await documentReady()

      const markup = document.body.innerHTML
      for (const secret of [
        'drive.google',
        'googleapis',
        'storage://',
        // The storage key's own shape, which `MemberResourceResponse` omits.
        '/documents/',
        'provider_reference',
        'Bearer ',
      ]) {
        expect(markup).not.toContain(secret)
      }
      // The only URL handed to the browser is the same-origin object URL.
      expect(markup).not.toContain(harness.apiClient.baseUrl + contentPath)
    })

    it('persists no resource URL anywhere', async () => {
      await openDocument()
      await documentReady()

      const url = objectUrls.created[0] ?? ''
      const stored = [
        ...Object.values(localStorage),
        ...Object.values(sessionStorage),
      ].join('|')
      expect(stored).not.toContain(url)
      expect(stored).not.toContain('resource/content')
    })
  })
})
