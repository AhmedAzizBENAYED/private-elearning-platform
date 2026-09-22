import { Link } from 'react-router-dom'

import { useRecordLearningEvent } from '../useLearningEvents'
import { useModuleDisclosure } from '../useModuleDisclosure'

import { Badge, Icon } from '../../../design-system'
import type { UUID } from '../../../api'
import { routes } from '../../../app/routes'
import {
  type CourseOutline as CourseOutlineModel,
  type OutlineLesson,
  type OutlineModule,
  formatDuration,
  spokenDuration,
} from '../courseDetails'

import styles from './CourseOutline.module.css'

export interface CourseOutlineProps {
  outline: CourseOutlineModel
  /** The course these lessons belong to, for the link each row points at. */
  courseId: UUID
  /** The first unfinished video, marked "Current lesson" (DS 08). */
  currentLessonId: UUID | null
  /** Enrolled members see completion markers; nobody else has any to see. */
  showProgress: boolean
  /**
   * Whether a row may be opened.
   *
   * False before enrollment: `GET /courses/{id}/content` answers 404 to a
   * member who is not enrolled, so a link could only land on the learning
   * page's "You're not enrolled" state. A row that leads nowhere useful does
   * not claim to be a link.
   */
  navigable: boolean
}

type LessonState = 'completed' | 'current' | 'not-started'

function lessonStateOf(
  lesson: OutlineLesson,
  currentLessonId: UUID | null,
  showProgress: boolean,
): LessonState | null {
  // Only VIDEO lessons carry completion, so only they get a marker at all
  // (DS 08). A non-video lesson shows its type badge instead.
  if (lesson.contentType !== 'VIDEO') return null
  if (!showProgress) return 'not-started'
  if (lesson.completed === true) return 'completed'
  return lesson.id === currentLessonId ? 'current' : 'not-started'
}

const stateLabel: Record<LessonState, string> = {
  completed: 'Completed',
  current: 'Current lesson',
  'not-started': 'Not started',
}

/**
 * One outline row, rendered as a link when the member can open it.
 *
 * Every lesson kind is treated identically: the learning page renders by
 * `content_type`, so a DOCUMENT row is no more or less openable than a VIDEO
 * one. The whole row is the target - marker, title, duration or badge - rather
 * than the title alone, which is what makes it a comfortable tap target.
 */
function LessonRow({
  lesson,
  state,
  courseId,
  navigable,
}: {
  lesson: OutlineLesson
  state: LessonState | null
  courseId: UUID
  navigable: boolean
}) {
  const duration = formatDuration(lesson.durationSeconds)
  const spoken = spokenDuration(lesson.durationSeconds)

  const className = [
    styles.lesson,
    navigable ? styles.lessonLink : undefined,
    state === 'current' ? styles.lessonCurrent : undefined,
  ]
    .filter(Boolean)
    .join(' ')

  // The current lesson is announced as such rather than only tinted.
  const current = state === 'current' ? 'step' : undefined

  const body = (
    <>
      {state === null ? (
        <span className={styles.markerSpacer} aria-hidden="true" />
      ) : (
        <span className={[styles.marker, styles[state]].join(' ')} aria-hidden="true">
          {state === 'completed' ? <Icon name="check" size={14} /> : null}
        </span>
      )}

      <span className={styles.lessonBody}>
        <span className={styles.lessonTitle}>{lesson.title}</span>
        {/* The marker is decorative, so its meaning is carried as real text. */}
        {state === null ? null : <span className="dsVisuallyHidden">{` — ${stateLabel[state]}`}</span>}
      </span>

      {lesson.contentType === 'VIDEO' ? (
        duration === null ? null : (
          <span className={styles.duration}>
            <span aria-hidden="true">{duration}</span>
            <span className="dsVisuallyHidden">{spoken}</span>
          </span>
        )
      ) : (
        <Badge kind="lesson-type" value={lesson.contentType} />
      )}

      {/* Course-Details-Enrolled: "Next up" on the lesson "Continue" opens.
          Its meaning is already spoken ("Current lesson"), so it is hidden
          from assistive technology rather than read twice. */}
      {state === 'current' ? (
        <span className={styles.nextUp} aria-hidden="true">
          Next up
        </span>
      ) : null}
    </>
  )

  return (
    <li>
      {navigable ? (
        // The same router link the learning sidebar uses, so middle-click, back
        // and forward keep the browser's own behaviour, and the selected lesson
        // follows the URL rather than a local selection.
        <Link to={routes.lesson(courseId, lesson.id)} className={className} aria-current={current}>
          {body}
        </Link>
      ) : (
        <span className={className} aria-current={current}>
          {body}
        </span>
      )}
    </li>
  )
}

