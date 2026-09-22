import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from 'react'

import thumbOne from '../../../assets/thumb-1.jpg'
import thumbThree from '../../../assets/thumb-3.jpg'
import thumbFour from '../../../assets/thumb-4.jpg'
import { Badge, Icon, Progress, type IconName } from '../../../design-system'
import type { CourseState } from '../../../design-system'

import motion from '../motion.module.css'

import { CheckList, SectionHeading } from './parts'
import styles from './Sections.module.css'

/** The browser frame every illustration sits in: three dots and "JEENISo". */
function Window({ children }: { children: ReactNode }) {
  return (
    <div className={styles.window} aria-hidden="true">
      <div className={styles.windowBar}>
        <span className={styles.windowDots}>
          <span />
          <span />
          <span />
        </span>
        <span className={styles.windowName}>JEENISo</span>
      </div>
      <div className={styles.windowBody}>{children}</div>
    </div>
  )
}

const courses: readonly { image: string; state: CourseState; title: string; modules: string }[] = [
  { image: thumbOne, state: 'in-progress', title: 'Python Fundamentals', modules: '3 modules' },
  { image: thumbThree, state: 'not-enrolled', title: 'Professional Communication', modules: '3 modules' },
  { image: thumbFour, state: 'completed', title: 'Project Management Essentials', modules: '4 modules' },
]

