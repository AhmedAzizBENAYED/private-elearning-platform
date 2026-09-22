import { useLayoutEffect, useRef } from 'react'

import { LinkButton } from '../../../app/LinkButton'
import { routes } from '../../../app/routes'
import { Badge, Button, Icon } from '../../../design-system'
import type { AdminLesson, LessonResource } from '../api'
import { lessonMeta, type ModuleWithLessons } from '../structureModel'
import type { Direction } from '../structureMoves'

import styles from './CourseStructure.module.css'

/** The row that should hold focus after a move, and on which arrow. */
export interface MoveFocus {
  id: string
  direction: Direction
  /** Changes on every move, so the same row moved twice is refocused twice. */
  seq: number
}

/**
 * Keeps focus on the arrow that was pressed after its row moved.
 *
 * React moves the row's node, and a moved node loses focus in most browsers.
 * When the row has reached an end, the pressed arrow is now disabled, so focus
 * goes to the other one rather than to the document body.
 */
function useMoveFocus(id: string, request: MoveFocus | null) {
  // A container rather than a ref per arrow: `Button` does not forward refs.
  const container = useRef<HTMLSpanElement & HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (request === null || request.id !== id) return
    const arrow = (direction: Direction) =>
      container.current?.querySelector<HTMLButtonElement>(`[data-move="${direction}"]`) ?? null
    const pressed = arrow(request.direction)
    const other = arrow(request.direction === 'up' ? 'down' : 'up')
    ;(pressed !== null && !pressed.disabled ? pressed : other)?.focus()
  }, [id, request])

  return container
}

/** The ↑ ↓ pair. Disabled at an end, as the board draws it. */
function MoveButtons({
  noun,
  first,
  last,
  onMove,
}: {
  noun: 'module' | 'lesson'
  first: boolean
  last: boolean
  onMove: (direction: Direction) => void
}) {
  return (
    <>
      <Button
        data-move="up"
        variant="tertiary"
        iconOnly
        iconLeft="arrow-up"
        aria-label={`Move ${noun} up`}
        disabled={first}
        onClick={() => onMove('up')}
      />
      <Button
        data-move="down"
        variant="tertiary"
        iconOnly
        iconLeft="arrow-down"
        aria-label={`Move ${noun} down`}
        disabled={last}
        onClick={() => onMove('down')}
      />
    </>
  )
}

export interface LessonRowProps {
  courseId: string
  lesson: AdminLesson
  resource: LessonResource | null
  resourcesFailed: boolean
  editable: boolean
  first: boolean
  last: boolean
  focus: MoveFocus | null
  onMove: (direction: Direction) => void
  onDelete: () => void
}

/**
 * One lesson (Admin-Course-Editor): the type, the title, one line saying what
 * it holds, its position, and the actions. "Upload resource" appears only for
 * a VIDEO or DOCUMENT lesson with no file yet, and opens the lesson editor on
 * its file field, where the upload, the replacement and the removal all live.
 */
export function LessonRow({
  courseId,
  lesson,
  resource,
  resourcesFailed,
  editable,
  first,
  last,
  focus,
  onMove,
  onDelete,
}: LessonRowProps) {
  const actions = useMoveFocus(lesson.id, focus)
  const meta = lessonMeta(lesson, resource, resourcesFailed)

  return (
    <li className={styles.lesson}>
      <Badge kind="lesson-type" value={lesson.content_type} />
      <span className={styles.lessonBody}>
        <span className={styles.lessonTitle}>{lesson.title}</span>
        <span className="dsVisuallyHidden">{`, position ${lesson.position}`}</span>
        {meta.missingFile ? (
          <span className={styles.missing}>
            <span className={styles.missingText}>
              <Icon name="alert" size={16} className={styles.missingGlyph} />
              {meta.text}
            </span>
            {editable ? (
              <LinkButton
                variant="secondary"
                iconLeft="upload"
                to={`${routes.adminLessonEdit(courseId, lesson.id)}#lesson-file`}
                aria-label={`Upload resource for ${lesson.title}`}
              >
                Upload resource
              </LinkButton>
            ) : null}
          </span>
        ) : (
          <span className={styles.lessonMeta}>{meta.text}</span>
        )}
      </span>
      {lesson.is_preview ? (
        <span className={styles.preview}>
          <Icon name="eye" size={14} />
          <span>Preview</span>
        </span>
      ) : null}
      <span className={styles.lessonPosition} aria-hidden="true">
        {`#${lesson.position}`}
      </span>
      {editable ? (
        <span ref={actions} className={styles.actions}>
          <MoveButtons noun="lesson" first={first} last={last} onMove={onMove} />
          <LinkButton
            variant="tertiary"
            iconOnly
            iconLeft="edit"
            to={routes.adminLessonEdit(courseId, lesson.id)}
            aria-label={`Edit lesson ${lesson.title}`}
          />
          <Button
            variant="tertiary"
            iconOnly
            iconLeft="trash"
            aria-label={`Delete lesson ${lesson.title}`}
            onClick={onDelete}
          />
        </span>
      ) : null}
    </li>
  )
}

