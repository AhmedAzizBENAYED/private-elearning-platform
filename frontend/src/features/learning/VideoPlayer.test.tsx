import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AuthHarness } from '../../test/authHarness'
import {
  courseProgressResponse,
  learningContent,
  learningLessonIds,
  linkLessonDetail,
  progressResponse,
  textLessonDetail,
  videoResource,
} from '../../test/courseFixtures'
import { TEST_BASE_URL } from '../../test/authHarness'
import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

import { resumePosition } from './model'
import { SYNC_INTERVAL_SECONDS } from './useProgressSync'

const COURSE_ID = learningContent.course_id
const VIDEO = learningLessonIds.introduction
const DURATION = 384

const lessonPath = (lessonId: string) => `/courses/${COURSE_ID}/lessons/${lessonId}`

const progressPath = `/lessons/${VIDEO}/progress`

/** The course tree with the video lesson unwatched, which is where playback starts. */
const unwatchedContent = {
  ...learningContent,
  completed_video_lessons: 0,
  progress_percent: 0,
  modules: learningContent.modules.map((module) => ({
    ...module,
    lessons: module.lessons.map((lesson) =>
      lesson.id === learningLessonIds.introduction
        ? { ...lesson, watched_seconds: 0, completed: false, completed_at: null }
        : lesson,
    ),
  })),
}

function stubLearning(harness: AuthHarness) {
  harness.http.on(`/courses/${COURSE_ID}/content`, { json: unwatchedContent })
  harness.http.on(`/lessons/${learningLessonIds.text}`, { json: textLessonDetail })
  harness.http.on(`/lessons/${learningLessonIds.link}`, { json: linkLessonDetail })
  harness.http.on(`/lessons/${VIDEO}/resource`, { json: videoResource })
  harness.http.on(progressPath, (call) => ({
    // Echo the server's own rule: clamp to the duration, complete within
    // tolerance. The fixture stands in for the real `ProgressService.update`.
    json: (() => {
      const sent = Number(JSON.parse(call.body ?? '{}').watched_seconds ?? 0)
      const stored = Math.min(DURATION, sent)
      return progressResponse({ watchedSeconds: stored, completed: stored >= DURATION - 2 })
    })(),
  }))
  harness.http.on(`/courses/${COURSE_ID}/progress`, { json: courseProgressResponse() })
}

/**
 * jsdom ships no media pipeline: `play`, `pause`, `duration` and `currentTime`
 * are absent or inert. This installs just enough of one to drive the component
 * the way a browser would, and returns the handles the tests need.
 */
function installMedia(video: HTMLVideoElement, duration = DURATION) {
  let time = 0
  let paused = true

  Object.defineProperty(video, 'duration', { configurable: true, get: () => duration })
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused })
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => time,
    set: (value: number) => {
      time = value
    },
  })

  video.play = vi.fn(async () => {
    paused = false
    fireEvent.play(video)
  })
  video.pause = vi.fn(() => {
    paused = true
    fireEvent.pause(video)
  })

  return {
    /** Advance the playhead and let the component see it, as `timeupdate` does. */
    advanceTo(seconds: number) {
      time = seconds
      fireEvent.timeUpdate(video)
    },
    /** Move the playhead without playing, as a seek does. */
    seekTo(seconds: number) {
      time = seconds
      fireEvent.seeked(video)
    },
    ready() {
      fireEvent.loadedMetadata(video)
    },
  }
}

async function openVideo(
  beforeMount: (harness: AuthHarness) => void = stubLearning,
  lessonId: string = VIDEO,
) {
  const view = await renderRoute({ path: lessonPath(lessonId), as: 'member', beforeMount })
  const video = (await waitFor(() => {
    const element = view.container.querySelector('video')
    expect(element).not.toBeNull()
    return element
  })) as HTMLVideoElement

  return { ...view, video, media: installMedia(video) }
}

const putBodies = (harness: AuthHarness) =>
  harness.http
    .callsTo(progressPath)
    .map((call) => JSON.parse(call.body ?? '{}') as { watched_seconds: number })

afterEach(() => {
  vi.useRealTimers()
})

