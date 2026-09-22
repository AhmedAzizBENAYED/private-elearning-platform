import { buildUrl } from './config'
import { ApiError, NetworkError, toApiError } from './errors'
import type { UploadProgress } from './uploadProgress'

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export interface RequestOptions {
  method?: HttpMethod
  /** Serialized as JSON and sent with `Content-Type: application/json`. */
  json?: unknown
  /** Pre-built body for the cases JSON cannot express (uploads, later tickets). */
  body?: BodyInit
  headers?: Record<string, string>
  signal?: AbortSignal
  /**
   * Reports how much of the request body has been sent (G33).
   *
   * `fetch` has no request-side progress event, so a request that asks for
   * this one is carried by `XMLHttpRequest` instead - the only browser API
   * that measures an upload. Everything around the round trip stays shared:
   * the same URL, headers, body, abort handling and error normalization, so
   * the caller cannot tell the two transports apart except by the progress it
   * receives. Every request that does not ask keeps using `fetch`.
   */
  onUploadProgress?: (progress: UploadProgress) => void
}

export interface HttpClient {
  readonly baseUrl: string
  request: <T>(path: string, options?: RequestOptions) => Promise<T>
  /**
   * Reads a response body as binary instead of JSON.
   *
   * Exists for the one endpoint whose body is a file rather than a document:
   * `GET /lessons/{id}/resource/content`. A DOCUMENT lesson's URL carries no
   * token - only VIDEO gets a playback token - so its bytes can only be reached
   * by a request that sends the Authorization header, which rules out handing
   * the URL straight to an `<iframe>` or an `<a download>`.
   *
   * Errors are normalized exactly as `request` normalizes them: the failure
   * body is still JSON, and is still parsed by `parseBody`.
   */
  blob: (path: string, options?: RequestOptions) => Promise<Blob>
}

export interface HttpClientConfig {
  baseUrl: string
  /** Injectable so tests never touch the network. */
  fetchImpl?: typeof fetch
  /** The same, for the uploads that report progress. */
  xhrImpl?: () => XMLHttpRequest
}

/** The statuses whose response cannot carry a body, per the Fetch standard. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304])

/** `getAllResponseHeaders()` as a `Headers`, so `parseBody` reads both transports alike. */
function responseHeaders(xhr: XMLHttpRequest): Headers {
  const headers = new Headers()
  for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
    const colon = line.indexOf(':')
    if (colon > 0) headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }
  return headers
}

function abortError(): DOMException {
  return new DOMException('The request was aborted', 'AbortError')
}

/**
 * Reads the response body.
 *
 * 204 and empty bodies resolve to `undefined`, which is what
 * `POST /auth/setup-password` and every `DELETE` return. A body that claims to
 * be JSON but does not parse is a protocol failure, not a silent `undefined`.
 */
async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined

  const text = await response.text()
  if (text === '') return undefined

  const contentType = response.headers.get('Content-Type') ?? ''
  if (!contentType.includes('json')) return text

  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ApiError(response.status, 'The server returned a malformed response', {
      body: text,
    })
  }
}

/**
 * The transport layer: URL building, JSON encoding, error normalization.
 *
 * Deliberately knows nothing about authentication. It never adds an
 * Authorization header of its own and never retries, so the two unauthenticated
 * auth endpoints can use it directly without any risk of recursing into the
 * refresh machinery.
 */
