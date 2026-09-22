import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAuthHarness, stubSignIn, testAdmin } from '../test/authHarness'
import { createFetchMock, type FetchMock, type MockResponse, type RecordedCall } from '../test/fetchMock'

import { createApiClient, type ApiClient, type AuthBridge } from './client'
import { ApiError, NetworkError } from './errors'
import { createHttpClient } from './http'
import { uploadPercent, type UploadProgress } from './uploadProgress'

/**
 * G33 - an upload that reports its progress.
 *
 * The request goes through the one authenticated client, so these tests hold
 * it to the same rules as every other request: the same endpoint, body and
 * headers, one shared refresh on a 401, exactly one replay, and no refresh for
 * any other status. Only the transport differs, and only for the caller that
 * asks for progress.
 */

const BASE = 'http://localhost:8000'
const PATH = '/admin/lessons/5c1d/resource'
const URL_ = `${BASE}/api/v1${PATH}`

interface Attempt {
  call: RecordedCall
  answer: (response: MockResponse) => void
}

/** Holds every attempt at `suffix` open until the test answers it. */
function held(http: FetchMock, suffix: string): Attempt[] {
  const attempts: Attempt[] = []
  http.on(
    suffix,
    (call) => new Promise<MockResponse>((answer) => attempts.push({ call, answer })),
  )
  return attempts
}

function videoForm(): { form: FormData; file: File } {
  const file = new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 1, 2, 3])], 'intro.mp4', {
    type: 'video/mp4',
  })
  const form = new FormData()
  form.append('file', file)
  return { form, file }
}

function setup(bridge: Partial<AuthBridge> = {}) {
  const http = createFetchMock()
  const auth: AuthBridge = {
    getAccessToken: () => 'access-1',
    refreshAccessToken: () => Promise.resolve(null),
    ...bridge,
  }
  const client = createApiClient(
    createHttpClient({ baseUrl: BASE, fetchImpl: http.fetch, xhrImpl: http.xhr }),
    auth,
  )
  return { http, client }
}

