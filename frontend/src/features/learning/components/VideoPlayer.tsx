import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { CourseContentLesson } from '../../../api'
import { Button, Icon } from '../../../design-system'
import { formatDuration } from '../../courses'
import type { LearningApi, LessonProgress } from '../api'
import { resumePosition } from '../model'
import { useProgressSync } from '../useProgressSync'
import { useVideoResource } from '../useVideoResource'

import styles from './VideoPlayer.module.css'

export interface VideoPlayerProps {
  api: LearningApi
  lesson: CourseContentLesson
  /** Rendered in the ended panel, as "Up next". */
  nextLessonTitle: string | null
  onNext: (() => void) | null
  onProgressConfirmed: (progress: LessonProgress) => void
}

type PlaybackState = 'idle' | 'ready' | 'playing' | 'paused' | 'ended'

/** DS 08 / Learning-Video-States: "← → seek 5 s". */
export const SEEK_STEP_SECONDS = 5

/** `mm:ss`, reusing the course formatter so the player and the outline agree. */
const clock = (seconds: number) => formatDuration(Number.isFinite(seconds) ? seconds : 0) ?? '00:00'

/**
 * The lesson video (DS 08 "Video player container": 16:9, dark, custom
 * controls, "Source is always a backend URL").
 *
 * A plain `<video src>` streaming from the backend: the browser issues its own
 * Range requests and buffers what it needs, so the file is never pulled into
 * JavaScript memory and a 122 MB lesson starts playing in seconds. There is no
 * player library and no manual byte fetching.
 *
 * The states are the Learning-Video-States board's, all drawn inside the same
 * 16:9 frame so the page never jumps between them:
 *
 *   loading    the media URL is on its way - "Loading video…"
 *   paused     the frame with the round "Play video" button over it
 *   playing    the controls alone
 *   buffering  "Buffering…" over the picture, controls still there, and the
 *              button still says Pause: the member asked to play
 *   error      "This video can’t be played", with Try again
 *   ended      "Lesson completed", Replay and Next lesson - shown only once
 *              the backend has confirmed the lesson complete. The end of the
 *              file is reported like any other position; the server alone
 *              decides completion, so until it says so the video has simply
 *              stopped.
 *
 * The controls sit over the bottom of the frame, as DS 08 draws them, so they
 * are part of what goes fullscreen. Every one is a native button or range
 * input: Tab reaches each, Enter and Space press the buttons. While focus is
 * inside the player the board's shortcuts apply - Space or K play/pause (Space
 * still presses a focused button), ← → seek 5 s, F fullscreen, M mute - and
 * nothing is captured from the rest of the page.
 *
 * This component owns the media element and its controls. It owns no network
 * code: the resource URL comes from `useVideoResource` and progress goes out
 * through `useProgressSync`, both of which talk to the learning API.
 */
