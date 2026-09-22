import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createApiClient, createHttpClient } from '../../api'
import { createFetchMock, type FetchMock } from '../../test/fetchMock'
import { testUser } from '../../test/authHarness'

import { createAccessTokenStore } from './accessTokenStore'
import { createAuthApi } from './api'
import { createAuthStore, type AuthStore } from './authStore'
import { createRefreshTokenStorage, REFRESH_TOKEN_KEY } from './refreshTokenStorage'

const ACCESS_TOKEN = 'access-token-SECRET-aaa'
const REFRESH_TOKEN = 'refresh-token-SECRET-bbb'
const PASSWORD = 'correct-horse-battery-staple'

/**
 * These tests deliberately use the *real* jsdom `localStorage` and
 * `sessionStorage` rather than the in-memory double the other suites use. The
 * whole point is to assert what actually lands in web storage.
 */
function createRealStorageHarness() {
  const http = createFetchMock()
  const httpClient = createHttpClient({ baseUrl: 'http://localhost:8000', fetchImpl: http.fetch })
  const accessTokens = createAccessTokenStore()
  const refreshTokens = createRefreshTokenStorage()
  const authStore = createAuthStore({
    authApi: createAuthApi(httpClient),
    accessTokens,
    refreshTokens,
  })
  const apiClient = createApiClient(httpClient, {
    getAccessToken: accessTokens.get,
    refreshAccessToken: authStore.refreshAccessToken,
  })
  return { http, authStore, apiClient, accessTokens }
}

function storageDump(storage: Storage): string {
  const entries: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key === null) continue
    entries.push(`${key}=${storage.getItem(key) ?? ''}`)
  }
  return entries.join('\n')
}

async function signIn(http: FetchMock, authStore: AuthStore): Promise<void> {
  http.on('/auth/login', {
    json: { access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, token_type: 'bearer' },
  })
  http.on('/auth/me', { json: testUser })
  await authStore.login({ email: 'iyed@example.org', password: PASSWORD })
}

describe('token persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('never writes anything to localStorage', async () => {
    const { http, authStore } = createRealStorageHarness()

    await signIn(http, authStore)

    expect(localStorage.length).toBe(0)
    expect(storageDump(localStorage)).not.toContain(ACCESS_TOKEN)
    expect(storageDump(localStorage)).not.toContain(REFRESH_TOKEN)
  })

  it('never writes the access token to any web storage', async () => {
    const { http, authStore } = createRealStorageHarness()

    await signIn(http, authStore)

    expect(storageDump(sessionStorage)).not.toContain(ACCESS_TOKEN)
    expect(storageDump(localStorage)).not.toContain(ACCESS_TOKEN)
  })

  it('persists the refresh token, and only that, under one known key', async () => {
    const { http, authStore } = createRealStorageHarness()

    await signIn(http, authStore)

    expect(sessionStorage.length).toBe(1)
    expect(sessionStorage.key(0)).toBe(REFRESH_TOKEN_KEY)
    expect(sessionStorage.getItem(REFRESH_TOKEN_KEY)).toBe(REFRESH_TOKEN)
  })

  it('removes the persisted refresh token when the refresh is rejected', async () => {
    const { http, authStore } = createRealStorageHarness()
    await signIn(http, authStore)
    expect(sessionStorage.getItem(REFRESH_TOKEN_KEY)).toBe(REFRESH_TOKEN)

    http.on('/auth/refresh', { status: 401, json: { detail: 'Invalid authentication credentials' } })
    await expect(authStore.refreshAccessToken()).rejects.toThrow()

    expect(sessionStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })

  it('removes the persisted refresh token on logout', async () => {
    const { http, authStore } = createRealStorageHarness()
    await signIn(http, authStore)

    authStore.logout()

    expect(sessionStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull()
    expect(localStorage.length).toBe(0)
  })

  it('degrades to no session when web storage is unavailable', () => {
    // Safari private mode, blocked site data, a sandboxed iframe.
    const blocked = createRefreshTokenStorage(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })

    expect(() => blocked.write('anything')).not.toThrow()
    expect(blocked.read()).toBeNull()
    expect(() => blocked.clear()).not.toThrow()
  })
})

describe('tokens in transit', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('never puts a token in a URL', async () => {
    const { http, authStore, apiClient } = createRealStorageHarness()
    await signIn(http, authStore)
    http.on('/courses', { json: {} })

    await apiClient.request('/courses')

    for (const call of http.calls) {
      expect(call.url).not.toContain(ACCESS_TOKEN)
      expect(call.url).not.toContain(REFRESH_TOKEN)
      expect(call.url).not.toContain(PASSWORD)
      expect(call.url).not.toContain('token=')
    }
  })

  it('sends the refresh token in the body, never as a query parameter', async () => {
    const { http, authStore } = createRealStorageHarness()
    await signIn(http, authStore)
    http.on('/auth/refresh', { json: { access_token: 'access-2', token_type: 'bearer' } })

    await authStore.refreshAccessToken()

    const call = http.callsTo('/auth/refresh')[0]
    expect(call?.url).toBe('http://localhost:8000/api/v1/auth/refresh')
    expect(call?.body).toContain(REFRESH_TOKEN)
  })
})

describe('tokens in errors and logs', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('keeps credentials out of a thrown error', async () => {
    const { http, authStore } = createRealStorageHarness()
    http.on('/auth/login', { status: 401, json: { detail: 'Invalid email or password' } })

    const error = (await authStore
      .login({ email: 'iyed@example.org', password: PASSWORD })
      .catch((caught: unknown) => caught)) as Error

    const serialised = `${error.message}\n${error.stack ?? ''}\n${JSON.stringify(error)}`
    expect(serialised).not.toContain(PASSWORD)
    expect(error.message).toBe('API 401: Invalid email or password')
  })

  it('keeps the refresh token out of a failed-refresh error', async () => {
    const { http, authStore } = createRealStorageHarness()
    await signIn(http, authStore)
    http.on('/auth/refresh', { status: 401, json: { detail: 'Invalid authentication credentials' } })

    const error = (await authStore.refreshAccessToken().catch((caught: unknown) => caught)) as Error

    expect(`${error.message}\n${error.stack ?? ''}`).not.toContain(REFRESH_TOKEN)
  })

  it('logs nothing at all during a full session lifecycle', async () => {
    const spies = {
      log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
      info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    }

    try {
      const { http, authStore, apiClient } = createRealStorageHarness()
      await signIn(http, authStore)
      http.on('/auth/refresh', { json: { access_token: 'access-2', token_type: 'bearer' } })
      http.on('/courses', { json: {} })
      await authStore.refreshAccessToken()
      await apiClient.request('/courses')
      authStore.logout()

      for (const [name, spy] of Object.entries(spies)) {
        const logged = spy.mock.calls.flat().map(String).join('\n')
        expect(logged, `console.${name} was called`).toBe('')
        expect(logged).not.toContain(ACCESS_TOKEN)
        expect(logged).not.toContain(REFRESH_TOKEN)
      }
    } finally {
      for (const spy of Object.values(spies)) spy.mockRestore()
    }
  })
})