describe('video player - rendering', () => {
  it('streams from the backend resource URL, and only that', async () => {
    const { video } = await openVideo()

    expect(video).toHaveAttribute('src', `${TEST_BASE_URL}${videoResource.download_url}`)
    // Streamed, not downloaded: metadata only until the member presses play.
    expect(video).toHaveAttribute('preload', 'metadata')
    expect(video.querySelector('source')).toBeNull()
  })

  it('fetches the media URL through the authenticated API, once', async () => {
    const { harness } = await openVideo()

    const calls = harness.http.callsTo(`/lessons/${VIDEO}/resource`)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.headers.authorization).toMatch(/^Bearer /)
  })

  it('offers the design’s controls, each with an accessible name', async () => {
    await openVideo()

    for (const name of ['Play', 'Seek', 'Mute', 'Fullscreen']) {
      expect(screen.getByRole(name === 'Seek' ? 'slider' : 'button', { name })).toBeInTheDocument()
    }
  })

  it('announces a loading state before the media URL is known', async () => {
    await renderRoute({
      path: lessonPath(VIDEO),
      as: 'member',
      beforeMount: (harness) => {
        harness.http.on(`/courses/${COURSE_ID}/content`, { json: unwatchedContent })
        harness.http.on(`/lessons/${VIDEO}/resource`, () => new Promise(() => ({})))
      },
    })

    expect(await screen.findByText('Loading video…')).toBeInTheDocument()
  })

  it('shows the design’s error state and retries the resource', async () => {
    await renderRoute({
      path: lessonPath(VIDEO),
      as: 'member',
      beforeMount: (harness) => {
        harness.http.on(`/courses/${COURSE_ID}/content`, { json: unwatchedContent })
        harness.http.once(`/lessons/${VIDEO}/resource`, { status: 503, json: { detail: 'down' } })
        harness.http.on(`/lessons/${VIDEO}/resource`, { json: videoResource })
      },
    })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('This video can’t be played')
    expect(alert).not.toHaveTextContent('down')

    await userEvent.click(within(alert).getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull())
  })

  it('shows the error state when the media element itself fails', async () => {
    const { video } = await openVideo()

    fireEvent.error(video)

    expect(await screen.findByRole('alert')).toHaveTextContent('This video can’t be played')
  })
})

describe('video player - playback', () => {
  it('plays and pauses through the media element', async () => {
    const { video } = await openVideo()

    await userEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(video.play).toHaveBeenCalledTimes(1)

    const pause = await screen.findByRole('button', { name: 'Pause' })
    await userEvent.click(pause)
    expect(video.pause).toHaveBeenCalledTimes(1)
  })

  it('shows the duration and the position, from the media element', async () => {
    const { media } = await openVideo()

    media.ready()
    media.advanceTo(65)

    expect(await screen.findByText('01:05 / 06:24')).toBeInTheDocument()
  })

  it('seeks the media element from the slider', async () => {
    const { video, media } = await openVideo()
    media.ready()

    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '120' } })

    expect(video.currentTime).toBe(120)
  })

  it('offers Replay and Next when the video ends, and navigates only on request', async () => {
    const { router, video, media } = await openVideo()
    media.ready()

    fireEvent.ended(video)

    expect(await screen.findByText('Lesson completed')).toBeInTheDocument()
    expect(screen.getByText('Up next: Python cheat sheet')).toBeInTheDocument()
    // Nothing has navigated on its own.
    expect(router.state.location.pathname).toBe(lessonPath(VIDEO))

    await userEvent.click(screen.getByRole('button', { name: /next lesson/i }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(lessonPath(learningLessonIds.document)),
    )
  })
})

describe('video player - resume', () => {
  it('resumes from the backend position once metadata is available', async () => {
    const { video, media } = await openVideo((harness) => {
      stubLearning(harness)
      harness.http.on(`/courses/${COURSE_ID}/content`, {
        json: {
          ...unwatchedContent,
          modules: unwatchedContent.modules.map((module) => ({
            ...module,
            lessons: module.lessons.map((lesson) =>
              lesson.id === VIDEO ? { ...lesson, watched_seconds: 47 } : lesson,
            ),
          })),
        },
      })
    })

    // Nothing is set before metadata: `currentTime` is not settable then.
    expect(video.currentTime).toBe(0)

    media.ready()

    expect(video.currentTime).toBe(47)
  })

  it('never seeks past the end', () => {
    expect(resumePosition(400, false, 384)).toBe(383)
    expect(resumePosition(384, false, 384)).toBe(383)
  })

  it('opens a completed lesson at the beginning rather than at its last frame', () => {
    expect(resumePosition(384, true, 384)).toBe(0)
  })

  it('starts at zero when the backend has recorded nothing', () => {
    expect(resumePosition(0, false, 384)).toBe(0)
    expect(resumePosition(null, null, 384)).toBe(0)
  })
})

