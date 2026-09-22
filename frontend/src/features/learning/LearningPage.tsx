import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { routes } from '../../app/routes'
import { Skeleton, SkeletonGroup, media, useMediaQuery } from '../../design-system'
import { usePublishCourseHeader } from '../../layouts/courseHeader'
import { useLearningEventOnOpen } from '../courses'
import { MessagePage } from '../../pages/MessagePage'
import { ServerErrorPage } from '../../pages/ServerErrorPage'

import { CourseCompleted } from './components/CourseCompleted'
import { LearningHeader } from './components/LearningHeader'
import { LearningOutline } from './components/LearningOutline'
import { LessonContent } from './components/LessonContent'
import { LessonHeader } from './components/LessonHeader'
import { LessonNavigation } from './components/LessonNavigation'
import { LinkButton } from '../../app/LinkButton'
import styles from './LearningPage.module.css'
import { courseCompletionLessonId } from './model'
import { useLearning } from './useLearning'

/** Holds the page's shape while the course tree is on its way (DS 06). */
function LearningSkeleton() {
  return (
    <SkeletonGroup label="Loading course" className={styles.skeleton}>
      <Skeleton variant="text" width="40%" />
      <Skeleton variant="block" height={280} />
      <Skeleton variant="text" width="70%" />
      <Skeleton variant="text" width="50%" />
    </SkeletonGroup>
  )
}

/**
 * The member learning page (`/courses/:courseId/lessons/:lessonId`).
 *
 * The URL is the single source of truth for which lesson is open: the selected
 * lesson is derived from `lessonId` on every render, never held in state, so
 * back, forward, refresh and a pasted link all behave the same way and a
 * sidebar click is an ordinary router navigation.
 *
 * The page owns navigation and layout; the player owns playback and the
 * progress writes behind it. Completion is never decided here: a lesson is
 * marked complete in the sidebar only once the backend has confirmed it.
 */
