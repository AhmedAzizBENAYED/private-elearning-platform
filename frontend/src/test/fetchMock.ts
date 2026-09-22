import { vi } from 'vitest'

/**
 * A minimal controlled `fetch`.
 *
 * Deliberately not MSW: these tests assert on the exact request the client
 * builds (URL, method, headers, body) and on call ordering and counts. A
 * recorded call list is a more direct way to express that than a request
 * interceptor, and it adds no dependency.
 *
 * Uploads that report progress travel by `XMLHttpRequest` (G33), so the mock
 * also hands out a matching `xhr` factory. It is the same mock, not a second
 * one: an XHR call is recorded in the same `calls`, answered by the same
 * routes, and fails by the same `failNetwork`, so every existing assertion on
 * an upload holds whichever transport carried it.
 */

export interface RecordedCall {
  url: string
  method: string
  headers: Record<string, string>
  body: string | undefined
  /**
   * The multipart body, when the request carried one.
   *
   * An upload's body is a `FormData`, not a string, so `body` above stays
   * `undefined` for it. Keeping the object itself lets a test assert the part
   * name and the exact `File` that was sent, which is the whole point of the
   * upload tests - and it also proves the client set no `Content-Type` of its
   * own, leaving the browser to generate the multipart boundary.
   */
  formData: FormData | undefined
  /**
   * The abort signal the caller attached, when it attached one.
   *
   * The mock does not honour it - a stubbed response resolves either way - but
   * keeping it lets a test assert that a request is cancellable at all, which
   * is what makes an unmounted component's response get dropped rather than
   * land on a dead component.
   */
  signal: AbortSignal | undefined
  /** Which browser API carried the request. */
  transport: 'fetch' | 'xhr'
  /**
   * XHR calls only: dispatches an upload `progress` event, as the browser does
   * while the body leaves. A route handler calls it to script a transfer -
   * `lengthComputable: false` for a body whose size cannot be measured. It is
   * a no-op once the call is answered or aborted, as a real XHR is.
   */
  reportUploadProgress?: (loaded: number, total: number, lengthComputable?: boolean) => void
}

export interface MockResponse {
  status?: number
  /** Serialized as JSON unless `text` or `bytes` is given. */
  json?: unknown
  /** Raw body, for malformed-payload tests. */
  text?: string
  /** A binary body, for the endpoints that answer with a file. */
  bytes?: Uint8Array
  contentType?: string | null
  statusText?: string
}

/** A handler decides the reply for one call; `undefined` falls through. */
export type RouteHandler = (call: RecordedCall) => MockResponse | Promise<MockResponse>

function buildResponse({
  status = 200,
  json,
  text,
  bytes,
  contentType,
  statusText = '',
}: MockResponse): Response {
  if (bytes !== undefined) {
    const headers = new Headers()
    if (contentType !== null) headers.set('Content-Type', contentType ?? 'application/octet-stream')
    // A copy, so a fixture reused across tests cannot be detached by one of
    // them reading the body.
    return new Response(new Uint8Array(bytes), { status, statusText, headers })
  }

  const body = text !== undefined ? text : json === undefined ? '' : JSON.stringify(json)

  const headers = new Headers()
  const resolvedType =
    contentType === null
      ? null
      : (contentType ?? (text !== undefined ? 'text/plain' : 'application/json'))
  if (resolvedType !== null && body !== '') headers.set('Content-Type', resolvedType)

  return new Response(status === 204 || body === '' ? null : body, {
    status,
    statusText,
    headers,
  })
}

export interface FetchMock {
  fetch: typeof fetch
  /** The `XMLHttpRequest` factory for `createHttpClient({ xhrImpl })`. */
  xhr: () => XMLHttpRequest
  calls: RecordedCall[]
  /** Calls whose URL PATH ends with `suffix`; query strings are ignored. */
  callsTo: (suffix: string) => RecordedCall[]
  /** Replies to every call whose path ends with `suffix`; newest route wins. */
  on: (suffix: string, response: MockResponse | RouteHandler) => void
  /** Replies once, then falls through to the standing route. */
  once: (suffix: string, response: MockResponse | RouteHandler) => void
  /** Makes the next matching call reject, simulating a dropped connection. */
  failNetwork: (suffix: string, error?: Error) => void
  reset: () => void
}

