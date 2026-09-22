import { useCallback, useEffect, useMemo, useRef } from 'react'

import { useApiClient } from '../../api'
import type { UUID } from '../../api'

import { createCoursesApi, type LearningEventInput } from './api'

/**
 * Sends one learning event, and forgets about it (FE-LEARNING-TRACKING-01).
 *
 * Tracking never stands in the way of learning: nothing waits for the answer,
 * nothing retries, and a refusal or a dropped connection is dropped silently.
 * The authenticated client adds the credentials, as for every other request.
 */
export function useRecordLearningEvent(): (event: LearningEventInput) => void {
  const client = useApiClient()
  const api = useMemo(() => createCoursesApi(client), [client])
  return useCallback(
    (event: LearningEventInput) => {
      void api.recordLearningEvent(event).catch(() => undefined)
    },
    [api],
  )
}

/**
 * Records that `event` was opened, once for each thing opened.
 *
 * "Once" is keyed by what was opened, not by renders: a re-render, a changed
 * unrelated state, or React Strict Mode running the effect twice all see the
 * same key and send nothing more, because the key survives in a ref for as long
 * as the component stays mounted. Opening something else changes the key and
 * sends; leaving the page and coming back is a new mount, a new ref, and a new
 * event. `null` records nothing - the page is not showing it yet.
 */
export function useLearningEventOnOpen(
  event:
    | { type: 'course_opened'; courseId: UUID }
    | { type: 'lesson_opened'; courseId: UUID; moduleId: UUID; lessonId: UUID }
    | null,
): void {
  const record = useRecordLearningEvent()
  const sent = useRef<string | null>(null)

  const type = event?.type ?? null
  const courseId = event?.courseId ?? null
  const moduleId = event?.type === 'lesson_opened' ? event.moduleId : null
  const lessonId = event?.type === 'lesson_opened' ? event.lessonId : null

  useEffect(() => {
    if (type === null || courseId === null) return
    const key = `${type}:${courseId}:${moduleId ?? ''}:${lessonId ?? ''}`
    if (sent.current === key) return
    sent.current = key
    record(
      type === 'lesson_opened' && moduleId !== null && lessonId !== null
        ? { type, course_id: courseId, module_id: moduleId, lesson_id: lessonId }
        : { type: 'course_opened', course_id: courseId },
    )
  }, [record, type, courseId, moduleId, lessonId])
}