function upload(client: ApiClient, form: FormData, seen: UploadProgress[] = [], signal?: AbortSignal) {
  return client.request<{ id: string }>(PATH, {
    method: 'PUT',
    body: form,
    signal,
    onUploadProgress: (progress) => seen.push(progress),
  })
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

describe('upload progress - the transfer', () => {
  it('reports 0 -> 25 -> 50 -> 100% from loaded / total, then resolves', async () => {
    const { http, client } = setup()
    const attempts = held(http, PATH)
    const seen: UploadProgress[] = []
    const { form } = videoForm()

    const result = upload(client, form, seen)
    await vi.waitFor(() => expect(attempts).toHaveLength(1))
    const { call, answer } = attempts[0]!
    for (const loaded of [0, 25, 50, 100]) call.reportUploadProgress!(loaded, 100)
    answer({ json: { id: 'resource-1' } })

    await expect(result).resolves.toEqual({ id: 'resource-1' })
    // First the transport's own "starting, extent unknown", then the bytes.
    expect(seen.map(uploadPercent)).toEqual([null, 0, 25, 50, 100])
  })

  it('never reports more than the body holds as more than 100%', async () => {
    const { http, client } = setup()
    const attempts = held(http, PATH)
    const seen: UploadProgress[] = []

    const result = upload(client, videoForm().form, seen)
    await vi.waitFor(() => expect(attempts).toHaveLength(1))
    attempts[0]!.call.reportUploadProgress!(180, 100)
    attempts[0]!.answer({ json: { id: 'resource-1' } })
    await result

    expect(Math.max(...seen.map((p) => uploadPercent(p) ?? 0))).toBe(100)
  })

  it('reports no total when the browser cannot measure the body', async () => {
    const { http, client } = setup()
    const attempts = held(http, PATH)
    const seen: UploadProgress[] = []

    const result = upload(client, videoForm().form, seen)
    await vi.waitFor(() => expect(attempts).toHaveLength(1))
    attempts[0]!.call.reportUploadProgress!(4096, 0, false)
    attempts[0]!.answer({ json: { id: 'resource-1' } })
    await result

    expect(seen.at(-1)).toEqual({ loaded: 4096, total: null })
    expect(seen.map(uploadPercent)).toEqual([null, null])
  })

  it('sends one request, to the same endpoint, with the same body and headers', async () => {
    const { http, client } = setup()
    http.on(PATH, { json: { id: 'resource-1' } })
    const { form, file } = videoForm()

    await upload(client, form)

    expect(http.calls).toHaveLength(1)
    const call = http.calls[0]!
    expect(call.transport).toBe('xhr')
    expect(call.url).toBe(URL_)
    expect(call.method).toBe('PUT')
    // The very FormData and File the caller built: one `file` part, no copy.
    expect(call.formData).toBe(form)
    expect([...call.formData!.keys()]).toEqual(['file'])
    expect(call.formData!.get('file')).toBe(file)
    expect(call.headers.authorization).toBe('Bearer access-1')
    expect(call.headers.accept).toBe('application/json')
    // The browser writes the multipart boundary itself.
    expect(call.headers['content-type']).toBeUndefined()
  })

  it('leaves the file exactly as it was: same bytes, same SHA-256', async () => {
    const { http, client } = setup()
    http.on(PATH, { json: { id: 'resource-1' } })
    const { form, file } = videoForm()
    const before = { name: file.name, size: file.size, type: file.type, hash: await sha256(file) }

    await upload(client, form)

    expect({ name: file.name, size: file.size, type: file.type, hash: await sha256(file) }).toEqual(
      before,
    )
  })

  it('keeps every other request on fetch', async () => {
    const { http, client } = setup()
    http.on('/courses', { json: { items: [] } })
    http.on(PATH, { json: { id: 'resource-1' } })

    await client.request('/courses')
    await client.request(PATH, { method: 'PUT', body: videoForm().form })

    expect(http.calls.map((call) => call.transport)).toEqual(['fetch', 'fetch'])
  })

  it('reads a 204 as no body, as fetch does', async () => {
    const { http, client } = setup()
    http.on(PATH, { status: 204 })

    await expect(upload(client, videoForm().form)).resolves.toBeUndefined()
  })
})

describe('upload progress - failures', () => {
  it('reports a dropped connection as a NetworkError', async () => {
    const { http, client } = setup()
    http.failNetwork(PATH)

    await expect(upload(client, videoForm().form)).rejects.toBeInstanceOf(NetworkError)
    expect(http.calls).toHaveLength(1)
  })

  it('keeps the server s 422 issues, as fetch does', async () => {
    const { http, client } = setup()
    http.on(PATH, {
      status: 422,
      json: { detail: [{ loc: ['body', 'file'], msg: 'Field required', type: 'missing' }] },
    })

    const error = (await upload(client, videoForm().form).catch((caught: unknown) => caught)) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(422)
    expect(error.fieldErrors()).toEqual({ file: 'Field required' })
  })

  it('turns an abort into an AbortError, never into a failure', async () => {
    const { http, client } = setup()
    const attempts = held(http, PATH)
    const controller = new AbortController()

    const result = upload(client, videoForm().form, [], controller.signal)
    await vi.waitFor(() => expect(attempts).toHaveLength(1))
    controller.abort()

    const error = await result.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DOMException)
    expect(error).toMatchObject({ name: 'AbortError' })
  })

  it('sends nothing when the signal is already aborted', async () => {
    const { http, client } = setup()
    const controller = new AbortController()
    controller.abort()

    await expect(upload(client, videoForm().form, [], controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(http.calls).toHaveLength(0)
  })
})

describe('upload progress - 401, refresh and replay', () => {
  let token: string
  let refreshAccessToken: ReturnType<typeof vi.fn>

  beforeEach(() => {
    token = 'stale'
    refreshAccessToken = vi.fn(async () => {
      token = 'fresh'
      return token
    })
  })

  const bridge = () => ({
    getAccessToken: () => token,
    refreshAccessToken: refreshAccessToken as unknown as AuthBridge['refreshAccessToken'],
  })

  it('refreshes once and replays the same upload, reporting the replay from 0', async () => {
    const { http, client } = setup(bridge())
    const attempts = held(http, PATH)
    const seen: UploadProgress[] = []
    const { form, file } = videoForm()

    const result = upload(client, form, seen)
    await vi.waitFor(() => expect(attempts).toHaveLength(1))
    attempts[0]!.call.reportUploadProgress!(100, 100)
    attempts[0]!.answer({ status: 401, json: { detail: 'Invalid authentication credentials' } })

    await vi.waitFor(() => expect(attempts).toHaveLength(2))
    attempts[1]!.call.reportUploadProgress!(50, 100)
    attempts[1]!.call.reportUploadProgress!(100, 100)
    attempts[1]!.answer({ json: { id: 'resource-1' } })

    await expect(result).resolves.toEqual({ id: 'resource-1' })
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    const [first, second] = http.callsTo(PATH)
    expect(first!.headers.authorization).toBe('Bearer stale')
    expect(second!.headers.authorization).toBe('Bearer fresh')
    expect(second!.transport).toBe('xhr')
    expect(second!.formData!.get('file')).toBe(file)
    expect(seen.map(uploadPercent)).toEqual([null, 100, null, 50, 100])
  })

  it('replays at most once: a second 401 is the answer', async () => {
    const { http, client } = setup(bridge())
    http.on(PATH, { status: 401, json: { detail: 'Invalid authentication credentials' } })

    await expect(upload(client, videoForm().form)).rejects.toMatchObject({ status: 401 })
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(http.callsTo(PATH)).toHaveLength(2)
  })

  it.each([400, 403, 404, 409, 413, 415, 422, 500, 503])(
    'never refreshes on a %i',
    async (status) => {
      const { http, client } = setup(bridge())
      http.on(PATH, { status, json: { detail: 'Server said no' } })

      await expect(upload(client, videoForm().form)).rejects.toMatchObject({ status })
      expect(refreshAccessToken).not.toHaveBeenCalled()
      expect(http.callsTo(PATH)).toHaveLength(1)
    },
  )

  it('propagates a failed refresh and does not replay', async () => {
    const { http, client } = setup({
      getAccessToken: () => 'stale',
      refreshAccessToken: () => Promise.reject(new Error('Your session has expired')),
    })
    http.on(PATH, { status: 401, json: { detail: 'Invalid authentication credentials' } })

    await expect(upload(client, videoForm().form)).rejects.toThrow('Your session has expired')
    expect(http.callsTo(PATH)).toHaveLength(1)
  })

  it('shares one refresh between two uploads refused at the same time', async () => {
    const harness = createAuthHarness()
    stubSignIn(harness.http, { user: testAdmin })
    await harness.authStore.login({ email: testAdmin.email, password: 'correct-horse' })
    harness.accessTokens.set('stale')

    let release: (() => void) | undefined
    harness.http.on(
      '/auth/refresh',
      () =>
        new Promise<MockResponse>((resolve) => {
          release = () => resolve({ json: { access_token: 'access-2', token_type: 'bearer' } })
        }),
    )
    const answer = (call: RecordedCall): MockResponse =>
      call.headers.authorization === 'Bearer access-2'
        ? { json: { id: call.url } }
        : { status: 401, json: { detail: 'Invalid authentication credentials' } }
    harness.http.on('/admin/lessons/a/resource', answer)
    harness.http.on('/admin/lessons/b/resource', answer)

    const put = (lesson: string) =>
      harness.apiClient.request(`/admin/lessons/${lesson}/resource`, {
        method: 'PUT',
        body: videoForm().form,
        onUploadProgress: () => undefined,
      })
    const both = Promise.all([put('a'), put('b')])

    await vi.waitFor(() => expect(release).toBeDefined())
    release!()
    await both

    expect(harness.http.callsTo('/auth/refresh')).toHaveLength(1)
    for (const lesson of ['a', 'b']) {
      const calls = harness.http.callsTo(`/admin/lessons/${lesson}/resource`)
      expect(calls.map((call) => call.headers.authorization)).toEqual([
        'Bearer stale',
        'Bearer access-2',
      ])
      expect(calls.every((call) => call.transport === 'xhr')).toBe(true)
    }
  })
})