describe('video player - progress synchronisation', () => {
  it('sends nothing on every timeupdate', async () => {
    const { harness, media } = await openVideo()
    media.ready()

    for (let second = 1; second <= 10; second += 1) media.advanceTo(second)

    expect(harness.http.callsTo(progressPath)).toHaveLength(0)
  })

  it('writes once the interval of playback has passed', async () => {
    const { harness, media } = await openVideo()
    media.ready()

    media.advanceTo(SYNC_INTERVAL_SECONDS)

    await waitFor(() => expect(harness.http.callsTo(progressPath)).toHaveLength(1))
    expect(putBodies(harness)[0]).toEqual({ watched_seconds: SYNC_INTERVAL_SECONDS })
  })

  it('sends only watched_seconds, by PUT, to the selected lesson', async () => {
    const { harness, media } = await openVideo()
    media.ready()
    media.advanceTo(20)

    await waitFor(() => expect(harness.http.callsTo(progressPath)).toHaveLength(1))

    const call = harness.http.callsTo(progressPath)[0]
    expect(call?.method).toBe('PUT')
    expect(call?.url).toContain(`/lessons/${VIDEO}/progress`)
    // `ProgressUpdate` forbids extra fields; `completed` is server-owned.
    expect(Object.keys(JSON.parse(call?.body ?? '{}'))).toEqual(['watched_seconds'])
  })

  it('writes about once per interval, not once per second', async () => {
    const { harness, media } = await openVideo()
    media.ready()

    for (let second = 1; second <= 60; second += 1) media.advanceTo(second)

    await waitFor(() => expect(harness.http.callsTo(progressPath).length).toBeGreaterThan(0))
    // 60 seconds of playback at a 15-second interval: four writes, not sixty.
    expect(harness.http.callsTo(progressPath).length).toBeLessThanOrEqual(4)
  })

  it('writes on pause', async () => {
    const { harness, video, media } = await openVideo()
    media.ready()
    media.advanceTo(5)

    fireEvent.pause(video)

    await waitFor(() => expect(harness.http.callsTo(progressPath)).toHaveLength(1))
    expect(putBodies(harness)[0]).toEqual({ watched_seconds: 5 })
  })

  it('sends nothing on a second pause with nothing new to report', async () => {
    const { harness, video, media } = await openVideo()
    media.ready()
    media.advanceTo(5)
    fireEvent.pause(video)
    await waitFor(() => expect(harness.http.callsTo(progressPath)).toHaveLength(1))

    fireEvent.pause(video)

    expect(harness.http.callsTo(progressPath)).toHaveLength(1)
  })

  it('writes when the tab is hidden', async () => {
    const { harness, media } = await openVideo()
    media.ready()
    media.advanceTo(9)

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    fireEvent(document, new Event('visibilitychange'))

    await waitFor(() => expect(harness.http.callsTo(progressPath)).toHaveLength(1))

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })

  it('writes the end of the video when playback ends', async () => {
    const { harness, video, media } = await openVideo()
    media.ready()
    media.advanceTo(100)

    fireEvent.ended(video)

    await waitFor(() => expect(harness.http.callsTo(progressPath).length).toBeGreaterThan(0))
    const last = putBodies(harness).at(-1)
    expect(last?.watched_seconds).toBe(DURATION)
  })
})

describe('video player - seeking semantics', () => {
  it('never lowers the reported position after seeking backwards', async () => {
    const { harness, video, media } = await openVideo()
    media.ready()

    media.advanceTo(120)
    await waitFor(() => expect(harness.http.callsTo(progressPath).length).toBeGreaterThan(0))

    media.seekTo(10)
    media.advanceTo(12)
    fireEvent.pause(video)

    await waitFor(() => expect(harness.http.callsTo(progressPath).length).toBeGreaterThan(0))
    // The backend stores max(stored, sent); the client never even offers less.
    for (const body of putBodies(harness)) expect(body.watched_seconds).toBeGreaterThanOrEqual(120)
  })

  it('reports a forward seek as the furthest position reached', async () => {
    const { harness, video, media } = await openVideo()
    media.ready()

    media.advanceTo(200)
    fireEvent.pause(video)

    await waitFor(() => expect(harness.http.callsTo(progressPath)).toHaveLength(1))
    expect(putBodies(harness)[0]?.watched_seconds).toBe(200)
  })

  it('does not complete a lesson merely because the slider moved', async () => {
    const { harness, media } = await openVideo()
    media.ready()

    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '300' } })

    // A slider change moves the playhead; completion is still the server's call,
    // and nothing in the sidebar changes without its answer.
    const outline = screen.getByRole('navigation', { name: 'Course content' })
    expect(within(outline).getByRole('link', { name: /Python cheat sheet/ })).not.toHaveTextContent(
      'Completed',
    )
    expect(harness.http.callsTo(progressPath)).toHaveLength(0)
  })
})

