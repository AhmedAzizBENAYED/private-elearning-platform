import {
  API_VERSION_PREFIX,
  type ApiClient,
  type CatalogLesson,
  type ContentType,
  type CourseContent,
  type CourseProgress,
  type UUID,
} from '../../api'
import { createCoursesApi } from '../courses/api'

/**
 * `app.schemas.lesson.CatalogLessonContent` - `GET /lessons/{lesson_id}`.
 *
 * `CatalogLesson` plus the one field the course tree does not carry. `content`
 * is the real text for a TEXT lesson and the URL for a LINK lesson, and is
 * **always null for VIDEO and DOCUMENT**: `LessonService.catalog_get` blanks it
 * for those, because their payload is an internal storage reference that means
 * nothing to a client. Files are reached through the resource endpoint instead.
 */
export interface CatalogLessonContent extends CatalogLesson {
  content: string | null
}

/**
 * `app.schemas.resource.MemberResourceResponse` - `GET /lessons/{id}/resource`.
 *
 * `download_url` always points back at this API ("never at the provider, so
 * switching providers cannot change the client contract"), and for a VIDEO
 * lesson it already carries a short-lived, lesson-scoped `playback_token`,
 * because a media element cannot send an Authorization header. No provider
 * URL, storage key or credential appears on this shape at all.
 */
export interface MemberResource {
  lesson_id: UUID
  resource_id: UUID
  content_type: ContentType
  filename: string
  mime_type: string
  size_bytes: number
  duration_seconds: number | null
  /** API-relative, already including `/api/v1`. */
  download_url: string
}

/**
 * `app.schemas.progress.ProgressResponse` - what a progress write returns.
 *
 * `completed` and `completed_at` are server-owned: the client cannot set them,
 * and `ProgressUpdate` forbids extra fields, so the only thing ever sent is
 * `watched_seconds`.
 */
export interface LessonProgress {
  lesson_id: UUID
  watched_seconds: number
  duration_seconds: number | null
  completed: boolean
  completed_at: string | null
}

export interface LearningApi {
  getCourseContent: (courseId: UUID, signal?: AbortSignal) => Promise<CourseContent>
  getLesson: (lessonId: UUID, signal?: AbortSignal) => Promise<CatalogLessonContent>
  getLessonResource: (lessonId: UUID, signal?: AbortSignal) => Promise<MemberResource>
  updateLessonProgress: (
    lessonId: UUID,
    watchedSeconds: number,
    signal?: AbortSignal,
  ) => Promise<LessonProgress>
  /** Course-level aggregate, for the one case the tree is stale (see below). */
  getCourseProgress: (courseId: UUID, signal?: AbortSignal) => Promise<CourseProgress>
  /** Absolute URL for a media element's `src`. */
  mediaUrl: (downloadUrl: string) => string
  /** The file itself, for the kinds whose URL cannot be handed to the browser. */
  getResourceContent: (downloadUrl: string, signal?: AbortSignal) => Promise<Blob>
}

/**
 * Turns the backend's `download_url` back into a path the client can request.
 *
 * `MemberResourceResponse.download_url` is absolute within the API
 * (`/api/v1/lessons/...`), while `client.request` and `client.blob` take a
 * version-relative path and add the prefix themselves. Stripping it here keeps
 * the backend's own URL as the single source of truth for where the bytes are,
 * rather than rebuilding that path from the lesson id and hoping the two agree.
 */
export function resourcePath(downloadUrl: string): string {
  return downloadUrl.startsWith(API_VERSION_PREFIX)
    ? downloadUrl.slice(API_VERSION_PREFIX.length)
    : downloadUrl
}

/**
 * The two reads the learning page makes.
 *
 * `getCourseContent` is FE-06's, reused rather than rewritten, so there is one
 * definition of that request in the codebase.
 */
export function createLearningApi(client: ApiClient): LearningApi {
  const courses = createCoursesApi(client)

  return {
    getCourseContent: courses.getCourseContent,

    /**
     * `GET /lessons/{id}` - one lesson's own content.
     *
     * Gated by `catalog_access` and a PUBLISHED parent course. Read only for
     * the selected lesson, and only when that lesson is a kind whose content
     * actually comes back (TEXT, LINK).
     */
    getLesson: (lessonId, signal) =>
      client.request<CatalogLessonContent>(`/lessons/${lessonId}`, { signal }),

    /**
     * `GET /lessons/{id}/resource` - where the lesson's file can be read.
     *
     * Requires enrollment (`LearningUser` + `_authorized`). Fetched through the
     * authenticated client like everything else; only the URL it returns is
     * handed to the browser.
     */
    getLessonResource: (lessonId, signal) =>
      client.request<MemberResource>(`/lessons/${lessonId}/resource`, { signal }),

    /**
     * `PUT /lessons/{id}/progress` - record watched time.
     *
     * The body is exactly `{ watched_seconds }`: `ProgressUpdate` sets
     * `extra="forbid"`, so sending `completed` would be a 422. The server
     * stores `min(duration, max(stored, sent))` - monotonic and clamped - and
     * decides completion itself. 409 when the lesson is not a VIDEO, the course
     * is not PUBLISHED, or its duration is not configured.
     */
    updateLessonProgress: (lessonId, watchedSeconds, signal) =>
      client.request<LessonProgress>(`/lessons/${lessonId}/progress`, {
        method: 'PUT',
        json: { watched_seconds: watchedSeconds },
        signal,
      }),

    /**
     * `GET /courses/{id}/progress` - the course aggregate alone.
     *
     * Read only after the backend confirms a lesson has just become complete:
     * the progress response describes one lesson, and this is the smallest
     * request that refreshes the course figures from the server rather than
     * recomputing them here.
     */
    getCourseProgress: (courseId, signal) =>
      client.request<CourseProgress>(`/courses/${courseId}/progress`, { signal }),

    /**
     * The backend's `download_url`, made absolute against the API origin.
     *
     * This is the only URL in the application that carries a credential, and it
     * is not the session's: the playback token is minted per lesson, expires in
     * minutes, and authenticates nothing but this one lesson's bytes. The
     * access and refresh tokens never appear in a URL.
     */
    mediaUrl: (downloadUrl) => `${client.baseUrl}${downloadUrl}`,

    /**
     * `GET /lessons/{id}/resource/content` - the file's bytes.
     *
     * A DOCUMENT lesson's `download_url` carries no token: `member_resource`
     * appends a `playback_token` for VIDEO only, and `content` rejects a
     * playback token for anything but VIDEO ("A playback token authorizes video
     * streaming only, never documents"). So the URL cannot be given to an
     * `<iframe>`, an `<a download>` or `window.open` - the request has to send
     * the Authorization header, which only this client can do.
     *
     * What comes back is a `Blob`. The caller turns it into a same-origin
     * object URL the browser can render natively; no base64, no library, and
     * the bytes are released the moment the member leaves the lesson.
     */
    getResourceContent: (downloadUrl, signal) =>
      client.blob(resourcePath(downloadUrl), { signal }),
  }
}
