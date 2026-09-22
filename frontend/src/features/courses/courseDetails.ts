import type {
  CatalogCourse,
  CatalogLesson,
  CatalogModule,
  ContentType,
  CourseContent,
  CourseContentLesson,
  UUID,
} from '../../api'

/**
 * The course details screen, normalised.
 *
 * Two different backend shapes describe the same outline: an enrolled member
 * gets `GET /courses/{id}/content` (tree + their own progress in one request),
 * and a member who is not enrolled gets the catalog projections
 * (`/courses/{id}/modules` + `/modules/{id}/lessons`), which carry no progress
 * at all. Both are mapped onto the types below so the components never have to
 * know which one they came from.
 *
 * `completed` is `null` wherever the backend genuinely reports nothing - a
 * non-video lesson, or any lesson seen before enrollment. It is never defaulted
 * to `false`, because "not completed" and "no such thing as completion here"
 * are different facts.
 */

export interface OutlineLesson {
  id: UUID
  title: string
  contentType: ContentType
  durationSeconds: number | null
  position: number
  completed: boolean | null
}

export interface OutlineModule {
  id: UUID
  title: string
  description: string | null
  position: number
  lessons: OutlineLesson[]
  /** Videos in this module, and how many are done - `null` before enrollment. */
  videoCount: number
  completedVideoCount: number | null
}

export interface CourseOutline {
  modules: OutlineModule[]
  moduleCount: number
  lessonCount: number
  videoCount: number
}

/** The lesson a "Continue learning" action points at. */
export interface ContinueTarget {
  courseId: UUID
  courseTitle: string
  thumbnailUrl: string | null
  progressPercent: number
  completedVideoLessons: number
  totalVideoLessons: number
  /** `null` when the course holds no unfinished video to resume. */
  lesson: { id: UUID; title: string; modulePosition: number } | null
}

const isVideo = (lesson: { content_type: ContentType }) => lesson.content_type === 'VIDEO'

/**
 * The one ordering strategy for course content.
 *
 * Modules order by `position`, lessons by `position` within their module -
 * the backend's own fields, never a title, an array index or a UUID. The
 * backend already sorts this way (`ORDER BY position, id`), so this is a
 * guarantee rather than a correction: every screen that walks a course - the
 * details outline, the learning sidebar, previous/next - walks it in the same
 * order, because they all go through here.
 *
 * `id` breaks a tie, so two rows sharing a position still order deterministically.
 */
export function byPosition<Item extends { position: number; id: string }>(
  items: readonly Item[],
): Item[] {
  return [...items].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * Finds the first video the member has not completed, in the course's own
 * order.
 *
 * Modules and lessons arrive from the backend already ordered by `position`, so
 * "first" here is the course's own sequence, not an ordering invented on the
 * client. Non-video lessons are skipped because only videos carry completion.
 *
 * Shared by the dashboard's Continue card (FE-04) and the course details page.
 */
export function continueTargetFrom(content: CourseContent): ContinueTarget {
  let lesson: ContinueTarget['lesson'] = null

  outer: for (const module of byPosition(content.modules)) {
    for (const candidate of byPosition(module.lessons)) {
      if (isVideo(candidate) && candidate.completed !== true) {
        lesson = { id: candidate.id, title: candidate.title, modulePosition: module.position }
        break outer
      }
    }
  }

  return {
    courseId: content.course_id,
    courseTitle: content.title,
    thumbnailUrl: content.thumbnail_url,
    progressPercent: content.progress_percent,
    completedVideoLessons: content.completed_video_lessons,
    totalVideoLessons: content.total_video_lessons,
    lesson,
  }
}

function summarise(modules: OutlineModule[]): CourseOutline {
  return {
    modules,
    moduleCount: modules.length,
    lessonCount: modules.reduce((sum, module) => sum + module.lessons.length, 0),
    videoCount: modules.reduce((sum, module) => sum + module.videoCount, 0),
  }
}

function countVideos(lessons: readonly OutlineLesson[]): number {
  return lessons.filter((lesson) => lesson.contentType === 'VIDEO').length
}

/** The outline as an enrolled member sees it: with their own completion. */
export function outlineFromContent(content: CourseContent): CourseOutline {
  return summarise(
    byPosition(content.modules).map((module) => {
      const lessons = byPosition(module.lessons).map(fromContentLesson)
      return {
        id: module.id,
        title: module.title,
        description: module.description,
        position: module.position,
        lessons,
        videoCount: countVideos(lessons),
        // Only videos carry completion, so the module counter counts videos.
        completedVideoCount: lessons.filter((lesson) => lesson.completed === true).length,
      }
    }),
  )
}

function fromContentLesson(lesson: CourseContentLesson): OutlineLesson {
  return {
    id: lesson.id,
    title: lesson.title,
    contentType: lesson.content_type,
    durationSeconds: lesson.duration_seconds,
    position: lesson.position,
    completed: lesson.completed,
  }
}

/**
 * The outline as a member who is not enrolled sees it.
 *
 * The catalog endpoints report no progress whatsoever, so every lesson's
 * `completed` is `null` and each module's completed counter is `null`. The page
 * shows "Not started" markers because there is no progress to show, not because
 * it decided the member has not started.
 */
export function outlineFromCatalog(
  modules: readonly CatalogModule[],
  lessonsByModule: ReadonlyMap<UUID, readonly CatalogLesson[]>,
): CourseOutline {
  return summarise(
    byPosition(modules).map((module) => {
      const lessons = byPosition(lessonsByModule.get(module.id) ?? []).map(
        (lesson): OutlineLesson => ({
          id: lesson.id,
          title: lesson.title,
          contentType: lesson.content_type,
          durationSeconds: lesson.duration_seconds,
          position: lesson.position,
          completed: null,
        }),
      )

      return {
        id: module.id,
        title: module.title,
        description: module.description,
        position: module.position,
        lessons,
        videoCount: countVideos(lessons),
        completedVideoCount: null,
      }
    }),
  )
}

/** The course header, from whichever endpoint supplied it. */
export interface CourseDetailsHeader {
  courseId: UUID
  title: string
  description: string
  thumbnailUrl: string | null
}

export function headerFromCatalog(course: CatalogCourse): CourseDetailsHeader {
  return {
    courseId: course.id,
    title: course.title,
    description: course.description,
    thumbnailUrl: course.thumbnail_url,
  }
}

/**
 * `mm:ss`, or `h:mm:ss` past an hour - the board's own "06:24" / "21:07".
 *
 * `duration_seconds` is optional on every lesson and absent on every non-video
 * one, which is why the caller gets `null` back rather than "00:00".
 */
export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null

  const whole = Math.floor(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const rest = whole % 60
  const pad = (value: number) => String(value).padStart(2, '0')

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`
}

/** A spoken duration, so a screen reader does not read "06:24" as a time. */
export function spokenDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null

  const whole = Math.floor(seconds)
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  const parts: string[] = []
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`)
  if (rest > 0 || minutes === 0) parts.push(`${rest} second${rest === 1 ? '' : 's'}`)

  return parts.join(' ')
}
