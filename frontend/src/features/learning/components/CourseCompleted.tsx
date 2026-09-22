import { useEffect, useRef } from 'react'

import type { CourseContent } from '../../../api'
import { LinkButton } from '../../../app/LinkButton'
import { routes } from '../../../app/routes'
import banner from '../../../assets/photo-mesh-band.jpg'
import { Button, Icon, Progress } from '../../../design-system'
import { media, useMediaQuery } from '../../../shared/useMediaQuery'

import styles from './CourseCompleted.module.css'

export interface CourseCompletedProps {
  content: CourseContent
  /** "Review course": the lesson this screen stands in for is shown instead. */
  onReview: () => void
  /**
   * Set when the course has just become complete on this page - the video
   * ended and the server confirmed it - so focus moves to the heading and the
   * news is announced, rather than being left on a player that is gone.
   */
  focusTitle: boolean
}

/**
 * The course-completed screen (Course-Completed, Completion-Mobile boards),
 * shown in the lesson area in place of the lesson that finished the course.
 *
 * Every figure is the backend's: the counts come from `CourseContent`, which
 * matches `GET /courses/{id}/progress`. The two actions are the boards' own:
 * "Back to my courses" to the dashboard (the board links Dashboard.html) and
 * "Review course", a button on the board, which shows the lesson in place.
 *
 * On a phone the board adds the progress bar, drops the course overline (the
 * header already names the course) and puts "Back to my courses" first. The
 * order is chosen here rather than reversed with CSS, so the tab order always
 * follows what is on screen.
 */
export function CourseCompleted({ content, onReview, focusTitle }: CourseCompletedProps) {
  const phone = useMediaQuery(media.belowSm)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const videos = `${content.completed_video_lessons} of ${content.total_video_lessons} videos completed`

  useEffect(() => {
    if (focusTitle) titleRef.current?.focus()
  }, [focusTitle])

  const review = (
    <Button variant="secondary" size="lg" fullWidth={phone} onClick={onReview}>
      Review course
    </Button>
  )
  const back = (
    <LinkButton
      to={routes.dashboard}
      size="lg"
      iconRight="arrow-right"
      className={phone ? styles.fullWidth : undefined}
    >
      Back to my courses
    </LinkButton>
  )

  return (
    <section className={styles.completed} aria-labelledby="course-completed-title">
      <div className={styles.banner}>
        <img className={styles.photo} src={banner} alt="" />
        <div className={styles.band}>
          {/* The figure is shown, and said by the text beside it. */}
          <p className={styles.percent} aria-hidden="true">
            100%
          </p>
          <div className={styles.bandText}>
            <h1 id="course-completed-title" ref={titleRef} tabIndex={-1} className={styles.title}>
              Course completed
            </h1>
            <p className={styles.message}>You have completed all video lessons in this course.</p>
          </div>
        </div>
      </div>

      <div className={styles.summary}>
        <div className={styles.summaryText}>
          {phone ? null : <p className={styles.courseTitle}>{content.title}</p>}
          <p className={styles.count}>
            <Icon name="check-circle" size={20} className={styles.countIcon} />
            {videos}
          </p>
          {phone ? (
            <Progress
              value={content.progress_percent}
              size={10}
              label={`${content.title} progress`}
              className={styles.progress}
            />
          ) : null}
        </div>
        <div className={styles.actions}>
          {phone ? (
            <>
              {back}
              {review}
            </>
          ) : (
            <>
              {review}
              {back}
            </>
          )}
        </div>
      </div>

      <p className={styles.note}>
        <Icon name="info" size={16} className={styles.noteIcon} />
        Text, document and link lessons stay available in the course content list.
      </p>
    </section>
  )
}