describe('video player - completion', () => {
  it('marks the sidebar complete only from the backend answer', async () => {
    const { harness, video, media } = await openVideo((harness) => {
      stubLearning(harness)
      // The lesson starts NOT complete in the tree.
      harness.http.on(`/courses/${COURSE_ID}/content`, { json: unwatchedContent })
    })
    media.ready()

    // The lesson's own header - the outline's legend also says "Completed".
    const header = () => screen.getByRole('heading', { level: 1 }).closest('header')!

    // The backend has not been told anything yet, so nothing claims completion.
    expect(within(header()).queryByText('Completed')).toBeNull()

    fireEvent.ended(video)

    // The badge appears only once the server's answer comes back.
    expect(await within(header()).findByText('Completed')).toBeInTheDocument()
    expect(harness.http.callsTo(progressPath).length).toBeGreaterThan(0)
  })

  it('refreshes the course figures from the backend aggregate, once', async () => {
    const { harness, video, media } = await openVideo((harness) => {
      stubLearning(harness)
      harness.http.on(`/courses/${COURSE_ID}/content`, { json: unwatchedContent })
    })
    media.ready()

    fireEvent.ended(video)

    // 1 of 2, straight from `GET /courses/{id}/progress` - not recomputed here.
    expect(await screen.findByText('1 of 2 videos')).toBeInTheDocument()
    expect(harness.http.callsTo(`/courses/${COURSE_ID}/progress`)).toHaveLength(1)
    // And the whole tree was NOT re-read.
    expect(harness.http.callsTo(`/courses/${COURSE_ID}/content`)).toHaveLength(1)
  })

  it('leaves the course figures alone when nothing became complete', async () => {
    const { harness, video, media } = await openVideo()
    media.ready()
    media.advanceTo(30)
    fireEvent.pause(video)

    await waitFor(() => expect(harness.http.callsTo(progressPath).length).toBeGreaterThan(0))
    expect(harness.http.callsTo(`/courses/${COURSE_ID}/progress`)).toHaveLength(0)
  })
})

describe('video player - progress failures', () => {
  it('keeps playing and retries when a write fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    const { harness, video, media } = await openVideo((harness) => {
      stubLearning(harness)
      harness.http.once(progressPath, { status: 503, json: { detail: 'db down' } })
    })
    media.ready()
    media.advanceTo(20)
    fireEvent.pause(video)

    await waitFor(() => expect(harness.http.callsTo(progressPath).length).toBeGreaterThan(0))

    await vi.advanceTimersByTimeAsync(3_000)

    // Retried, and playback was never touched.
    await waitFor(() => expect(harness.http.callsTo(progressPath).length).toBeGreaterThan(1))
    expect(video.pause).not.toHaveBeenCalled()
  })

  it('tells the member after the retries are exhausted, and retries on request', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    const { harness, video, media } = await openVideo((harness) => {
      stubLearning(harness)
      harness.http.on(progressPath, { status: 503, json: { detail: 'db down' } })
    })
    media.ready()
    media.advanceTo(20)
    fireEvent.pause(video)

    await vi.advanceTimersByTimeAsync(30_000)

    expect(await screen.findByText(/progress couldn’t be saved/i)).toBeInTheDocument()
    // Bounded: three delays, so four attempts at most - never an unlimited loop.
    expect(harness.http.callsTo(progressPath).length).toBeLessThanOrEqual(4)
    expect(screen.queryByText('db down')).toBeNull()
  })
})

describe('video player - lesson changes', () => {
  it('tears down the previous video and mounts the new lesson’s own', async () => {
    const { container, media } = await openVideo()
    media.ready()

    const outline = screen.getByRole('navigation', { name: 'Course content' })
    await userEvent.click(within(outline).getByRole('link', { name: /Practice exercises/ }))

    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })
    // A TEXT lesson has no player at all; the old element is gone, not hidden.
    expect(container.querySelector('video')).toBeNull()
  })

  it('makes one final best-effort write when leaving a lesson', async () => {
    const { harness, media } = await openVideo()
    media.ready()
    media.advanceTo(8)

    const outline = screen.getByRole('navigation', { name: 'Course content' })
    await userEvent.click(within(outline).getByRole('link', { name: /Practice exercises/ }))
    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })

    await waitFor(() => expect(harness.http.callsTo(progressPath)).toHaveLength(1))
    expect(putBodies(harness)[0]).toEqual({ watched_seconds: 8 })
  })

  it('writes nothing when leaving a lesson that was never watched', async () => {
    const { harness, media } = await openVideo()
    media.ready()

    const outline = screen.getByRole('navigation', { name: 'Course content' })
    await userEvent.click(within(outline).getByRole('link', { name: /Practice exercises/ }))
    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })

    expect(harness.http.callsTo(progressPath)).toHaveLength(0)
  })

  it('a late resource reply cannot become the new lesson’s source', async () => {
    const pending: { resolve?: (value: unknown) => void } = {}

    const { container } = await renderRoute({
      path: lessonPath(VIDEO),
      as: 'member',
      beforeMount: (harness) => {
        stubLearning(harness)
        harness.http.once(
          `/lessons/${VIDEO}/resource`,
          () =>
            new Promise((resolve) => {
              pending.resolve = resolve as (value: unknown) => void
            }),
        )
      },
    })

    await screen.findByText('Loading video…')

    const outline = screen.getByRole('navigation', { name: 'Course content' })
    await userEvent.click(within(outline).getByRole('link', { name: /Practice exercises/ }))
    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })

    // The abandoned request answers now; the TEXT lesson must be unaffected.
    pending.resolve?.({ json: videoResource })

    await waitFor(() => expect(screen.getByText('Before you start')).toBeInTheDocument())
    expect(container.querySelector('video')).toBeNull()
  })
})

