import { useLayoutEffect, useRef } from 'react'
import { Link } from 'react-router-dom'

import type { CourseContent, CourseContentLesson, UUID } from '../../../api'
import { routes } from '../../../app/routes'
import { Badge, Icon, Progress } from '../../../design-system'
import {
  byPosition,
  formatDuration,
  spokenDuration,
  useModuleDisclosure,
  useRecordLearningEvent,
} from '../../courses'

import styles from './LearningOutline.module.css'

export interface LearningOutlineProps {
  content: CourseContent
  courseId: UUID
  /** The lesson the URL names; `null` when the URL names none of them. */
  currentLessonId: UUID | null
}

type LessonState = 'completed' | 'current' | 'not-started'

const stateLabel: Record<LessonState, string> = {
  completed: 'Completed',
  current: 'Current lesson',
  'not-started': 'Not started',
}

// Named apart from the row's own `.current`, so the marker's shape and the
// row's tint never fight over one class.
const markerClass: Record<LessonState, string> = {
  completed: styles.markerCompleted,
  current: styles.markerCurrent,
  'not-started': styles.markerNotStarted,
}

function lessonStateOf(lesson: CourseContentLesson, current: boolean): LessonState | null {
  // Only VIDEO lessons carry completion; the rest report null, which is not the
  // same as "not completed" and must never be drawn as a completion marker
  // (DS 08: "Text / document / link: no completion marker"). They show their
  // type badge instead, as the course details outline does.
  if (lesson.content_type !== 'VIDEO') return null
  // Completion is a fact about the lesson, confirmed by the server, and it does
  // not disappear because the lesson is the one open: the check stays. Which
  // row is selected is said by the row itself - tint, weight, aria-current -
  // so a completed lesson that is open is both, as DS 08's three shapes allow.
  if (lesson.completed === true) return 'completed'
  return current ? 'current' : 'not-started'
}

/**
 * The row's visually hidden status, in DS 08's own phrasing ("— Current
 * lesson", "— Text, current lesson"): one statement, never two that could be
 * read as contradicting each other.
 */
function spokenStatus(state: LessonState | null, current: boolean): string | null {
  if (state === 'completed') return current ? 'Completed, current lesson' : stateLabel.completed
  if (state !== null) return stateLabel[state]
  return current ? stateLabel.current : null
}

function OutlineLessonRow({
  lesson,
  courseId,
  current,
}: {
  lesson: CourseContentLesson
  courseId: UUID
  current: boolean
}) {
  const state = lessonStateOf(lesson, current)
  const status = spokenStatus(state, current)
  const duration = formatDuration(lesson.duration_seconds)
  const spoken = spokenDuration(lesson.duration_seconds)

  return (
    <li>
      <Link
        to={routes.lesson(courseId, lesson.id)}
        className={[
          styles.lesson,
          state === 'completed' ? styles.completed : undefined,
          current ? styles.current : undefined,
        ]
          .filter(Boolean)
          .join(' ')}
        // The selected row is announced, not merely tinted.
        aria-current={current ? 'page' : undefined}
      >
        {state === null ? (
          <span className={styles.markerSpacer} aria-hidden="true" />
        ) : (
          <span className={[styles.marker, markerClass[state]].join(' ')} aria-hidden="true">
            {state === 'completed' ? <Icon name="check" size={13} /> : null}
          </span>
        )}

        <span className={styles.lessonBody}>
          <span className={styles.lessonTitle}>{lesson.title}</span>
          {/* A non-video row has no progress state to announce, only - when
              selected - that it is the current lesson. */}
          {status === null ? null : <span className="dsVisuallyHidden">{` — ${status}`}</span>}
          {/* DS 08: "Now playing" under a current video, "Viewing" under any
              other current lesson. Hidden from assistive technology: the
              status above already says "current lesson" in words. */}
          {current ? (
            <span className={styles.nowLabel} aria-hidden="true">
              {lesson.content_type === 'VIDEO' ? 'Now playing' : 'Viewing'}
            </span>
          ) : null}
        </span>

        {lesson.content_type === 'VIDEO' ? (
          duration === null ? null : (
            <span className={styles.duration}>
              <span aria-hidden="true">{duration}</span>
              <span className="dsVisuallyHidden">{spoken}</span>
            </span>
          )
        ) : (
          <Badge kind="lesson-type" value={lesson.content_type} />
        )}
      </Link>
    </li>
  )
}

/**
 * The learning page's course outline (Learning-Laptop, "Course content").
 *
 * Every row is a real router link to `/courses/:courseId/lessons/:lessonId`,
 * so the browser's own navigation - middle-click, back, forward - keeps
 * working, and the selected lesson follows the URL rather than a local
 * selection. Ordering comes from `byPosition`, the same strategy the course
 * details outline uses.
 */
