import { describe, expect, it } from 'vitest'

import { createApiClient, createHttpClient } from '../../api'
import { page } from '../../test/courseFixtures'
import { createFetchMock } from '../../test/fetchMock'

import { createDashboardApi } from './api'

function setup() {
  const http = createFetchMock()
  const client = createApiClient(
    createHttpClient({ baseUrl: 'http://localhost:8000', fetchImpl: http.fetch }),
    { getAccessToken: () => 'access-1', refreshAccessToken: () => Promise.resolve(null) },
  )
  return { http, api: createDashboardApi(client) }
}

describe('dashboard API layer', () => {
  it('exposes only the three member reads the dashboard needs', () => {
    const { api } = setup()

    expect(Object.keys(api).sort()).toEqual([
      'getCourseContent',
      'listEnrollments',
      'listPublishedCourses',
    ])
  })

  it('requests one bounded page of enrollments from the real path', async () => {
    const { http, api } = setup()
    http.on('/me/enrollments', { json: page([]) })

    await api.listEnrollments()

    expect(http.calls[0]?.url).toBe(
      'http://localhost:8000/api/v1/me/enrollments?page=1&page_size=100',
    )
    expect(http.calls[0]?.method).toBe('GET')
  })

  it('requests one bounded page of published courses', async () => {
    const { http, api } = setup()
    http.on('/courses', { json: page([]) })

    await api.listPublishedCourses()

    expect(http.calls[0]?.url).toBe(
      'http://localhost:8000/api/v1/courses?page=1&page_size=100',
    )
  })

  it('escapes the course id in the content path', async () => {
    const { http, api } = setup()
    http.on('/content', { json: { course_id: 'x' } })

    await api.getCourseContent('a/b c')

    expect(http.calls[0]?.url).toBe(
      'http://localhost:8000/api/v1/courses/a%2Fb%20c/content',
    )
  })

  it('goes through the FE-02 client, so every call carries the bearer token', async () => {
    const { http, api } = setup()
    http.on('/me/enrollments', { json: page([]) })

    await api.listEnrollments()

    expect(http.calls[0]?.headers.authorization).toBe('Bearer access-1')
  })

  it('never asks the backend who the user is', async () => {
    const { http, api } = setup()
    http.on('/me/enrollments', { json: page([]) })
    http.on('/courses', { json: page([]) })

    await Promise.all([api.listEnrollments(), api.listPublishedCourses()])

    expect(http.calls.filter((call) => call.url.includes('/auth/me'))).toEqual([])
  })

  it('passes an abort signal through, so an unmount cancels the request', async () => {
    const { http, api } = setup()
    const controller = new AbortController()
    http.failNetwork('/me/enrollments', new DOMException('Aborted', 'AbortError'))
    controller.abort()

    await expect(api.listEnrollments(controller.signal)).rejects.toBeInstanceOf(DOMException)
  })
})