export function createFetchMock(): FetchMock {
  const calls: RecordedCall[] = []
  const routes = new Map<string, RouteHandler>()
  const onceRoutes = new Map<string, RouteHandler[]>()
  const networkFailures = new Map<string, Error[]>()

  /** The request path, without the query string. */
  function pathOf(url: string): string {
    try {
      return new URL(url, 'http://localhost').pathname
    } catch {
      return url.split('?')[0] ?? url
    }
  }

  function match(url: string, keys: Iterable<string>): string | undefined {
    // Suffix-match the PATH, so a route matches whether or not the request
    // carries query parameters. Longest suffix wins, so "/auth/me" cannot
    // shadow a more specific route.
    const path = pathOf(url)
    let best: string | undefined
    for (const key of keys) {
      if (path.endsWith(key) && (best === undefined || key.length > best.length)) best = key
    }
    return best
  }

  /** Answers one recorded call from the routes; rejects like a dropped connection. */
  async function respond(call: RecordedCall): Promise<Response> {
    const { url } = call

    const failureKey = match(url, networkFailures.keys())
    if (failureKey !== undefined) {
      const queue = networkFailures.get(failureKey) ?? []
      const error = queue.shift()
      if (queue.length === 0) networkFailures.delete(failureKey)
      if (error) throw error
    }

    const onceKey = match(url, onceRoutes.keys())
    if (onceKey !== undefined) {
      const queue = onceRoutes.get(onceKey) ?? []
      const handler = queue.shift()
      if (queue.length === 0) onceRoutes.delete(onceKey)
      if (handler) return buildResponse(await handler(call))
    }

    const key = match(url, routes.keys())
    const handler = key === undefined ? undefined : routes.get(key)
    if (handler === undefined) {
      throw new Error(`fetchMock: no route for ${call.method} ${url}`)
    }

    return buildResponse(await handler(call))
  }

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })

    const call: RecordedCall = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
      formData: init?.body instanceof FormData ? init.body : undefined,
      signal: init?.signal ?? undefined,
      transport: 'fetch',
    }
    calls.push(call)

    return respond(call)
  }) as unknown as typeof fetch

  /**
   * The subset of `XMLHttpRequest` the transport uses, answered by `respond`.
   *
   * Events are real `ProgressEvent`s on real `EventTarget`s, dispatched
   * asynchronously as a browser does. A dropped connection (or a missing
   * route) is an `error` event, `abort()` an `abort` event, and nothing is
   * dispatched after either.
   */
  class MockXhr extends EventTarget {
    readonly upload = new EventTarget()
    status = 0
    statusText = ''
    response: ArrayBuffer | Blob | string | null = null
    responseType: XMLHttpRequestResponseType = ''
    withCredentials = false
    private method = 'GET'
    private url = ''
    private readonly requestHeaders: Record<string, string> = {}
    private received = new Headers()
    private settled = false

    open(method: string, url: string | URL): void {
      this.method = method
      this.url = url.toString()
    }

    setRequestHeader(name: string, value: string): void {
      this.requestHeaders[name.toLowerCase()] = value
    }

    getAllResponseHeaders(): string {
      let lines = ''
      this.received.forEach((value, name) => {
        lines += `${name}: ${value}\r\n`
      })
      return lines
    }

    abort(): void {
      if (this.settled) return
      this.settled = true
      this.dispatchEvent(new ProgressEvent('abort'))
    }

    send(body?: Document | XMLHttpRequestBodyInit | null): void {
      const call: RecordedCall = {
        url: this.url,
        method: this.method,
        headers: { ...this.requestHeaders },
        body: typeof body === 'string' ? body : undefined,
        formData: body instanceof FormData ? body : undefined,
        signal: undefined,
        transport: 'xhr',
        reportUploadProgress: (loaded, total, lengthComputable = true) => {
          if (this.settled) return
          this.upload.dispatchEvent(new ProgressEvent('progress', { loaded, total, lengthComputable }))
        },
      }
      calls.push(call)

      void Promise.resolve()
        .then(() => respond(call))
        .then(
          async (response) => {
            const content =
              this.responseType === 'arraybuffer'
                ? await response.arrayBuffer()
                : this.responseType === 'blob'
                  ? await response.blob()
                  : await response.text()
            if (this.settled) return
            this.settled = true
            this.status = response.status
            this.statusText = response.statusText
            this.received = response.headers
            this.response = content
            this.dispatchEvent(new ProgressEvent('load'))
          },
          () => {
            if (this.settled) return
            this.settled = true
            this.dispatchEvent(new ProgressEvent('error'))
          },
        )
    }
  }

  const asHandler = (response: MockResponse | RouteHandler): RouteHandler =>
    typeof response === 'function' ? response : () => response

  return {
    fetch: fetchImpl,
    xhr: () => new MockXhr() as unknown as XMLHttpRequest,
    calls,
    callsTo: (suffix) => calls.filter((call) => pathOf(call.url).endsWith(suffix)),
    on: (suffix, response) => routes.set(suffix, asHandler(response)),
    once: (suffix, response) => {
      const queue = onceRoutes.get(suffix) ?? []
      queue.push(asHandler(response))
      onceRoutes.set(suffix, queue)
    },
    failNetwork: (suffix, error = new TypeError('Failed to fetch')) => {
      const queue = networkFailures.get(suffix) ?? []
      queue.push(error)
      networkFailures.set(suffix, queue)
    },
    reset: () => {
      calls.length = 0
      routes.clear()
      onceRoutes.clear()
      networkFailures.clear()
    },
  }
}