export function createHttpClient({ baseUrl, fetchImpl, xhrImpl }: HttpClientConfig): HttpClient {
  // Resolved per call so a test can install a stub after construction, and so
  // `fetch` keeps its correct `this`.
  const doFetch: typeof fetch = (input, init) => (fetchImpl ?? globalThis.fetch)(input, init)

  /**
   * The same round trip as `doFetch`, carried by `XMLHttpRequest` so the body's
   * progress can be observed. It settles exactly as `fetch` does - a
   * `Response` for any status, a `TypeError` for a dropped connection, an
   * `AbortError` when the signal fires - so `send` below handles its outcome
   * with the very same code.
   *
   * It first reports `{ loaded: 0, total: null }`: a transfer is starting and
   * its extent is not known yet. On a replay after a refresh that also says
   * the bytes are being sent again from the beginning, which they are.
   */
  function doXhr(
    url: string,
    init: { method: HttpMethod; headers: Record<string, string>; body: BodyInit | undefined; signal?: AbortSignal },
    onUploadProgress: (progress: UploadProgress) => void,
  ): Promise<Response> {
    return new Promise((resolve, reject) => {
      const { signal } = init
      if (signal?.aborted) {
        reject(abortError())
        return
      }

      const xhr = xhrImpl ? xhrImpl() : new XMLHttpRequest()
      xhr.open(init.method, url)
      // An ArrayBuffer becomes a `Response` body as it is, whatever it holds;
      // `parseBody` and `.blob()` then read it exactly as a fetched body.
      xhr.responseType = 'arraybuffer'
      // `credentials: 'omit'`, as on the fetch path.
      xhr.withCredentials = false
      for (const [name, value] of Object.entries(init.headers)) xhr.setRequestHeader(name, value)

      const onAbort = () => xhr.abort()
      signal?.addEventListener('abort', onAbort, { once: true })
      const settle = () => signal?.removeEventListener('abort', onAbort)

      // Registered before `send`: upload events are only dispatched to
      // listeners that exist when the transfer starts.
      xhr.upload.addEventListener('progress', (event) => {
        onUploadProgress({ loaded: event.loaded, total: event.lengthComputable ? event.total : null })
      })
      xhr.addEventListener('load', () => {
        settle()
        const body = NULL_BODY_STATUSES.has(xhr.status) ? null : (xhr.response as ArrayBuffer | null)
        resolve(
          new Response(body, {
            status: xhr.status,
            statusText: xhr.statusText,
            headers: responseHeaders(xhr),
          }),
        )
      })
      const fail = () => {
        settle()
        reject(new TypeError('Network request failed'))
      }
      xhr.addEventListener('error', fail)
      xhr.addEventListener('timeout', fail)
      xhr.addEventListener('abort', () => {
        settle()
        reject(abortError())
      })

      onUploadProgress({ loaded: 0, total: null })
      xhr.send((init.body ?? null) as XMLHttpRequestBodyInit | null)
    })
  }

  /**
   * One round trip, up to the point a body has to be interpreted.
   *
   * Both readers below share it, so authentication headers, URL building, JSON
   * encoding, abort handling and error normalization are written once and
   * cannot drift apart between the JSON and the binary path.
   */
  async function send(path: string, options: RequestOptions, accept: string): Promise<Response> {
    const { method = 'GET', json, body, headers = {}, signal, onUploadProgress } = options

    const requestHeaders: Record<string, string> = { Accept: accept, ...headers }
    let requestBody: BodyInit | undefined = body

    if (json !== undefined) {
      requestHeaders['Content-Type'] = 'application/json'
      requestBody = JSON.stringify(json)
    }

    let response: Response
    try {
      response =
        onUploadProgress === undefined
          ? await doFetch(buildUrl(baseUrl, path), {
              method,
              headers: requestHeaders,
              body: requestBody,
              signal,
              // Tokens travel in the Authorization header, never in cookies, and the
              // backend sets `allow_credentials=False`. Sending credentials would
              // make every cross-origin request fail preflight.
              credentials: 'omit',
            })
          : await doXhr(
              buildUrl(baseUrl, path),
              { method, headers: requestHeaders, body: requestBody, signal },
              onUploadProgress,
            )
    } catch (cause) {
      // An abort is the caller's own decision; let it through untouched.
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
      throw new NetworkError(cause)
    }

    if (!response.ok) {
      throw toApiError(response.status, response.statusText, await parseBody(response))
    }

    return response
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return (await parseBody(await send(path, options, 'application/json'))) as T
  }

  /**
   * The binary reader.
   *
   * The Accept header is widened from `application/json`, because the expected
   * reply is a PDF. The `Blob` keeps the server's own `Content-Type`, so a
   * caller never has to guess the media type of what it just read.
   */
  async function blob(path: string, options: RequestOptions = {}): Promise<Blob> {
    return await (await send(path, options, '*/*')).blob()
  }

  return { baseUrl, request, blob }
}