export interface ModuleCardProps {
  courseId: string
  entry: ModuleWithLessons
  resources: Readonly<Record<string, LessonResource>>
  resourcesFailed: boolean
  editable: boolean
  first: boolean
  last: boolean
  collapsed: boolean
  focus: MoveFocus | null
  onToggle: () => void
  onMoveModule: (direction: Direction) => void
  onMoveLesson: (lesson: AdminLesson, direction: Direction) => void
  onEdit: () => void
  onDelete: () => void
  onDeleteLesson: (lesson: AdminLesson) => void
  onRetry: () => void
}

/**
 * One module: numbered header with its actions, then its lessons.
 *
 * The heading takes focus programmatically (`tabIndex={-1}`) so a deletion or
 * an addition can leave focus somewhere meaningful rather than on the body.
 */
export function ModuleCard({
  courseId,
  entry,
  resources,
  resourcesFailed,
  editable,
  first,
  last,
  collapsed,
  focus,
  onToggle,
  onMoveModule,
  onMoveLesson,
  onEdit,
  onDelete,
  onDeleteLesson,
  onRetry,
}: ModuleCardProps) {
  const { module, lessons, lessonsFailed } = entry
  const actions = useMoveFocus(module.id, focus)
  const headingId = `module-${module.id}`
  const bodyId = `module-${module.id}-lessons`

  return (
    <section className={styles.module} aria-labelledby={headingId}>
      <header className={styles.moduleHead}>
        <span className={styles.moduleNumber} aria-hidden="true">
          {String(module.position).padStart(2, '0')}
        </span>
        <div className={styles.moduleText}>
          <h3 id={headingId} className={styles.moduleTitle} tabIndex={-1}>
            {module.title}
          </h3>
          <span className={styles.moduleCount}>
            {`${lessons.length} ${lessons.length === 1 ? 'lesson' : 'lessons'}`}
          </span>
        </div>
        <div ref={actions} className={styles.actions}>
          {editable ? (
            <>
              <MoveButtons noun="module" first={first} last={last} onMove={onMoveModule} />
              <Button
                variant="tertiary"
                iconOnly
                iconLeft="edit"
                aria-label={`Edit module ${module.title}`}
                onClick={onEdit}
              />
              <Button
                variant="tertiary"
                iconOnly
                iconLeft="trash"
                aria-label={`Delete module ${module.title}`}
                onClick={onDelete}
              />
            </>
          ) : null}
          <Button
            variant="tertiary"
            iconOnly
            iconLeft={collapsed ? 'chevron-down' : 'chevron-up'}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} module ${module.title}`}
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            onClick={onToggle}
          />
        </div>
      </header>

      <div id={bodyId} hidden={collapsed}>
        {lessonsFailed ? (
          <p className={styles.lessonsFailed} role="alert">
            This module’s lessons couldn’t be read.{' '}
            <Button variant="tertiary" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </p>
        ) : lessons.length === 0 ? (
          <p className={styles.noLessons}>No lessons yet.</p>
        ) : (
          <ul className={styles.lessons}>
            {lessons.map((lesson, index) => (
              <LessonRow
                key={lesson.id}
                courseId={courseId}
                lesson={lesson}
                resource={resources[lesson.id] ?? null}
                resourcesFailed={resourcesFailed}
                editable={editable}
                first={index === 0}
                last={index === lessons.length - 1}
                focus={focus}
                onMove={(direction) => onMoveLesson(lesson, direction)}
                onDelete={() => onDeleteLesson(lesson)}
              />
            ))}
          </ul>
        )}

        {editable ? (
          <div className={styles.moduleFoot}>
            <LinkButton
              variant="secondary"
              iconLeft="plus"
              to={routes.adminLessonNew(courseId, module.id)}
            >
              Add lesson
            </LinkButton>
          </div>
        ) : null}
      </div>
    </section>
  )
}