function CoursesIllustration() {
  return (
    <Window>
      <div className={styles.courseGrid}>
        {courses.map((course) => (
          <div key={course.title} className={styles.courseCard}>
            <img src={course.image} alt="" />
            <div className={styles.courseBody}>
              <Badge kind="learning-status" value={course.state} />
              <p className={styles.courseTitle}>{course.title}</p>
              <p className={styles.courseMeta}>
                <Icon name="layers" size={16} />
                <span>{course.modules}</span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </Window>
  )
}

const outline: readonly { state: 'done' | 'current' | 'todo'; type: IconName; title: string }[] = [
  { state: 'done', type: 'video', title: 'Defining a function' },
  { state: 'current', type: 'video', title: 'Parameters and return values' },
  { state: 'todo', type: 'text', title: 'Reading: variable scope' },
  { state: 'todo', type: 'doc', title: 'Cheat sheet (document)' },
  { state: 'todo', type: 'link', title: 'Official reference (link)' },
]

function LessonsIllustration() {
  return (
    <Window>
      <div className={styles.lessonLayout}>
        <div className={styles.player}>
          <img src={thumbOne} alt="" />
          <span className={styles.playerShade} />
          <span className={styles.playerButton}>
            <Icon name="play" size={24} />
          </span>
          <span className={styles.playerTrack}>
            <span className={styles.playerTrackFill} />
          </span>
        </div>
        <div className={styles.outline}>
          <p className={[styles.overline, styles.outlineHead].join(' ')}>Module 2 · Functions</p>
          {outline.map((lesson) => (
            <div
              key={lesson.title}
              className={[styles.outlineRow, lesson.state === 'current' ? styles.outlineCurrent : undefined]
                .filter(Boolean)
                .join(' ')}
            >
              {lesson.state === 'current' ? (
                <span className={styles.outlinePlaying}>
                  <Icon name="play" size={11} />
                </span>
              ) : (
                <Icon
                  name={lesson.state === 'done' ? 'check-circle' : 'circle'}
                  size={20}
                  className={lesson.state === 'done' ? styles.outlineDone : styles.outlineTodo}
                />
              )}
              <Icon name={lesson.type} size={16} className={styles.outlineType} />
              <span className={styles.outlineTitle}>{lesson.title}</span>
            </div>
          ))}
        </div>
      </div>
    </Window>
  )
}

const progress: readonly { title: string; value: number; caption: string }[] = [
  { title: 'Python Fundamentals', value: 45, caption: '5 of 11 videos completed' },
  { title: 'Excel for Engineers', value: 11, caption: '2 of 18 videos completed' },
  { title: 'Project Management Essentials', value: 100, caption: '14 of 14 videos completed' },
]

function ProgressIllustration() {
  return (
    <Window>
      <div className={styles.progressList}>
        {progress.map((course) => (
          <div key={course.title} className={styles.progressCard}>
            <div className={styles.progressHead}>
              <span className={styles.courseTitle}>{course.title}</span>
              {course.value >= 100 ? (
                <Badge kind="learning-status" value="completed" />
              ) : (
                <span className={styles.progressValue}>{course.value}%</span>
              )}
            </div>
            <Progress value={course.value} label={`${course.title} progress ${course.value}%`} />
            <p className={styles.courseMetaPlain}>{course.caption}</p>
          </div>
        ))}
      </div>
    </Window>
  )
}

interface Panel {
  key: string
  tab: string
  title: string
  body: string
  checks: readonly string[]
  illustration: ReactNode
}

const panels: readonly Panel[] = [
  {
    key: 'courses',
    tab: 'Courses',
    title: 'Find your course',
    body: 'Browse every course published by the association. Open one to see its modules and lessons, then enroll in one click.',
    checks: ['Modules and lessons at a glance', 'Start or continue from the same place'],
    illustration: <CoursesIllustration />,
  },
  {
    key: 'lessons',
    tab: 'Lessons',
    title: 'Learn at your own pace',
    body: 'Watch videos, read texts, open documents and follow links from a clear outline. The current lesson is always highlighted.',
    checks: ['Four lesson types in one player page', 'Move to the next lesson in one click'],
    illustration: <LessonsIllustration />,
  },
  {
    key: 'progress',
    tab: 'Progress',
    title: 'See your progress grow',
    body: 'Completed videos are counted for you. Come back to any course and continue right where you stopped.',
    checks: ['A progress bar on every course', 'Reach 100% to finish a course'],
    illustration: <ProgressIllustration />,
  },
]

/**
 * The preview (`#preview`): three tabs - Courses, Lessons, Progress - each
 * with a short text and an illustration of the real screen.
 *
 * The board switches panels with CSS radio buttons; here they are the WAI-ARIA
 * tabs pattern, which says the same thing to assistive technology: a tab list,
 * arrow keys and Home / End between tabs, one panel shown. The illustrations
 * are decoration - "Illustration. The real screens are available after
 * signing in." - so they are hidden from assistive technology and hold no
 * focusable element. Text beside, from 1024px; stacked below.
 */
export function LandingPreview() {
  const [selected, setSelected] = useState(0)
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([])
  const baseId = useId()

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = panels.length - 1
    const next =
      event.key === 'ArrowRight'
        ? (selected + 1) % panels.length
        : event.key === 'ArrowLeft'
          ? (selected - 1 + panels.length) % panels.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null
    if (next === null) return
    event.preventDefault()
    setSelected(next)
    tabsRef.current[next]?.focus()
  }

  return (
    <section id="preview" className={[styles.section, styles.blue].join(' ')} aria-labelledby="preview-title">
      <SectionHeading
        id="preview-title"
        overline="See it in action"
        title="A quick look inside"
        lede="Three things you will do every day."
      />

      {/* The tabs, their panels and the note unfold as they scroll in. */}
      <div className={motion.unfold}>
        <div className={styles.tabList} role="tablist" aria-label="Preview of the platform" onKeyDown={onKeyDown}>
          {panels.map((panel, index) => (
            <button
              key={panel.key}
              ref={(element) => {
                tabsRef.current[index] = element
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${panel.key}`}
              aria-selected={index === selected}
              aria-controls={`${baseId}-panel-${panel.key}`}
              tabIndex={index === selected ? 0 : -1}
              className={styles.tab}
              onClick={() => setSelected(index)}
            >
              {panel.tab}
            </button>
          ))}
        </div>

        {panels.map((panel, index) => (
          <div
            key={panel.key}
            role="tabpanel"
            id={`${baseId}-panel-${panel.key}`}
            aria-labelledby={`${baseId}-tab-${panel.key}`}
            hidden={index !== selected}
            className={styles.panel}
          >
            <div className={styles.panelText}>
              <p className={styles.overline}>{panel.tab}</p>
              <h3 className={styles.panelTitle}>{panel.title}</h3>
              <p className={styles.panelBody}>{panel.body}</p>
              <CheckList items={panel.checks} size="sm" />
            </div>
            {panel.illustration}
          </div>
        ))}

        <p className={styles.note}>
          <Icon name="info" size={16} />
          Illustration. The real screens are available after signing in.
        </p>
      </div>
    </section>
  )
}
