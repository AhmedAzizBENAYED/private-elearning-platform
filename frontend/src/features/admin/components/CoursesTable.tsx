import { Link } from 'react-router-dom'

import { LinkButton } from '../../../app/LinkButton'
import { routes } from '../../../app/routes'
import { Badge, Icon } from '../../../design-system'
import { media, useMediaQuery } from '../../../shared/useMediaQuery'
import type { AdminCourse, AdminCourseSummary } from '../api'
import { isEditable, nextTransition, type CourseTransition } from '../courseModel'
import { formatDate } from '../model'

import { RowMenu, type RowMenuItem } from './RowMenu'
import styles from './CoursesTable.module.css'

export interface CoursesTableProps {
  courses: readonly AdminCourseSummary[]
  onTransition: (course: AdminCourse, to: CourseTransition) => void
}

const TRANSITION_LABEL: Record<CourseTransition, string> = {
  publish: 'Publish',
  archive: 'Archive',
}

/**
 * A row's "More actions" (Admin-Courses): View details, Edit course, then the
 * one lifecycle step the course can take. "Edit course" - the course's own
 * information - is offered only while it is a draft, the only state `PATCH`
 * accepts; Publish for a draft, Archive for a published course, nothing for an
 * archived one, each confirmed by the page's existing dialog.
 */
function menuItems(course: AdminCourseSummary, onTransition: CoursesTableProps['onTransition']): RowMenuItem[] {
  const items: RowMenuItem[] = [
    { kind: 'link', label: 'View details', icon: 'eye', to: routes.adminCourse(course.id) },
  ]
  if (isEditable(course)) {
    items.push({ kind: 'link', label: 'Edit course', icon: 'edit', to: routes.adminCourseEdit(course.id) })
  }
  const transition = nextTransition(course.status)
  if (transition !== null) {
    items.push({ kind: 'separator' })
    items.push({
      kind: 'action',
      label: TRANSITION_LABEL[transition],
      icon: transition === 'publish' ? 'check-circle' : 'archive',
      onSelect: () => onTransition(course, transition),
    })
  }
  return items
}

/** The course's thumbnail, or the board's navy tile when it has none. */
function Thumbnail({ url, size }: { url: string | null; size: 'row' | 'card' }) {
  return (
    <span className={[styles.thumb, size === 'card' ? styles.thumbCard : undefined].filter(Boolean).join(' ')}>
      {url === null ? null : <img src={url} alt="" loading="lazy" />}
    </span>
  )
}

function Menu({ course, onTransition, outlined }: { course: AdminCourseSummary; outlined?: boolean } & Pick<CoursesTableProps, 'onTransition'>) {
  return (
    <RowMenu
      label={`More actions for ${course.title}`}
      menuLabel={`Actions for ${course.title}`}
      items={menuItems(course, onTransition)}
      appearance={outlined ? 'outlined' : 'plain'}
    />
  )
}

function EditLink({ course, block }: { course: AdminCourseSummary; block?: boolean }) {
  return (
    <LinkButton
      variant="secondary"
      size={block ? 'md' : 'sm'}
      iconLeft="edit"
      to={routes.adminCourse(course.id)}
      aria-label={`Edit ${course.title}`}
      className={block ? styles.editBlock : undefined}
    >
      Edit
    </LinkButton>
  )
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/**
 * A count the server returned, or `null` when a row arrived without it - shown
 * as nothing rather than as a guessed zero, as the dashboard's table does.
 */
const known = (value: unknown): number | null => (typeof value === 'number' ? value : null)

/**
 * The course list (Admin-Courses, Admin-Tablet, Admin-Mobile-Courses).
 *
 * Three shapes, one mounted at a time as the boards draw them:
 *
 *   >= 1024  the table: Course (thumbnail, title, "Empty course" when it has
 *            no module), Status, Modules, Lessons, Created, Modified, and
 *            Edit + More actions
 *   600-1023 the narrow table: Course, Status, Lessons, Edit
 *   < 600    a card per course: thumbnail, title and badge, "N modules",
 *            "N lessons", "Modified …", then Edit and More actions
 *
 * The counts are the listing's own (`module_count`, `lesson_count`), computed
 * by the server for the page it returns. "Edit" opens the course editor (the
 * board links Admin-Course-Editor.html), whatever the status; the editor
 * itself says what can still change.
 */
export function CoursesTable({ courses, onTransition }: CoursesTableProps) {
  const laptop = useMediaQuery(media.mdAndUp)
  const tablet = useMediaQuery(media.smAndUp)

  if (!tablet) {
    return (
      <ul className={styles.cards} aria-label="Courses">
        {courses.map((course) => (
          <li key={course.id} className={styles.card}>
            <div className={styles.cardHead}>
              <Thumbnail url={course.thumbnail_url} size="card" />
              <div className={styles.cardTitleBlock}>
                <Link className={styles.title} to={routes.adminCourse(course.id)}>
                  {course.title}
                </Link>
                <Badge kind="course-status" value={course.status} />
              </div>
            </div>
            <div className={styles.cardMeta}>
              {known(course.module_count) === null ? null : (
                <span className={styles.metaItem}>
                  <Icon name="layers" size={16} />
                  {plural(course.module_count, 'module')}
                </span>
              )}
              {known(course.lesson_count) === null ? null : (
                <span className={styles.metaItem}>
                  <Icon name="list" size={16} />
                  {plural(course.lesson_count, 'lesson')}
                </span>
              )}
              <span className={styles.modified}>
                Modified <time dateTime={course.updated_at}>{formatDate(course.updated_at)}</time>
              </span>
            </div>
            <div className={styles.cardActions}>
              <EditLink course={course} block />
              <Menu course={course} onTransition={onTransition} outlined />
            </div>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className={styles.frame}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Course</th>
            <th scope="col">Status</th>
            {laptop ? <th scope="col">Modules</th> : null}
            <th scope="col">Lessons</th>
            {laptop ? <th scope="col">Created</th> : null}
            {laptop ? <th scope="col">Modified</th> : null}
            <th scope="col">
              <span className="dsVisuallyHidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {courses.map((course) => (
            <tr key={course.id}>
              <th scope="row" className={styles.courseCell}>
                {laptop ? <Thumbnail url={course.thumbnail_url} size="row" /> : null}
                <span className={styles.titleBlock}>
                  <Link className={styles.title} to={routes.adminCourse(course.id)}>
                    {course.title}
                  </Link>
                  {laptop && known(course.module_count) === 0 ? (
                    <span className={styles.subline}>Empty course</span>
                  ) : null}
                </span>
              </th>
              <td>
                <Badge kind="course-status" value={course.status} />
              </td>
              {laptop ? <td className={styles.number}>{known(course.module_count)}</td> : null}
              <td className={styles.number}>{known(course.lesson_count)}</td>
              {laptop ? (
                <td className={styles.date}>
                  <time dateTime={course.created_at}>{formatDate(course.created_at)}</time>
                </td>
              ) : null}
              {laptop ? (
                <td className={styles.date}>
                  <time dateTime={course.updated_at}>{formatDate(course.updated_at)}</time>
                </td>
              ) : null}
              <td>
                <div className={styles.actions}>
                  <EditLink course={course} />
                  {/* Admin-Tablet draws Edit alone; Publish and Archive stay
                      in the course editor it opens. */}
                  {laptop ? <Menu course={course} onTransition={onTransition} /> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
