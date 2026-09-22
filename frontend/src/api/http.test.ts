import { beforeEach, describe, expect, it } from 'vitest'

import { createFetchMock, type FetchMock } from '../test/fetchMock'

import { buildUrl, normalizeBaseUrl } from './config'
import { ApiError, NetworkError } from './errors'
import { createHttpClient, type HttpClient } from './http'

const BASE = 'http://localhost:8000'

describe('URL building', () => {
  it('appends the API version prefix to the configured origin', () => {
    expect(buildUrl(BASE, '/auth/login')).toBe('http://localhost:8000/api/v1/auth/login')
  })

  it('produces a relative URL when no origin is configured', () => {
    expect(buildUrl('', '/auth/me')).toBe('/api/v1/auth/me')
  })

  it('never doubles a slash', () => {
    expect(buildUrl(normalizeBaseUrl('http://localhost:8000/'), '/auth/me')).toBe(
      'http://localhost:8000/api/v1/auth/me',
    )
    expect(buildUrl(BASE, 'auth/me')).toBe('http://localhost:8000/api/v1/auth/me')
  })

  it('treats a missing or blank base URL as same-origin', () => {
    expect(normalizeBaseUrl(undefined)).toBe('')
    expect(normalizeBaseUrl('   ')).toBe('')
  })
})

describe('HTTP client', () => {
  let http: FetchMock
  let client: HttpClient

  beforeEach(() => {
    http = createFetchMock()
    client = createHttpClient({ baseUrl: BASE, fetchImpl: http.fetch })
  })

  describe('requests', () => {
    it('sends a GET to the versioned URL by default', async () => {
      http.on('/auth/me', { json: { id: '1' } })

      await client.request('/auth/me')

      expect(http.calls[0]?.url).toBe('http://localhost:8000/api/v1/auth/me')
      expect(http.calls[0]?.method).toBe('GET')
    })

    it('serialises a JSON body and sets Content-Type', async () => {
      http.on('/auth/login', { json: { access_token: 'a' } })

      await client.request('/auth/login', {
        method: 'POST',
        json: { email: 'iyed@example.org', password: 'secret' },
      })

      const call = http.calls[0]
      expect(call?.method).toBe('POST')
      expect(call?.headers['content-type']).toBe('application/json')
      expect(JSON.parse(call?.body ?? '{}')).toEqual({
        email: 'iyed@example.org',
        password: 'secret',
      })
    })

    it('sends no Authorization header of its own', async () => {
      http.on('/auth/me', { json: {} })

      await client.request('/auth/me')

      expect(http.calls[0]?.headers).not.toHaveProperty('authorization')
    })

    it('forwards caller-supplied headers', async () => {
      http.on('/auth/me', { json: {} })

      await client.request('/auth/me', { headers: { Authorization: 'Bearer explicit' } })

      expect(http.calls[0]?.headers.authorization).toBe('Bearer explicit')
    })
  })

  describe('response parsing', () => {
    it('returns parsed JSON', async () => {
      http.on('/auth/me', { json: { id: '1', role: 'MEMBER' } })

      await expect(client.request('/auth/me')).resolves.toEqual({ id: '1', role: 'MEMBER' })
    })

    it('resolves undefined for 204', async () => {
      http.on('/auth/setup-password', { status: 204 })

      await expect(client.request('/auth/setup-password', { method: 'POST' })).resolves.toBeUndefined()
    })

    it('resolves undefined for an empty 200 body', async () => {
      http.on('/ping', { status: 200, text: '' })

      await expect(client.request('/ping')).resolves.toBeUndefined()
    })

    it('raises a clear error for a malformed JSON body', async () => {
      http.on('/auth/me', { status: 200, text: '{not json', contentType: 'application/json' })

      await expect(client.request('/auth/me')).rejects.toMatchObject({
        name: 'ApiError',
        status: 200,
        detail: 'The server returned a malformed response',
      })
    })
  })

  describe('errors', () => {
    const cases = [
      { status: 401, detail: 'Invalid authentication credentials', flag: 'isUnauthorized' },
      { status: 403, detail: 'Insufficient privileges', flag: 'isForbidden' },
      { status: 404, detail: 'Course not found', flag: 'isNotFound' },
      { status: 409, detail: 'Only DRAFT courses can be edited', flag: 'isConflict' },
    ] as const

    it.each(cases)('maps $status to a typed ApiError', async ({ status, detail, flag }) => {
      http.on('/courses', { status, json: { detail } })

      const error = await client.request('/courses').catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(ApiError)
      expect(error).toMatchObject({ status, detail })
      expect((error as ApiError)[flag]).toBe(true)
    })

    it('keeps the field issues from a 422', async () => {
      http.on('/auth/login', {
        status: 422,
        json: {
          detail: [
            { loc: ['body', 'email'], msg: 'value is not a valid email address', type: 'value_error' },
            { loc: ['body', 'password'], msg: 'Field required', type: 'missing' },
          ],
        },
      })

      const error = (await client
        .request('/auth/login', { method: 'POST', json: {} })
        .catch((caught: unknown) => caught)) as ApiError

      expect(error.isValidation).toBe(true)
      expect(error.issues).toHaveLength(2)
      expect(error.fieldErrors()).toEqual({
        email: 'value is not a valid email address',
        password: 'Field required',
      })
    })

    it('marks 5xx as a server error and keeps the backend message', async () => {
      http.on('/courses', { status: 500, json: { detail: 'Internal server error' } })

      const error = (await client.request('/courses').catch((caught: unknown) => caught)) as ApiError

      expect(error.isServerError).toBe(true)
      expect(error.detail).toBe('Internal server error')
    })

    it('falls back to a readable message when the body has no detail', async () => {
      http.on('/courses', { status: 503, json: {} })

      await expect(client.request('/courses')).rejects.toMatchObject({
        status: 503,
        detail: 'The service is temporarily unavailable',
      })
    })

    it('raises NetworkError when the request never reaches the server', async () => {
      http.failNetwork('/auth/me')

      await expect(client.request('/auth/me')).rejects.toBeInstanceOf(NetworkError)
    })

    it('lets an abort through untouched', async () => {
      const controller = new AbortController()
      http.failNetwork('/auth/me', new DOMException('Aborted', 'AbortError'))
      controller.abort()

      await expect(
        client.request('/auth/me', { signal: controller.signal }),
      ).rejects.toBeInstanceOf(DOMException)
    })
  })
})
