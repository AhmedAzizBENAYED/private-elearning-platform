import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApiClientProvider } from '../../api'
import { createAuthHarness, stubSignIn, testAdmin } from '../../test/authHarness'
import { adminVideoResource } from '../../test/courseFixtures'
import type { MockResponse, RecordedCall } from '../../test/fetchMock'

import { useResourceUpload } from './useResourceUpload'

/**
 * G33 - the upload hook on its own, as an API a component calls.
 *
 * The screen tests cover what the panel shows; these cover the contract a
 * caller relies on without any markup in between.
 */

const LESSON = adminVideoResource.lesson_id
const ENDPOINT = `/admin/lessons/${LESSON}/resource`

async function setup() {
  const harness = createAuthHarness()
  stubSignIn(harness.http, { user: testAdmin })
  await harness.authStore.login({ email: testAdmin.email, password: 'correct-horse' })
  const attempts: { call: RecordedCall; answer: (response: MockResponse) => void }[] = []
  harness.http.on(
    ENDPOINT,
    (call) => new Promise<MockResponse>((answer) => attempts.push({ call, answer })),
  )
  const onUploaded = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiClientProvider client={harness.apiClient}>{children}</ApiClientProvider>
  )
  const hook = renderHook(
    () => useResourceUpload({ lessonId: LESSON, contentType: 'VIDEO', onUploaded }),
    { wrapper },
  )
  return { harness, attempts, onUploaded, hook }
}

const mp4 = () => new File([new Uint8Array(1024)], 'welcome.mp4', { type: 'video/mp4' })

describe('useResourceUpload (G33)', () => {
  it('starts one transfer even when asked twice in the same tick', async () => {
    const { harness, attempts, hook } = await setup()

    act(() => {
      hook.result.current.upload(mp4())
      hook.result.current.upload(mp4())
    })
    await waitFor(() => expect(attempts).toHaveLength(1))
    await act(async () => attempts[0]!.answer({ json: adminVideoResource }))

    expect(harness.http.callsTo(ENDPOINT)).toHaveLength(1)
  })

  it('goes idle -> uploading (indeterminate) -> measured -> success', async () => {
    const { attempts, onUploaded, hook } = await setup()
    expect(hook.result.current.state).toEqual({ status: 'idle' })

    act(() => hook.result.current.upload(mp4()))
    expect(hook.result.current.state).toMatchObject({ status: 'uploading', progress: null })

    await waitFor(() => expect(attempts).toHaveLength(1))
    await act(async () => attempts[0]!.call.reportUploadProgress!(512, 1024))
    expect(hook.result.current.state).toMatchObject({ status: 'uploading', progress: 50 })

    await act(async () => attempts[0]!.answer({ json: adminVideoResource }))
    expect(hook.result.current.state).toEqual({ status: 'idle' })
    expect(onUploaded).toHaveBeenCalledTimes(1)
    expect(onUploaded).toHaveBeenCalledWith(adminVideoResource)
  })

  it('reports a failure with its sentence, and retry sends the same file', async () => {
    const { harness, attempts, hook } = await setup()
    const file = mp4()

    act(() => hook.result.current.upload(file))
    await waitFor(() => expect(attempts).toHaveLength(1))
    await act(async () => attempts[0]!.answer({ status: 503, json: { detail: 'Storage down' } }))
    expect(hook.result.current.state).toEqual({
      status: 'failed',
      file,
      message: 'File storage is temporarily unavailable. Try again in a moment.',
    })

    act(() => hook.result.current.retry())
    await waitFor(() => expect(attempts).toHaveLength(2))
    expect(harness.http.callsTo(ENDPOINT)[1]!.formData!.get('file')).toBe(file)
  })
})