export function VideoPlayer({
  api,
  lesson,
  nextLessonTitle,
  onNext,
  onProgressConfirmed,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<HTMLDivElement | null>(null)
  const playRef = useRef<HTMLButtonElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  /** Whether keyboard or pointer focus was last inside the player. */
  const focusInside = useRef(false)

  // `has_resource` is the backend's own answer to "is there a file?", so a
  // lesson with nothing uploaded is never asked for - the request would only
  // 404, and the member would see a failure rather than the truth.
  const hasResource = lesson.has_resource
  const { status: resourceStatus, src, reload } = useVideoResource(api, lesson.id, hasResource)

  const [state, setState] = useState<PlaybackState>('idle')
  const [buffering, setBuffering] = useState(false)
  const [mediaError, setMediaError] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(lesson.duration_seconds ?? 0)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  const sync = useProgressSync({
    api,
    lessonId: lesson.id,
    initialWatchedSeconds: lesson.watched_seconds ?? 0,
    onConfirmed: onProgressConfirmed,
    // Only VIDEO lessons record progress; the backend answers 409 for any other
    // kind, so nothing is attempted for them.
    enabled: lesson.content_type === 'VIDEO',
  })

  const onLoadedMetadata = useCallback(() => {
    const video = videoRef.current
    if (video === null) return

    const known = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0
    setDuration(known || (lesson.duration_seconds ?? 0))

    // Resume only once metadata is in: before that, `currentTime` is not
    // settable and `duration` is NaN.
    const resume = resumePosition(lesson.watched_seconds, lesson.completed, known)
    if (resume > 0) video.currentTime = resume
    setCurrentTime(video.currentTime)
    setState('ready')
  }, [lesson.watched_seconds, lesson.completed, lesson.duration_seconds])

  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current
    if (video === null) return
    setCurrentTime(video.currentTime)
    // The hook decides whether this warrants a request; most do not.
    sync.report(video.currentTime)
  }, [sync])

  const onEnded = useCallback(() => {
    setState('ended')
    setBuffering(false)
    const video = videoRef.current
    // Report the end explicitly, so the server's own completion threshold
    // (duration - tolerance) is met by a real figure rather than by rounding.
    if (video !== null) sync.report(video.duration)
    sync.flush()
  }, [sync])

  const onPause = useCallback(() => {
    setState((previous) => (previous === 'ended' ? previous : 'paused'))
    setBuffering(false)
    sync.flush()
  }, [sync])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (video === null) return
    if (video.paused) void video.play()?.catch(() => setMediaError(true))
    else video.pause()
  }, [])

  const seekTo = useCallback(
    (target: number) => {
      const video = videoRef.current
      const clamped = Math.min(Math.max(target, 0), duration > 0 ? duration : target)
      setCurrentTime(clamped)
      if (video !== null) video.currentTime = clamped
    },
    [duration],
  )

  const onSeek = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => seekTo(Number(event.target.value)),
    [seekTo],
  )

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    if (video === null) return
    video.muted = !video.muted
    setMuted(video.muted)
  }, [])

  const toggleFullscreen = useCallback(() => {
    const frame = frameRef.current
    if (frame === null) return
    // `!` rather than `=== null`: a browser without the Fullscreen API has no
    // such property at all, and must still be asked to enter it.
    if (!document.fullscreenElement) void frame.requestFullscreen?.().catch(() => undefined)
    else void document.exitFullscreen?.().catch(() => undefined)
  }, [])

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const playing = state === 'playing'
  const showError = hasResource && (resourceStatus === 'error' || mediaError)
  // Completion is the server's word, carried back into `lesson` by the page.
  const showEnded = state === 'ended' && lesson.completed
  const showControls = hasResource && !showError && src !== null && !showEnded

  // A control that vanishes with the state it served - the round Play button
  // once playback starts, the controls under "Lesson completed", Replay once it
  // is pressed - would drop keyboard focus onto the page. When focus was in
  // the player, it lands on what replaced it: the panel's first action, or
  // Play/Pause. Nothing moves when focus is elsewhere.
  useLayoutEffect(() => {
    if (!focusInside.current) return
    const active = document.activeElement
    if (active !== null && active !== document.body && playerRef.current?.contains(active)) return
    const next = overlayRef.current?.querySelector<HTMLElement>('[data-autofocus]') ?? playRef.current
    next?.focus()
  })

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!showControls || event.altKey || event.ctrlKey || event.metaKey) return
      const onButton = (event.target as HTMLElement).tagName === 'BUTTON'
      switch (event.key) {
        case ' ':
          // A focused button keeps Space as its own activation.
          if (onButton) return
          togglePlay()
          break
        case 'k':
        case 'K':
          togglePlay()
          break
        case 'ArrowLeft':
          seekTo((videoRef.current?.currentTime ?? currentTime) - SEEK_STEP_SECONDS)
          break
        case 'ArrowRight':
          seekTo((videoRef.current?.currentTime ?? currentTime) + SEEK_STEP_SECONDS)
          break
        case 'f':
        case 'F':
          toggleFullscreen()
          break
        case 'm':
        case 'M':
          toggleMute()
          break
        default:
          return
      }
      event.preventDefault()
    },
    [showControls, togglePlay, seekTo, toggleFullscreen, toggleMute, currentTime],
  )

  let overlay: React.ReactNode = null
  if (!hasResource) {
    overlay = (
      <div className={styles.overlay}>
        <span className={styles.overlayGlyph} aria-hidden="true">
          <Icon name="video" size={28} />
        </span>
        <p className={styles.overlayBody}>No video file has been uploaded for this lesson yet.</p>
      </div>
    )
  } else if (showError) {
    overlay = (
      <div ref={overlayRef} className={[styles.overlay, styles.errorOverlay].join(' ')} role="alert">
        <Icon name="alert" size={32} className={styles.stateIcon} />
        <h2 className={styles.overlayTitle}>This video can’t be played</h2>
        <p className={styles.overlayBody}>
          The video failed to load. Check your connection and try again. If the problem continues, contact
          an administrator.
        </p>
        <div className={styles.overlayActions}>
          <Button
            data-autofocus
            variant="on-dark"
            iconLeft="refresh"
            onClick={() => {
              setMediaError(false)
              reload()
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    )
  } else if (src === null) {
    overlay = (
      <div className={[styles.overlay, styles.dimmed].join(' ')} role="status">
        <Icon name="spinner" size={32} className={styles.spinner} />
        <p className={styles.stateLabel}>Loading video…</p>
      </div>
    )
  } else if (showEnded) {
    overlay = (
      <div ref={overlayRef} className={[styles.overlay, styles.dimmed].join(' ')} role="status">
        <span className={styles.doneBadge} aria-hidden="true">
          <Icon name="check" size={28} />
        </span>
        <h2 className={styles.endedTitle}>Lesson completed</h2>
        {nextLessonTitle === null ? null : <p className={styles.overlayBody}>{`Up next: ${nextLessonTitle}`}</p>}
        <div className={styles.overlayActions}>
          <Button
            data-autofocus={onNext === null ? true : undefined}
            variant="ghost-dark"
            iconLeft="refresh"
            onClick={() => {
              const video = videoRef.current
              if (video === null) return
              video.currentTime = 0
              setState('ready')
              void video.play()?.catch(() => undefined)
            }}
          >
            Replay
          </Button>
          {/* Never automatic: the member decides when to move on. */}
          {onNext === null ? null : (
            <Button data-autofocus variant="on-dark" iconRight="arrow-right" onClick={onNext}>
              Next lesson
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={styles.wrapper}
      ref={playerRef}
      onFocus={() => {
        focusInside.current = true
      }}
      onBlur={(event) => {
        // A focused control that is removed fires no blur; one left for
        // another part of the page does, with that part as `relatedTarget`.
        const to = event.relatedTarget as Node | null
        if (to === null || !event.currentTarget.contains(to)) focusInside.current = false
      }}
    >
      <div className={styles.frame} ref={frameRef} onKeyDown={onKeyDown}>
        {hasResource && !showError && src !== null ? (
          <video
            ref={videoRef}
            className={styles.video}
            src={src}
            // `metadata` gets duration and the first frame without pulling the
            // file down; the browser fetches the rest by Range as it plays.
            preload="metadata"
            playsInline
            aria-label={`Video lesson: ${lesson.title}`}
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={onTimeUpdate}
            onPlay={() => setState('playing')}
            onPlaying={() => {
              setState('playing')
              setBuffering(false)
            }}
            onPause={onPause}
            onWaiting={() => {
              // Stalled by the network while playing - not a pause.
              if (videoRef.current !== null && !videoRef.current.paused) setBuffering(true)
            }}
            onSeeked={() => {
              if (videoRef.current?.paused) setBuffering(false)
              sync.flush()
            }}
            onEnded={onEnded}
            onError={() => setMediaError(true)}
          />
        ) : null}

        {overlay}

        {showControls ? (
          <>
            <span className={styles.shade} aria-hidden="true" />
            {buffering ? (
              <div className={styles.buffering} role="status">
                <Icon name="spinner" size={32} className={styles.spinner} />
                <p className={styles.stateLabel}>Buffering…</p>
              </div>
            ) : playing ? null : (
              <div className={styles.center}>
                <button type="button" className={styles.bigPlay} onClick={togglePlay} aria-label="Play video">
                  <Icon name="play-filled" size={24} />
                </button>
              </div>
            )}

            <div className={styles.controls}>
              <input
                className={styles.seek}
                type="range"
                min={0}
                max={Math.max(duration, 0) || 0}
                step={1}
                value={Math.min(currentTime, duration || 0)}
                onChange={onSeek}
                aria-label="Seek"
                aria-valuetext={`${clock(currentTime)} of ${clock(duration)}`}
                disabled={duration <= 0}
              />
              <div className={styles.buttons}>
                <button
                  ref={playRef}
                  type="button"
                  className={styles.control}
                  onClick={togglePlay}
                  // The label carries the state: "Pause" when it is playing,
                  // "Play" when it is not. `aria-pressed` alongside it announced
                  // "Pause, pressed", which reads as though pausing were already
                  // in effect - and the fullscreen button beside it never had
                  // one. One signal.
                  aria-label={playing ? 'Pause' : 'Play'}
                >
                  <Icon name={playing ? 'pause' : 'play'} size={20} />
                </button>

                <p className={styles.time}>
                  <span aria-hidden="true">{`${clock(currentTime)} / ${clock(duration)}`}</span>
                  <span className="dsVisuallyHidden">{`${clock(currentTime)} of ${clock(duration)}`}</span>
                </p>

                <span className={styles.spacer} />

                <button
                  type="button"
                  className={styles.control}
                  onClick={toggleMute}
                  aria-label={muted ? 'Unmute' : 'Mute'}
                >
                  <Icon name="volume" size={20} />
                </button>

                <button
                  type="button"
                  className={styles.control}
                  onClick={toggleFullscreen}
                  aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                >
                  <Icon name="maximize" size={20} />
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* Playback is never interrupted by a failed write; the member is simply
          told, and can retry. Nothing is stored locally as a substitute. */}
      {sync.status === 'failed' ? (
        <p className={styles.syncFailed} role="status">
          <Icon name="alert" size={18} className={styles.syncIcon} />
          <span>Your progress couldn’t be saved.</span>
          <Button variant="tertiary" size="sm" onClick={sync.retry}>
            Try again
          </Button>
        </p>
      ) : null}
    </div>
  )
}