/** "5 lessons · 4/4 videos completed" (Course-Details-Enrolled). */
function moduleCounter(module: OutlineModule): string {
  const lessons = `${module.lessons.length} ${module.lessons.length === 1 ? 'lesson' : 'lessons'}`
  if (module.completedVideoCount === null || module.videoCount === 0) return lessons
  return `${lessons} · ${module.completedVideoCount}/${module.videoCount} videos completed`
}

function ModuleSection({
  module,
  courseId,
  currentLessonId,
  showProgress,
  navigable,
  open,
  collapsible,
  onToggle,
}: {
  module: OutlineModule
  courseId: UUID
  currentLessonId: UUID | null
  showProgress: boolean
  navigable: boolean
  open: boolean
  collapsible: boolean
  onToggle: () => void
}) {
  const complete =
    module.completedVideoCount !== null &&
    module.videoCount > 0 &&
    module.completedVideoCount === module.videoCount
  const bodyId = `course-module-${module.id}`

  return (
    <section className={styles.module}>
      <header className={styles.moduleHeader}>
        {/* The numeral is the backend's own `position`, not the array index. */}
        <span className={styles.moduleNumber} aria-hidden="true">
          {String(module.position).padStart(2, '0')}
        </span>

        <h3 className={styles.moduleTitle}>
          {collapsible ? (
            // Details-Mobile folds the modules; the whole header is the target
            // (`::after`) while the button's name stays the module's title.
            <button
              type="button"
              className={styles.moduleToggle}
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={onToggle}
            >
              {module.title}
            </button>
          ) : (
            module.title
          )}
        </h3>

        <span className={styles.moduleCount}>
          {moduleCounter(module)}
          {complete ? <Icon name="check" size={14} className={styles.moduleCheck} /> : null}
        </span>

        {collapsible ? (
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} className={styles.moduleChevron} />
        ) : null}
      </header>

      <div id={bodyId} hidden={!open}>
        {module.description === null ? null : (
          <p className={styles.moduleDescription}>{module.description}</p>
        )}

        {module.lessons.length === 0 ? (
          // An empty module is a real backend row and stays visible; hiding it
          // would misrepresent the course structure.
          <p className={styles.emptyModule}>No lesson in this module yet.</p>
        ) : (
          <ul className={styles.lessons}>
            {module.lessons.map((lesson) => (
              <LessonRow
                key={lesson.id}
                lesson={lesson}
                state={lessonStateOf(lesson, currentLessonId, showProgress)}
                courseId={courseId}
                navigable={navigable}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/**
 * The course outline (DS 08: module header + lesson item).
 *
 * Every row is backend data. For an enrolled member each row is a router link
 * to `/courses/:courseId/lessons/:lessonId` - the one learning route - for
 * every lesson kind alike. FE-06 left these rows inert because the learning
 * page did not exist yet; it does now, and the outline is how a member reaches
 * any lesson, including the DOCUMENT, TEXT and LINK lessons that "Continue
 * learning" never points at (it targets the first unfinished VIDEO).
 *
 * Before enrollment the rows stay inert, because the course content endpoint
 * refuses that member and a link could only lead to a refusal.
 *
 * `is_preview` is deliberately not read here. It exists on the lesson schema
 * but the backend enforces nothing with it, so turning it into "playable before
 * enrollment" would invent an authorization rule the server does not have.
 */
export function CourseOutline({
  outline,
  courseId,
  currentLessonId,
  showProgress,
  navigable,
}: CourseOutlineProps) {
  // The module holding the lesson "Continue" opens is the one left open when
  // the modules fold; with no such lesson (not enrolled, or all done), the
  // first one.
  const currentModuleId =
    outline.modules.find((module) => module.lessons.some((lesson) => lesson.id === currentLessonId))
      ?.id ??
    outline.modules[0]?.id ??
    null
  const disclosure = useModuleDisclosure(currentModuleId)
  const record = useRecordLearningEvent()

  return (
    <div className={styles.outline}>
      {outline.modules.map((module) => (
        <ModuleSection
          key={module.id}
          module={module}
          courseId={courseId}
          currentLessonId={currentLessonId}
          showProgress={showProgress}
          navigable={navigable}
          open={disclosure.isOpen(module.id)}
          collapsible={disclosure.collapsible}
          onToggle={() => {
            // Expanding a module is opening it - for an enrolled member only,
            // whose rows lead to lessons; the catalogue preview is not tracked.
            if (navigable && !disclosure.isOpen(module.id)) {
              record({ type: 'module_opened', course_id: courseId, module_id: module.id })
            }
            disclosure.toggle(module.id)
          }}
        />
      ))}
    </div>
  )
}