describe('video player - security', () => {
  it('exposes no session token and no storage vocabulary', async () => {
    const { video } = await openVideo()

    const markup = document.body.innerHTML
    expect(markup).not.toContain('access-2')
    expect(markup).not.toContain('refresh-1')
    expect(markup).not.toMatch(/storage:\/\/|googleapis|drive|service.account|client.secret/i)
    // The media URL is the backend's own, never a provider's.
    expect(video.getAttribute('src')).toBe(`${TEST_BASE_URL}${videoResource.download_url}`)
  })

  it('never puts the session token in the media URL', async () => {
    const { video } = await openVideo()

    const url = new URL(video.src, 'http://localhost')
    expect(url.searchParams.get('playback_token')).toBe('pbk-test-token')
    // The backend's lesson-scoped token, and nothing of the session.
    expect(video.src).not.toContain('access-2')
    expect(video.src).not.toContain('refresh-1')
    expect([...url.searchParams.keys()]).toEqual(['playback_token'])
  })

  it('makes no admin call', async () => {
    const { harness, media } = await openVideo()
    media.ready()
    media.advanceTo(20)

    await waitFor(() => expect(harness.http.callsTo(progressPath).length).toBeGreaterThan(0))
    expect(harness.http.calls.some((call) => call.url.includes('/admin'))).toBe(false)
  })
})

describe('video player - responsive', () => {
  it('renders its controls on a phone', async () => {
    await renderRoute({
      path: lessonPath(VIDEO),
      as: 'member',
      width: viewports.mobile,
      beforeMount: stubLearning,
    })

    await waitFor(() => expect(document.querySelector('video')).not.toBeNull())
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Seek' })).toBeInTheDocument()
  })
})

// ------------------------------------------------------------ FE-PLAYER-01

/** The player's own region: the 16:9 frame and everything drawn over it. */
const frame = () => document.querySelector('video')!.parentElement!
const playVideo = () => screen.getByRole('button', { name: 'Play video' })
const outlineStatus = (title: string) =>
  within(screen.getByRole('navigation', { name: 'Course content' }))
    .getByRole('link', { name: new RegExp(title) })
    .querySelector('.dsVisuallyHidden')
    ?.textContent?.replace(/^ — /, '') ?? ''

/** The progress endpoint answering only when the test says so. */
function deferredProgress(harness: AuthHarness) {
  const pending: Array<() => void> = []
  harness.http.on(progressPath, (call) => {
    const sent = Number(JSON.parse(call.body ?? '{}').watched_seconds ?? 0)
    const stored = Math.min(DURATION, sent)
    return new Promise((resolve) => {
      pending.push(() =>
        resolve({ json: progressResponse({ watchedSeconds: stored, completed: stored >= DURATION - 2 }) }),
      )
    })
  })
  return { answerAll: () => pending.splice(0).forEach((answer) => answer()) }
}

