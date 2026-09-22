import { useCallback, useEffect, useMemo, useState } from 'react'

import { useApiClient } from '../../api'
import type { UUID } from '../../api'

import { createAdminApi, type LessonResource } from './api'
import { lessonAfterUpload } from './resourceModel'
import { byPosition, type ModuleWithLessons } from './structureModel'

export interface CourseStructureState {
  status: 'loading' | 'ready' | 'error'
  modules: ModuleWithLessons[]
  /** Stored files by lesson id. A lesson absent from this map holds no file. */
  resources: Readonly<Record<UUID, LessonResource>>
  /** The resource listing failed; the structure itself is still valid. */
  resourcesFailed: boolean
  /**
   * Record the outcome of an upload or a deletion without re-reading the tree.
   *
   * `null` removes the entry. On an upload the lesson's own duration is
   * updated from the same response - see `lessonAfterUpload` for why that is
   * exact rather than an optimistic guess - so no figure on screen is left
   * contradicting the server.
   */
  applyResource: (lessonId: UUID, resource: LessonResource | null) => void
  /**
   * Replace the tree held on screen with one derived from it - a move the
   * server is being told about, or a deletion it has confirmed - without a
   * round trip that would swap the whole structure for a skeleton.
   */
  update: (change: (modules: ModuleWithLessons[]) => ModuleWithLessons[]) => void
  reload: () => void
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

interface Loaded {
  key: string
  modules: ModuleWithLessons[]
  resources: Record<UUID, LessonResource>
  resourcesFailed: boolean
}

/**
 * A course's modules, their lessons, and the file each lesson holds.
 *
 *   GET /admin/courses/{id}/modules      once
 *   GET /admin/modules/{id}/lessons      once per module
 *   GET /admin/courses/{id}/resources    once
 *
 * The lesson reads are per module because there is no admin endpoint returning
 * the tree: the member `/courses/{id}/content` does, but it requires enrollment
 * and a PUBLISHED course, so it cannot serve a draft being built. The cost is
 * reported as a gap rather than worked around with a guess.
 *
 * The resources, by contrast, cost **one** request for the whole course, not
 * one per lesson: `GET /admin/courses/{id}/resources` returns every stored file
 * in a single aggregate query. No file bytes are transferred - the endpoint
 * reads stored metadata and never contacts the provider - so learning which
 * lessons have a video costs nothing like downloading one.
 *
 * A module whose lessons fail to load still renders, marked, instead of taking
 * the whole structure down. The resource listing is treated the same way: if it
 * alone fails, the structure is shown and the file panels say so, because the
 * modules and lessons were read correctly and hiding them would misrepresent
 * the course.
 */
export function useCourseStructure(courseId: UUID): CourseStructureState {
  const client = useApiClient()
  const api = useMemo(() => createAdminApi(client), [client])

  const [attempt, setAttempt] = useState(0)
  const key = `${courseId}:${attempt}`

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)

  const reload = useCallback(() => setAttempt((previous) => previous + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    void (async () => {
      try {
        // The resource listing is independent of the module tree, so it runs
        // alongside it rather than after it.
        const resourcesPromise = api
          .listCourseResources(courseId, controller.signal)
          .then((items) => ({ items, failed: false }))
          .catch((error: unknown) => {
            if (isAbort(error)) throw error
            return { items: [] as LessonResource[], failed: true }
          })
        // It is awaited below, but only once the modules have loaded: if that
        // read rejects first - an abort on unmount, or a dropped connection -
        // nothing would ever consume this one, and an abort rethrown above
        // would surface as an unhandled rejection. Attaching a handler here
        // marks it handled; the `await` below still sees the same outcome.
        resourcesPromise.catch(() => undefined)

        const page = await api.listModules(courseId, controller.signal)
        const modules = await Promise.all(
          byPosition(page.items).map(async (module) => {
            try {
              const lessons = await api.listLessons(module.id, controller.signal)
              return { module, lessons: byPosition(lessons.items), lessonsFailed: false }
            } catch (error: unknown) {
              if (isAbort(error)) throw error
              return { module, lessons: [], lessonsFailed: true }
            }
          }),
        )

        const { items, failed } = await resourcesPromise
        const resources: Record<UUID, LessonResource> = {}
        for (const item of items) resources[item.lesson_id] = item

        if (active) setLoaded({ key, modules, resources, resourcesFailed: failed })
      } catch (error: unknown) {
        if (isAbort(error) || !active) return
        setFailedKey(key)
      }
    })()

    return () => {
      active = false
      controller.abort()
    }
  }, [api, courseId, key])

  const applyResource = useCallback((lessonId: UUID, resource: LessonResource | null) => {
    setLoaded((previous) => {
      if (previous === null) return previous

      const resources = { ...previous.resources }
      if (resource === null) delete resources[lessonId]
      else resources[lessonId] = resource

      // A VIDEO lesson's duration is reconciled by the upload, so the lesson
      // row is updated from the same response instead of going stale.
      const modules =
        resource === null
          ? previous.modules
          : previous.modules.map((entry) => ({
              ...entry,
              lessons: entry.lessons.map((lesson) =>
                lesson.id === lessonId ? lessonAfterUpload(lesson, resource) : lesson,
              ),
            }))

      return { ...previous, resources, modules }
    })
  }, [])

  const update = useCallback((change: (modules: ModuleWithLessons[]) => ModuleWithLessons[]) => {
    setLoaded((previous) => (previous === null ? previous : { ...previous, modules: change(previous.modules) }))
  }, [])

  const fresh = loaded?.key === key
  const status: CourseStructureState['status'] = fresh
    ? 'ready'
    : failedKey === key
      ? 'error'
      : 'loading'

  return useMemo(
    () => ({
      status,
      modules: fresh && loaded ? loaded.modules : [],
      resources: fresh && loaded ? loaded.resources : {},
      resourcesFailed: fresh && loaded ? loaded.resourcesFailed : false,
      applyResource,
      update,
      reload,
    }),
    [status, fresh, loaded, applyResource, update, reload],
  )
}