export function LearningPage() {
  const { courseId = '', lessonId = '' } = useParams<{ courseId: string; lessonId: string }>()
  const navigate = useNavigate()
  const {
    api,
    courseStatus,
    content,
    lessonStatus,
    placement,
    lessonContent,
    reloadCourse,
    reloadLesson,
    applyProgress,
  } = useLearning(courseId, lessonId)

  // FE-LEARNING-TRACKING-01. Both wait for the course the server returned, so
  // nothing is sent for a course the member cannot read. The course is opened
  // once per visit to its learning page - moving between its lessons keeps it
  // open - and each lesson the URL names is opened as the route reaches it:
  // outline, Previous/Next, "Next lesson", a pasted link, back and forward.
  useLearningEventOnOpen(courseStatus === 'ready' ? { type: 'course_opened', courseId } : null)
  useLearningEventOnOpen(
    placement === null
      ? null
      : { type: 'lesson_opened', courseId, moduleId: placement.module.id, lessonId: placement.lesson.id },
  )

  const moduleLabel =
    placement === null ? null : `Module ${placement.module.position} · ${placement.module.title}`
  // G27: below 1024px the shell's contextual header names the course and its
  // progress (Learning-Mobile, Learning-Tablet), so the page's own breadcrumb
  // bar - Learning-Laptop's - is drawn from 1024px only.
  const isLaptop = useMediaQuery(media.mdAndUp)
  usePublishCourseHeader(
    content === null
      ? null
      : { courseTitle: content.title, moduleLabel, progressPercent: content.progress_percent },
  )

  const nextLessonId = placement?.next?.id ?? null
  // The player offers "Next lesson" after the video ends; it never navigates
  // on its own, so this only runs when the member asks for it.
  const goToNext = useCallback(() => {
    if (nextLessonId !== null) navigate(routes.lesson(courseId, nextLessonId))
  }, [navigate, courseId, nextLessonId])

  // Arriving at a new lesson should start at its beginning, not wherever the
  // previous one was scrolled to. Skipped when already at the top, which also
  // keeps jsdom quiet in tests.
  useEffect(() => {
    if ((globalThis.scrollY ?? 0) > 0) globalThis.scrollTo({ top: 0, behavior: 'smooth' })
  }, [lessonId])

  // Course-Completed: shown in place of the lesson that finished the course,
  // once the backend says the course is complete - never for opening a lesson
  // or starting a video. "Review course" shows that lesson instead, for this
  // visit; coming back to it shows the screen again.
  const completionLessonId = content === null ? null : courseCompletionLessonId(content)
  const [reviewing, setReviewing] = useState<string | null>(null)
  const showCompleted =
    completionLessonId !== null && placement?.lesson.id === completionLessonId && reviewing !== lessonId
  const reviewLesson = useCallback(() => setReviewing(lessonId), [lessonId])

  // Whether the course became complete while this page was open (a video
  // ended and the server confirmed it), as opposed to arriving on a course
  // already complete: only the former moves focus to the news.
  const wasComplete = useRef<boolean | null>(null)
  const [justCompleted, setJustCompleted] = useState(false)
  const complete = content === null ? null : content.completed
  useEffect(() => {
    if (complete === null) return
    if (wasComplete.current === false && complete) setJustCompleted(true)
    wasComplete.current = complete
  }, [complete])

  if (courseStatus === 'loading') {
    return (
      <div className={styles.page}>
        <LearningSkeleton />
      </div>
    )
  }

  if (courseStatus === 'not-enrolled') {
    // `course_content` checks enrollment before anything else, so its 404 says
    // this member may not read the course - not that it does not exist. The
    // backend decides that; the page only reports it. The copy is Access-States'
    // "Learning page · not enrolled"; the board names the course, but the
    // refusal carries no title and a second request for one sentence is not
    // worth it, so the course stays unnamed.
    return (
      <div className={styles.page}>
        <MessagePage
          icon="lock"
          tone="neutral"
          title="Enroll to open this lesson"
          body="You need to be enrolled in this course to watch its lessons and track your progress."
          action={
            <LinkButton to={routes.course(courseId)} iconRight="arrow-right">
              Go to the course
            </LinkButton>
          }
        />
      </div>
    )
  }

  if (courseStatus === 'error' || content === null) {
    return (
      <div className={styles.page}>
        <ServerErrorPage onRetry={reloadCourse} />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      {isLaptop ? (
        <LearningHeader courseId={courseId} content={content} moduleLabel={moduleLabel} />
      ) : null}

      <div className={styles.columns}>
        <div className={styles.lesson}>
          {placement === null ? (
            // The URL names a lesson this course does not contain. Showing
            // another lesson here would let a wrong link display unrelated
            // content as though it were the one that was asked for.
            <div className={styles.stateCard}>
              <MessagePage
                icon="alert"
                tone="neutral"
                title="This lesson isn’t available"
                body="It may have been removed, or the link may be incorrect. Pick a lesson from the course content."
                action={
                  <LinkButton to={routes.course(courseId)} variant="secondary" iconLeft="arrow-left">
                    Back to the course
                  </LinkButton>
                }
              />
            </div>
          ) : showCompleted ? (
            <CourseCompleted content={content} onReview={reviewLesson} focusTitle={justCompleted} />
          ) : (
            <>
              <LessonHeader placement={placement} />

              <LessonContent
                lesson={placement.lesson}
                detail={lessonContent}
                status={lessonStatus === 'unavailable' ? 'ready' : lessonStatus}
                onRetry={reloadLesson}
                api={api}
                nextLessonTitle={placement.next?.title ?? null}
                onNext={nextLessonId === null ? null : goToNext}
                onProgressConfirmed={applyProgress}
              />

              <LessonNavigation
                courseId={courseId}
                previous={placement.previous}
                next={placement.next}
              />
            </>
          )}
        </div>

        {/* The sidebar is built from the single course-content response and
            stays available even when the selected lesson cannot be shown. */}
        <aside className={styles.sidebar}>
          <LearningOutline
            content={content}
            courseId={courseId}
            currentLessonId={placement === null ? null : placement.lesson.id}
          />
        </aside>
      </div>
    </div>
  )
}