describe('video player - keyboard (G17)', () => {
  it('reaches every control with Tab, in the order the board draws them', async () => {
    const { media } = await openVideo()
    media.ready()

    playVideo().focus()
    await userEvent.tab()
    expect(screen.getByRole('slider', { name: 'Seek' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Play' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Mute' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toHaveFocus()
  })

  it('makes nothing decorative focusable, and hides the glyphs', async () => {
    const { video, media } = await openVideo()
    media.ready()

    const focusable = [...frame().querySelectorAll<HTMLElement>('button, input, [tabindex], video[controls]')]
    expect(focusable.map((element) => element.getAttribute('aria-label'))).toEqual([
      'Play video',
      'Seek',
      'Play',
      'Mute',
      'Fullscreen',
    ])
    // Custom controls only: no native controls to tab through twice.
    expect(video).not.toHaveAttribute('controls')
    expect(video).not.toHaveAttribute('tabindex')
    for (const svg of frame().querySelectorAll('svg')) expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('presses Play with Enter and Pause with Space, once each', async () => {
    const { video, media } = await openVideo()
    media.ready()

    screen.getByRole('button', { name: 'Play' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(video.play).toHaveBeenCalledTimes(1)

    await screen.findByRole('button', { name: 'Pause' })
    await userEvent.keyboard(' ')
    expect(video.pause).toHaveBeenCalledTimes(1)
    expect(video.play).toHaveBeenCalledTimes(1)
  })

  it('starts from the round Play video button, then hands focus to Pause', async () => {
    const { video, media } = await openVideo()
    media.ready()

    playVideo().focus()
    await userEvent.keyboard('{Enter}')

    expect(video.play).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toHaveFocus())
    expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull()
  })

  it('plays and pauses with K, and with Space away from a button', async () => {
    const { video, media } = await openVideo()
    media.ready()

    screen.getByRole('slider', { name: 'Seek' }).focus()
    await userEvent.keyboard(' ')
    expect(video.play).toHaveBeenCalledTimes(1)
    await screen.findByRole('button', { name: 'Pause' })
    await userEvent.keyboard('k')
    expect(video.pause).toHaveBeenCalledTimes(1)
  })

  it('seeks 5 seconds with the arrow keys, never below zero or past the end', async () => {
    const { video, media } = await openVideo()
    media.ready()
    screen.getByRole('slider', { name: 'Seek' }).focus()

    await userEvent.keyboard('{ArrowRight}')
    expect(video.currentTime).toBe(5)
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    expect(video.currentTime).toBe(15)
    await userEvent.keyboard('{ArrowLeft}')
    expect(video.currentTime).toBe(10)
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}')
    expect(video.currentTime).toBe(0)

    video.currentTime = DURATION - 2
    await userEvent.keyboard('{ArrowRight}')
    expect(video.currentTime).toBe(DURATION)
  })

  it('mutes with M and goes fullscreen with F, and says so in the labels', async () => {
    const { media } = await openVideo()
    media.ready()
    const requestFullscreen = vi.fn(async () => undefined)
    frame().requestFullscreen = requestFullscreen

    screen.getByRole('button', { name: 'Play' }).focus()
    await userEvent.keyboard('m')
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeInTheDocument()
    await userEvent.keyboard('M')
    expect(screen.getByRole('button', { name: 'Mute' })).toBeInTheDocument()

    await userEvent.keyboard('f')
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: frame() })
    fireEvent(document, new Event('fullscreenchange'))
    expect(await screen.findByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument()
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
    fireEvent(document, new Event('fullscreenchange'))
    expect(await screen.findByRole('button', { name: 'Fullscreen' })).toBeInTheDocument()
  })

  it('captures no key from the rest of the page, nor with a modifier held', async () => {
    const { video, media } = await openVideo()
    media.ready()

    // Focus outside the player: its shortcuts do not apply.
    within(screen.getByRole('navigation', { name: 'Course content' })).getByRole('link', { name: /Python cheat sheet/ }).focus()
    await userEvent.keyboard('km{ArrowRight}')
    expect(video.play).not.toHaveBeenCalled()
    expect(video.currentTime).toBe(0)
    expect(screen.getByRole('button', { name: 'Mute' })).toBeInTheDocument()

    screen.getByRole('button', { name: 'Play' }).focus()
    await userEvent.keyboard('{Control>}k{/Control}')
    expect(video.play).not.toHaveBeenCalled()
  })

  it('keeps the lesson navigation working from the keyboard', async () => {
    const { router, media } = await openVideo()
    media.ready()

    screen.getByRole('link', { name: /Next lesson/ }).focus()
    await userEvent.keyboard('{Enter}')

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(lessonPath(learningLessonIds.document)),
    )
  })
})

describe('video player - states (G26)', () => {
  it('loading: "Loading video…" alone, with no control to press and nothing completed', async () => {
    await renderRoute({
      path: lessonPath(VIDEO),
      as: 'member',
      beforeMount: (harness) => {
        harness.http.on(`/courses/${COURSE_ID}/content`, { json: unwatchedContent })
        harness.http.on(`/lessons/${VIDEO}/resource`, () => new Promise(() => ({})))
      },
    })

    const label = await screen.findByText('Loading video…')
    expect(label.closest('[role="status"]')).not.toBeNull()
    expect(screen.queryByRole('button', { name: /^(Play|Play video|Pause|Mute|Fullscreen)$/ })).toBeNull()
    expect(screen.queryByRole('slider', { name: 'Seek' })).toBeNull()
    expect(screen.queryByText('Lesson completed')).toBeNull()
  })

  it('ready: the round Play video button over the frame, Play in the controls', async () => {
    const { media } = await openVideo()
    media.ready()

    expect(playVideo()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(screen.queryByText('Lesson completed')).toBeNull()
  })

  it('playing: Pause, and the frame clear of the round button', async () => {
    const { media } = await openVideo()
    media.ready()

    await userEvent.click(playVideo())

    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull()
  })

  it('paused: Play video again, the position kept, and nothing completed', async () => {
    const { harness, video, media } = await openVideo()
    media.ready()
    await userEvent.click(playVideo())
    media.advanceTo(40)

    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }))

    expect(playVideo()).toBeInTheDocument()
    expect(video.currentTime).toBe(40)
    await waitFor(() => expect(putBodies(harness)).toEqual([{ watched_seconds: 40 }]))
    expect(screen.queryByText('Lesson completed')).toBeNull()
    expect(outlineStatus('Introduction')).not.toMatch(/^Completed/)
  })

  it('buffering: "Buffering…" over a playing video, which still offers Pause', async () => {
    const { video, media } = await openVideo()
    media.ready()
    await userEvent.click(playVideo())
    await screen.findByRole('button', { name: 'Pause' })

    fireEvent.waiting(video)

    const label = await screen.findByText('Buffering…')
    expect(label.closest('[role="status"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Seek' })).toBeInTheDocument()

    fireEvent.playing(video)
    await waitFor(() => expect(screen.queryByText('Buffering…')).toBeNull())
  })

  it('does not call a paused video buffering', async () => {
    const { video, media } = await openVideo()
    media.ready()

    fireEvent.waiting(video)

    expect(screen.queryByText('Buffering…')).toBeNull()
  })

  it('ended, before the server answers: stopped, not completed', async () => {
    let server: { answerAll: () => void } | undefined
    const { video, media } = await openVideo((harness) => {
      stubLearning(harness)
      server = deferredProgress(harness)
    })
    media.ready()

    fireEvent.ended(video)

    // The end was reported; completion is not claimed until confirmed.
    expect(screen.queryByText('Lesson completed')).toBeNull()
    expect(outlineStatus('Introduction')).not.toMatch(/^Completed/)
    expect(playVideo()).toBeInTheDocument()

    await waitFor(() => expect(putBodies.length).toBeGreaterThan(0))
    server!.answerAll()

    expect(await screen.findByRole('heading', { name: 'Lesson completed', level: 2 })).toBeInTheDocument()
    expect(outlineStatus('Introduction')).toBe('Completed, current lesson')
  })

  it('ended, and the server does not count it complete: no completed state', async () => {
    const { harness, video, media } = await openVideo((harness) => {
      stubLearning(harness)
      harness.http.on(progressPath, { json: progressResponse({ watchedSeconds: 200, completed: false }) })
    })
    media.ready()

    fireEvent.ended(video)

    await waitFor(() => expect(harness.http.callsTo(progressPath)).toHaveLength(1))
    expect(playVideo()).toBeInTheDocument()
    expect(screen.queryByText('Lesson completed')).toBeNull()
    expect(outlineStatus('Introduction')).not.toMatch(/^Completed/)
  })

  it('completed: the board’s panel, announced, with Replay then Next lesson', async () => {
    const { video, media } = await openVideo()
    media.ready()

    fireEvent.ended(video)

    const heading = await screen.findByRole('heading', { name: 'Lesson completed', level: 2 })
    const panel = heading.closest('[role="status"]') as HTMLElement
    expect(panel).not.toBeNull()
    expect(panel).toHaveTextContent('Up next: Python cheat sheet')
    expect(within(panel).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Replay',
      'Next lesson',
    ])
    // The panel replaces the controls, as the board draws it.
    expect(screen.queryByRole('slider', { name: 'Seek' })).toBeNull()
    expect(outlineStatus('Introduction')).toBe('Completed, current lesson')
  })

  it('moves focus to Next lesson when the video ends under keyboard focus', async () => {
    const { video, media } = await openVideo()
    media.ready()
    screen.getByRole('button', { name: 'Play' }).focus()

    fireEvent.ended(video)

    await waitFor(() => expect(within(frame()).getByRole('button', { name: 'Next lesson' })).toHaveFocus())
  })

  it('leaves focus alone when it was elsewhere on the page', async () => {
    const { video, media } = await openVideo()
    media.ready()
    const elsewhere = within(screen.getByRole('navigation', { name: 'Course content' })).getByRole('link', { name: /Python cheat sheet/ })
    elsewhere.focus()

    fireEvent.ended(video)

    await screen.findByRole('heading', { name: 'Lesson completed', level: 2 })
    expect(elsewhere).toHaveFocus()
  })

  it('replays from the start, and gives focus back to Pause', async () => {
    const { video, media } = await openVideo()
    media.ready()
    fireEvent.ended(video)

    await userEvent.click(await screen.findByRole('button', { name: 'Replay' }))

    expect(video.currentTime).toBe(0)
    expect(video.play).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toHaveFocus())
    expect(screen.queryByText('Lesson completed')).toBeNull()
  })

  it('error: the board’s alert, with Try again focused if focus was in the player', async () => {
    const { harness, video, media } = await openVideo()
    media.ready()
    screen.getByRole('button', { name: 'Play' }).focus()

    fireEvent.error(video)

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('heading', { name: 'This video can’t be played', level: 2 })).toBeInTheDocument()
    await waitFor(() => expect(within(alert).getByRole('button', { name: 'Try again' })).toHaveFocus())
    // No completion, no write, and the session untouched.
    expect(screen.queryByText('Lesson completed')).toBeNull()
    expect(harness.http.callsTo(progressPath)).toHaveLength(0)
    expect(harness.authStore.getState().status).toBe('authenticated')
  })

  it('unavailable: no file uploaded, no request for one, and no controls', async () => {
    const { harness } = await renderRoute({
      path: lessonPath(VIDEO),
      as: 'member',
      beforeMount: (instance) => {
        instance.http.on(`/courses/${COURSE_ID}/content`, {
          json: {
            ...unwatchedContent,
            modules: unwatchedContent.modules.map((module) => ({
              ...module,
              lessons: module.lessons.map((lesson) =>
                lesson.id === VIDEO ? { ...lesson, has_resource: false } : lesson,
              ),
            })),
          },
        })
      },
    })

    expect(await screen.findByText('No video file has been uploaded for this lesson yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Play|Play video)$/ })).toBeNull()
    expect(harness.http.callsTo(`/lessons/${VIDEO}/resource`)).toHaveLength(0)
  })
})

