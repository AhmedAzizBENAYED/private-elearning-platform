import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { UUID } from '../../api'

import type { LearningApi, LessonProgress } from './api'

/**
 * How much playback may pass between writes.
 *
 * The backend sets no interval, so this is a frontend choice and is stated
 * rather than buried: 15 seconds bounds what a crash or a closed tab can lose
 * to 15 seconds of watching, and costs about four writes per minute of video -
 * two orders of magnitude fewer than the ~4/second `timeupdate` fires at.
 */
export const SYNC_INTERVAL_SECONDS = 15

/** Backoff for a failed write. Bounded: three tries, then the member is told. */
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000]

/** Whether the playhead has reached a whole second the server has not been told. */
const hasUnsent = (furthest: number, lastSent: number) => Math.floor(furthest) > lastSent

export type SyncStatus = 'idle' | 'saving' | 'retrying' | 'failed'

export interface ProgressSync {
  /** Feed the playhead in; the hook decides whether that warrants a write. */
  report: (seconds: number) => void
  /** Write now, whatever the interval says (pause, seek settled, ended, hidden). */
  flush: () => void
  status: SyncStatus
  /** Retry after the attempts were exhausted. */
  retry: () => void
}

export interface ProgressSyncOptions {
  api: LearningApi
  lessonId: UUID
  /** The backend's own stored position, so the first write cannot go backwards. */
  initialWatchedSeconds: number
  /** Called with the server's answer, which is the only authority on completion. */
  onConfirmed: (progress: LessonProgress) => void
  /** Whether this lesson records progress at all (VIDEO only, per the backend). */
  enabled: boolean
}

/**
 * Writes watched time to the backend, at a controlled rate.
 *
 * ## What is sent
 *
 * `watched_seconds`, and nothing else - `ProgressUpdate` forbids extra fields,
 * and `completed` is server-owned. The value sent is the **furthest position
 * the playhead has reached**, which is what the backend stores:
 * `min(duration, max(stored, sent))`. That has three consequences the player
 * depends on:
 *
 *   - seeking backwards never lowers the recorded position, here or there;
 *   - a repeated write is a no-op, so retrying is always safe;
 *   - completion is decided by the server comparing that figure to the lesson's
 *     duration, never by this code.
 *
 * ## When it is sent
 *
 * Every `SYNC_INTERVAL_SECONDS` of advance during playback, and immediately on
 * pause, on a settled seek, on `ended`, when the tab is hidden, and once on
 * unmount. A write is skipped entirely when the furthest position has not
 * advanced since the last confirmed one, so pausing twice sends one request.
 *
 * ## When it fails
 *
 * Playback is never interrupted. The write is retried three times with
 * backoff; after that `status` is `failed` and the member can retry by hand.
 * Nothing is stored locally as a substitute - the backend stays authoritative,
 * and an unsent position is simply lost, never faked.
 */
