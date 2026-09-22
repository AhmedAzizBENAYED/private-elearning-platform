import type { CourseCardModel } from '../courseCard'

import { CourseCard } from './CourseCard'
import styles from './CourseGrid.module.css'

export interface CourseGridProps {
  courses: readonly CourseCardModel[]
  /** Names the list for assistive technology, e.g. "Courses in progress". */
  label: string
}

/**
 * The card grid: three columns on a desktop, two on a tablet, one on a phone
 * (DS 04). A real list, so a screen reader announces how many courses there are.
 */
export function CourseGrid({ courses, label }: CourseGridProps) {
  return (
    <ul className={styles.grid} aria-label={label}>
      {courses.map((course) => (
        <li key={course.courseId} className={styles.item}>
          <CourseCard course={course} />
        </li>
      ))}
    </ul>
  )
}