describe('video player - progress stays the server’s (FE-PLAYER-01)', () => {
  it('sends nothing for opening or starting a video, and completes nothing', async () => {
    const { harness, media } = await openVideo()
    media.ready()

    await userEvent.click(playVideo())
    await screen.findByRole('button', { name: 'Pause' })

    expect(harness.http.callsTo(progressPath)).toHaveLength(0)
    expect(outlineStatus('Introduction')).not.toMatch(/^Completed/)
  })

  it('writes the end once, and refreshes the course once, on a confirmed end', async () => {
    const { harness, video, media } = await openVideo()
    media.ready()

    fireEvent.ended(video)
    await screen.findByRole('heading', { name: 'Lesson completed', level: 2 })

    expect(putBodies(harness)).toEqual([{ watched_seconds: DURATION }])
    expect(harness.http.callsTo(`/courses/${COURSE_ID}/progress`)).toHaveLength(1)
  })
})

describe('video player - a server that clamps below the value sent', () => {
  // The server stores min(duration, sent): a file a few seconds longer than the
  // lesson's recorded duration answers less than was sent. That answer is
  // final - the write must not be repeated.
  it('writes the end once, without re-sending it', async () => {
    const { harness, video, media } = await openVideo((harness) => {
      stubLearning(harness)
      harness.http.on(progressPath, { json: progressResponse({ watchedSeconds: DURATION - 4, completed: true }) })
    })
    media.ready()

    fireEvent.ended(video)

    await screen.findByRole('heading', { name: 'Lesson completed', level: 2 })
    expect(putBodies(harness)).toEqual([{ watched_seconds: DURATION }])
  })
})

