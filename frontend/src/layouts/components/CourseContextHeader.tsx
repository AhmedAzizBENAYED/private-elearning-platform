import { Link, NavLink } from 'react-router-dom'

import type { UUID } from '../../api'
import { routes } from '../../app/routes'
import logo from '../../assets/logo-color.png'
import { Icon, Progress } from '../../design-system'
import type { CourseHeaderInfo } from '../courseHeader'

import styles from './CourseContextHeader.module.css'
import { UserMenu } from './UserMenu'

export interface CourseContextHeaderProps {
  /** `phone` below 600px (Learning-Mobile), `tablet` from 600 to 1023px (Learning-Tablet). */
  variant: 'phone' | 'tablet'
  courseId: UUID
  /** `null` while the page is still reading the course, or could not. */
  info: CourseHeaderInfo | null
}

/**
 * The learning page's header below 1024px (G27), in place of the member header.
 *
 * Phone (Learning-Mobile): "Back to course", the module and the course, the
 * account chip - 60px, no navigation, as the board draws it; the bottom bar is
 * hidden on this page (DS 07), so this is the whole shell.
 *
 * Tablet (Learning-Tablet): the logo home, the module and the course, the
 * course progress, the account chip - 72px. The course title leads back to the
 * course, the destination the phone's back arrow and the laptop's breadcrumb
 * both offer.
 *
 * From 1024px the ordinary member header returns and the page shows its own
 * breadcrumb bar (Learning-Laptop); that choice is `MemberLayout`'s.
 */
export function CourseContextHeader({ variant, courseId, info }: CourseContextHeaderProps) {
  const context =
    info === null ? null : (
      <span className={styles.context}>
        {info.moduleLabel === null ? null : (
          <span className={styles.module}>{info.moduleLabel}</span>
        )}
        {variant === 'tablet' ? (
          <Link to={routes.course(courseId)} className={styles.courseLink}>
            {info.courseTitle}
          </Link>
        ) : (
          <span className={styles.course}>{info.courseTitle}</span>
        )}
      </span>
    )

  if (variant === 'phone') {
    return (
      <header className={[styles.header, styles.phone].join(' ')}>
        <Link to={routes.course(courseId)} className={styles.back} aria-label="Back to course">
          <Icon name="arrow-left" size={22} />
        </Link>
        {context ?? <span className={styles.context} />}
        <UserMenu />
      </header>
    )
  }

  const percent = info === null ? null : Math.round(info.progressPercent)

  return (
    <header className={[styles.header, styles.tablet].join(' ')}>
      <div className={styles.left}>
        <NavLink to={routes.dashboard} className={styles.logoLink}>
          <img className={styles.logo} src={logo} alt="JEENISo — home" width={120} height={53} />
        </NavLink>
        <span className={styles.divider} aria-hidden="true" />
        {context}
      </div>

      <div className={styles.right}>
        {percent === null ? null : (
          <div className={styles.progress}>
            <span className={styles.percent} aria-hidden="true">{`${percent}%`}</span>
            <Progress value={percent} size={6} label="Course progress" className={styles.bar} />
          </div>
        )}
        <UserMenu compact />
      </div>
    </header>
  )
}