export function LearningOutline({ content, courseId, currentLessonId }: LearningOutlineProps) {
  const modules = byPosition(content.modules)
  const currentModuleId =
    modules.find((module) => module.lessons.some((lesson) => lesson.id === currentLessonId))?.id ??
    null
  const disclosure = useModuleDisclosure(currentModuleId)
  const record = useRecordLearningEvent()
  const navRef = useRef<HTMLElement>(null)

  // DS 08: "Body: scrolls independently, current lesson scrolled into view".
  // Only the sidebar's own scroll box moves - never the window, which on a
  // phone would pull the member from the lesson down to the outline below it.
  useLayoutEffect(() => {
    const nav = navRef.current
    const row = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!nav || !row) return
    let box: HTMLElement | null = nav.parentElement
    while (box && box !== document.body) {
      // The cheap test first: only a box that actually overflows is worth
      // asking for its computed style.
      if (box.scrollHeight > box.clientHeight) {
        const overflow = getComputedStyle(box).overflowY
        if (overflow === 'auto' || overflow === 'scroll') break
      }
      box = box.parentElement
    }
    if (!box || box === document.body) return
    const boxRect = box.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    if (rowRect.top >= boxRect.top && rowRect.bottom <= boxRect.bottom) return
    box.scrollTop += rowRect.top - boxRect.top - (boxRect.height - rowRect.height) / 2
  }, [currentLessonId])

  return (
    <nav ref={navRef} className={styles.outline} aria-label="Course content">
      <div className={styles.head}>
        <h2 className={styles.title}>Course content</h2>
        <Progress
          value={content.progress_percent}
          size={6}
          label={`${content.title} progress`}
          headerLabel="Complete"
          showHeader
          caption={`${content.completed_video_lessons} of ${content.total_video_lessons} videos`}
        />
      </div>

      {modules.map((module) => {
        const lessons = byPosition(module.lessons)
        const videos = lessons.filter((lesson) => lesson.content_type === 'VIDEO')
        const done = videos.filter((lesson) => lesson.completed === true).length
        const complete = videos.length > 0 && done === videos.length
        const open = disclosure.isOpen(module.id)
        const bodyId = `outline-module-${module.id}`

        return (
          <section key={module.id} className={styles.module}>
            <header className={styles.moduleHeader}>
              <span className={styles.moduleNumber} aria-hidden="true">
                {String(module.position).padStart(2, '0')}
              </span>
              <h3 className={styles.moduleTitle}>
                {disclosure.collapsible ? (
                  // The whole header is the target (`::after`), but the
                  // button's name stays the module's title.
                  <button
                    type="button"
                    className={styles.moduleToggle}
                    aria-expanded={open}
                    aria-controls={bodyId}
                    onClick={() => {
                      // Tracking-Logic: "Module opened - the member expands a
                      // module". Folding it again is not an opening.
                      if (!open) record({ type: 'module_opened', course_id: courseId, module_id: module.id })
                      disclosure.toggle(module.id)
                    }}
                  >
                    {module.title}
                  </button>
                ) : (
                  module.title
                )}
              </h3>
              {/* DS 08: "“4/4 videos” + ✓ when the module is complete". */}
              <span className={[styles.moduleCount, complete ? styles.moduleComplete : undefined].filter(Boolean).join(' ')}>
                {complete ? <Icon name="check-circle" size={16} /> : null}
                {`${done}/${videos.length} videos`}
                {complete ? <span className="dsVisuallyHidden">, module completed</span> : null}
              </span>
              {disclosure.collapsible ? (
                <Icon
                  name={open ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  className={styles.moduleChevron}
                />
              ) : null}
            </header>

            <div id={bodyId} hidden={!open}>
              {lessons.length === 0 ? (
                <p className={styles.emptyModule}>No lesson in this module yet.</p>
              ) : (
                <ul className={styles.lessons}>
                  {lessons.map((lesson) => (
                    <OutlineLessonRow
                      key={lesson.id}
                      lesson={lesson}
                      courseId={courseId}
                      current={lesson.id === currentLessonId}
                    />
                  ))}
                </ul>
              )}
            </div>
          </section>
        )
      })}

      {/* DS 08 "Footer legend: Completed · Current · Not started". A key to
          the markers for the eye; each row already says its state in words,
          so it is hidden from assistive technology rather than read twice. */}
      <div className={styles.legend} aria-hidden="true">
        <span className={styles.legendItem}>
          <span className={[styles.marker, styles.markerCompleted].join(' ')}>
            <Icon name="check" size={13} />
          </span>
          Completed
        </span>
        <span className={styles.legendItem}>
          <span className={[styles.marker, styles.markerCurrent].join(' ')} />
          Current
        </span>
        <span className={styles.legendItem}>
          <span className={[styles.marker, styles.markerNotStarted].join(' ')} />
          Not started
        </span>
      </div>
    </nav>
  )
}