describe('video player - a pause between two whole seconds', () => {
  // A real playhead is fractional; the write carries whole seconds. The
  // confirmed whole second is what was said, so nothing is re-sent after it.
  it('writes once, not again and again, for a pause at 40.6 s', async () => {
    const { harness, video, media } = await openVideo()
    media.ready()
    media.advanceTo(40.6)

    fireEvent.pause(video)

    await waitFor(() => expect(harness.http.callsTo(progressPath)).toHaveLength(1))
    // Let the confirmation land and any follow-up it would trigger go out.
    await screen.findByRole('button', { name: 'Play video' })
    await waitFor(() => expect(outlineStatus('Introduction')).toBe('Current lesson'))
    expect(putBodies(harness)).toEqual([{ watched_seconds: 40 }])
  })
})

describe('video player - layering over a short phone frame', () => {
  // On a ~200 px-tall phone frame the controls' box reaches the round button:
  // it must take no pointer itself, and the button must sit above it.
  it('keeps the round Play video button pressable above the controls', async () => {
    const { media } = await openVideo()
    media.ready()

    const controls = screen.getByRole('slider', { name: 'Seek' }).parentElement!
    expect(getComputedStyle(controls).pointerEvents).toBe('none')
    expect(getComputedStyle(screen.getByRole('slider', { name: 'Seek' })).pointerEvents).toBe('auto')
    expect(getComputedStyle(playVideo().parentElement!).zIndex).toBe('1')
    expect(getComputedStyle(playVideo()).pointerEvents).toBe('auto')
  })
})

describe('video player - at each width', () => {
  it.each([
    ['390', viewports.mobile],
    ['375', 375],
    ['599', 599],
    ['600', 600],
    ['768', viewports.tablet],
    ['1024', viewports.laptop],
    ['1440', viewports.wide],
  ])('keeps every control, and the keyboard, at %spx', async (_name, width) => {
    const view = await renderRoute({ path: lessonPath(VIDEO), as: 'member', width, beforeMount: stubLearning })
    const video = (await waitFor(() => {
      const element = view.container.querySelector('video')
      expect(element).not.toBeNull()
      return element
    })) as HTMLVideoElement
    const media = installMedia(video)
    media.ready()

    for (const name of ['Play video', 'Play', 'Mute', 'Fullscreen']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    screen.getByRole('slider', { name: 'Seek' }).focus()
    await userEvent.keyboard('k')
    expect(video.play).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })
})
