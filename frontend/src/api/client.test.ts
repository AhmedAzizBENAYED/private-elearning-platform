import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createFetchMock, type FetchMock } from '../test/fetchMock'

import { createApiClient, type ApiClient, type AuthBridge } from './client'
import { ApiError } from './errors'
import { createHttpClient } from './http'

const BASE = 'http://localhost:8000'

function setup(bridge: Partial<AuthBridge> = {}) {
  const http = createFetchMock()
  const auth: AuthBridge = {
    getAccessToken: () => null,
    refreshAccessToken: () => Promise.resolve(null),
    ...bridge,
  }
  const client = createApiClient(
    createHttpClient({ baseUrl: BASE, fetchImpl: http.fetch }),
    auth,
  )
  return { http, client, auth }
}

describe('API client authorization', () => {
  it('attaches the bearer token when one is held', async () => {
    const { http, client } = setup({ getAccessToken: () => 'access-1' })
    http.on('/courses', { json: { items: [] } })

    await client.request('/courses')

    expect(http.calls[0]?.headers.authorization).toBe('Bearer access-1')
  })

  it('sends no Authorization header when no token is held', async () => {
    const { http, client } = setup({ getAccessToken: () => null })
    http.on('/courses', { json: { items: [] } })

    await client.request('/courses')

    expect(http.calls[0]?.headers).not.toHaveProperty('authorization')
  })

  it('never places a token in the URL', async () => {
    const { http, client } = setup({ getAccessToken: () => 'access-1' })
    http.on('/courses', { json: {} })

    await client.request('/courses')

    expect(http.calls[0]?.url).not.toContain('access-1')
  })
})

describe('401 refresh and retry', () => {
  let http: FetchMock
  let client: ApiClient
  let refreshAccessToken: ReturnType<typeof vi.fn>
  let token: string | null

  beforeEach(() => {
    token = 'stale'
    refreshAccessToken = vi.fn(async () => {
      token = 'fresh'
      return token
    })
    const created = setup({
      getAccessToken: () => token,
      refreshAccessToken: refreshAccessToken as unknown as AuthBridge['refreshAccessToken'],
    })
    http = created.http
    client = created.client
  })

  it('refreshes once and replays the request', async () => {
    http.once('/courses', { status: 401, json: { detail: 'Invalid authentication credentials' } })
    http.on('/courses', { json: { items: ['ok'] } })

    await expect(client.request('/courses')).resolves.toEqual({ items: ['ok'] })

    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    const calls = http.callsTo('/courses')
    expect(calls).toHaveLength(2)
    expect(calls[0]?.headers.authorization).toBe('Bearer stale')
    expect(calls[1]?.headers.authorization).toBe('Bearer fresh')
  })

  it('does not refresh for a non-401 failure', async () => {
    http.on('/courses', { status: 403, json: { detail: 'Insufficient privileges' } })

    await expect(client.request('/courses')).rejects.toMatchObject({ status: 403 })
    expect(refreshAccessToken).not.toHaveBeenCalled()
  })

  // FE-AUTH-SESSION-01: only a 401 means the access token was refused.
  it.each([400, 403, 404, 409, 422, 500, 503])(
    'treats a %i as an answer, never as an expired token',
    async (status) => {
      http.on('/courses', { status, json: { detail: 'Server said no' } })

      await expect(client.request('/courses')).rejects.toMatchObject({ status })
      expect(refreshAccessToken).not.toHaveBeenCalled()
      expect(http.callsTo('/courses')).toHaveLength(1)
    },
  )

  it('retries at most once, so a second 401 cannot loop', async () => {
    // Every attempt fails; without the single-replay rule this would recurse.
    http.on('/courses', { status: 401, json: { detail: 'Invalid authentication credentials' } })

    await expect(client.request('/courses')).rejects.toMatchObject({ status: 401 })

    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(http.callsTo('/courses')).toHaveLength(2)
  })

  it('preserves the retried response when it fails for a different reason', async () => {
    http.once('/courses', { status: 401, json: { detail: 'Invalid authentication credentials' } })
    http.on('/courses', { status: 409, json: { detail: 'Enrollment conflict; retry the request' } })

    await expect(client.request('/courses')).rejects.toMatchObject({
      status: 409,
      detail: 'Enrollment conflict; retry the request',
    })
  })
})

describe('401 without a refresh token', () => {
  it('returns the original 401 and never calls refresh twice', async () => {
    const refreshAccessToken = vi.fn(async () => null)
    const { http, client } = setup({
      getAccessToken: () => 'stale',
      refreshAccessToken,
    })
    http.on('/courses', { status: 401, json: { detail: 'Invalid authentication credentials' } })

    const error = (await client.request('/courses').catch((caught: unknown) => caught)) as ApiError

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(401)
    expect(error.detail).toBe('Invalid authentication credentials')
    // The request was attempted exactly once: there was nothing to retry with.
    expect(http.callsTo('/courses')).toHaveLength(1)
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
  })
})

describe('refresh failure', () => {
  it('propagates the refresh error rather than the original 401', async () => {
    const { http, client } = setup({
      getAccessToken: () => 'stale',
      refreshAccessToken: () => Promise.reject(new Error('Your session has expired')),
    })
    http.on('/courses', { status: 401, json: { detail: 'Invalid authentication credentials' } })

    await expect(client.request('/courses')).rejects.toThrow('Your session has expired')
    expect(http.callsTo('/courses')).toHaveLength(1)
  })
})