export function useProgressSync({
  api,
  lessonId,
  initialWatchedSeconds,
  onConfirmed,
  enabled,
}: ProgressSyncOptions): ProgressSync {
  // Tagged with the lesson it describes, so switching lessons resets the
  // reported status during render rather than through an effect.
  const [reported, setReported] = useState<{ key: UUID; value: SyncStatus }>({
    key: lessonId,
    value: 'idle',
  })
  const status: SyncStatus = reported.key === lessonId ? reported.value : 'idle'

  // Refs, not state: these change several times a second during playback and
  // must never cause a render. `furthest` is the playhead, fractional;
  // `lastSent` is a whole second, as written - so "is there anything new to
  // say" compares the whole second that would be sent (`hasUnsent`), never
  // the fraction, or a pause at 40.6 s would re-send 40 for ever.
  const furthest = useRef(initialWatchedSeconds)
  const lastSent = useRef(initialWatchedSeconds)
  const inFlight = useRef(false)
  const attempt = useRef(0)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Kept in refs so the stable callbacks below always reach the current values
  // without being rebuilt on every render.
  const confirm = useRef(onConfirmed)
  const sendRef = useRef<(value: number, lesson: UUID) => void>(() => undefined)

  useEffect(() => {
    confirm.current = onConfirmed
  }, [onConfirmed])

  // A new lesson starts from that lesson's own stored position.
  useEffect(() => {
    furthest.current = initialWatchedSeconds
    lastSent.current = initialWatchedSeconds
    attempt.current = 0
  }, [lessonId, initialWatchedSeconds])

  const clearRetry = useCallback(() => {
    if (retryTimer.current !== null) {
      clearTimeout(retryTimer.current)
      retryTimer.current = null
    }
  }, [])

  const send = useCallback(
    (value: number, lesson: UUID) => {
      inFlight.current = true
      setReported({ key: lesson, value: attempt.current === 0 ? 'saving' : 'retrying' })

      api.updateLessonProgress(lesson, value).then(
        (progress) => {
          inFlight.current = false
          attempt.current = 0
          // The server clamps to the lesson duration, so its answer - not the
          // value sent - is what has actually been recorded. The value sent
          // still counts as said: sending it again would store the same clamp,
          // and treating it as unsent re-sent it for ever whenever the file ran
          // longer than the lesson's recorded duration.
          lastSent.current = Math.max(lastSent.current, value, progress.watched_seconds)
          furthest.current = Math.max(furthest.current, progress.watched_seconds)
          setReported({ key: lesson, value: 'idle' })
          confirm.current(progress)

          // A flush asked for while this one was in flight was dropped rather
          // than queued behind it, so it is honoured now: one follow-up, not a
          // queue, which keeps `ended` from being lost behind a periodic write.
          if (hasUnsent(furthest.current, lastSent.current)) {
            sendRef.current(Math.floor(furthest.current), lesson)
          }
        },
        () => {
          inFlight.current = false
          const next = RETRY_DELAYS_MS[attempt.current]
          attempt.current += 1

          if (next === undefined) {
            // Out of attempts. Playback continues; the member is told quietly.
            setReported({ key: lesson, value: 'failed' })
            return
          }

          setReported({ key: lesson, value: 'retrying' })
          retryTimer.current = setTimeout(() => {
            retryTimer.current = null
            if (hasUnsent(furthest.current, lastSent.current)) {
              sendRef.current(Math.floor(furthest.current), lesson)
            } else {
              setReported({ key: lesson, value: 'idle' })
            }
          }, next)
        },
      )
    },
    [api],
  )

  useEffect(() => {
    sendRef.current = send
  }, [send])

  const flushFor = useCallback(
    (lesson: UUID) => {
      if (!enabled || inFlight.current) return
      // Nothing new to say: a repeat would be a no-op at the server anyway.
      if (!hasUnsent(furthest.current, lastSent.current)) return
      clearRetry()
      attempt.current = 0
      send(Math.floor(furthest.current), lesson)
    },
    [enabled, clearRetry, send],
  )

  const flush = useCallback(() => flushFor(lessonId), [flushFor, lessonId])

  const report = useCallback(
    (seconds: number) => {
      if (!enabled || !Number.isFinite(seconds) || seconds < 0) return
      // Monotonic: a backward seek moves the playhead, never the record.
      furthest.current = Math.max(furthest.current, seconds)
      if (furthest.current - lastSent.current >= SYNC_INTERVAL_SECONDS) flushFor(lessonId)
    },
    [enabled, flushFor, lessonId],
  )

  const retry = useCallback(() => {
    attempt.current = 0
    flushFor(lessonId)
  }, [flushFor, lessonId])

  // Leaving the tab is the most likely moment to lose a position, so it is
  // treated exactly like a pause.
  useEffect(() => {
    if (!enabled) return

    const onHidden = () => {
      if (document.visibilityState === 'hidden') flushFor(lessonId)
    }

    document.addEventListener('visibilitychange', onHidden)
    return () => document.removeEventListener('visibilitychange', onHidden)
  }, [enabled, flushFor, lessonId])

  // One final, best-effort write when the lesson changes or the page unmounts.
  // Deliberately not aborted: this is the request whose whole purpose is to
  // outlive the component, and it is the only one that does.
  useEffect(() => {
    if (!enabled) return

    return () => {
      clearRetry()
      if (furthest.current > lastSent.current && !inFlight.current) {
        const value = Math.floor(furthest.current)
        lastSent.current = value
        void api.updateLessonProgress(lessonId, value).catch(() => undefined)
      }
    }
  }, [api, enabled, lessonId, clearRetry])

  return useMemo(() => ({ report, flush, status, retry }), [report, flush, status, retry])
}
