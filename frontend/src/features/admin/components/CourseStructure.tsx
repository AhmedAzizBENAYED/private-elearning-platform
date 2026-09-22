import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useApiClient } from '../../../api'
import { Button, ConfirmDialog, Skeleton, SkeletonGroup } from '../../../design-system'
import { createAdminApi, type AdminLesson, type AdminModule, type LessonResource } from '../api'
import { nextPosition, type ModuleWithLessons } from '../structureModel'
import { classifyWrite, type CourseWriteFailure } from '../useAdminCourse'
import { useStructureMoves, type MoveFailure } from '../useStructureMoves'

import { ModuleDialog, type ModuleDialogMode } from './ModuleDialog'
import { ModuleCard } from './StructureModule'
import styles from './CourseStructure.module.css'

/** What the page's single toast should say about something done here. */
export interface StructureNotice {
  kind: 'success' | 'error'
  title: string
  body?: string
}

export interface CourseStructureProps {
  courseId: string
  status: 'loading' | 'ready' | 'error'
  modules: ModuleWithLessons[]
  /** Structural writes are draft-only; the backend answers 409 otherwise. */
  editable: boolean
  /** Stored files by lesson id; a lesson absent from it holds none. */
  resources: Readonly<Record<string, LessonResource>>
  /** The resource listing failed, so a lesson's file status is unknown. */
  resourcesFailed: boolean
  update: (change: (modules: ModuleWithLessons[]) => ModuleWithLessons[]) => void
  reload: () => void
  onNotice: (notice: StructureNotice) => void
}

type Target =
  | { kind: 'module'; module: AdminModule; lessonCount: number }
  | { kind: 'lesson'; lesson: AdminLesson }

const DELETE_ERROR: Record<CourseWriteFailure, string> = {
  // The one the backend raises when a stored file still points at the lesson.
  lifecycle:
    'A file is still attached. Remove the lesson’s file first, then delete it.',
  'not-draft': 'The course is no longer a draft, so its structure can’t be changed.',
  'slug-taken': 'The change conflicts with another record.',
  invalid: 'The deletion was rejected as invalid.',
  'not-found': 'It has already been removed. Reload the page.',
  forbidden: 'Your administrator access may have changed. Sign in again.',
  unavailable: 'It could not be deleted. Check your connection and try again.',
}

/**
 * What the failure toast adds under "We couldn’t save the new order". The
 * reorganisation is atomic, so after any refusal the server holds the order
 * shown - which is what the first sentence has always said. The sentences for
 * a course no longer in draft and for lost access are the deletion's own.
 */
const MOVE_ERROR: Record<MoveFailure, string> = {
  unavailable: 'The structure below is what the server holds. Try again in a moment.',
  invalid: 'The structure below is what the server holds. Try again in a moment.',
  'not-draft': DELETE_ERROR['not-draft'],
  forbidden: DELETE_ERROR.forbidden,
  'not-found': DELETE_ERROR['not-found'],
  'slug-taken': 'The structure below is what the server holds. Try again in a moment.',
  // 409 for a structure that is not the course's own any more: a module or a
  // lesson was added or removed since this page read it.
  lifecycle: 'The course’s structure has changed since this page loaded. Reload the page, then try again.',
  incomplete: 'Some lessons couldn’t be loaded, so the new order can’t be saved. Load them again, then retry.',
}

/** Admin-Editor-States' cascade wording, counted from what was read. */
function moduleDeleteBody(lessonCount: number): string {
  if (lessonCount === 0) return 'The module will be removed from the course. This can’t be undone.'
  const lessons = lessonCount === 1 ? 'the 1 lesson' : `the ${lessonCount} lessons`
  return `The module and ${lessons} it contains will be removed from the course. This can’t be undone.`
}

function StructureSkeleton() {
  return (
    <SkeletonGroup label="Loading course structure" className={styles.skeleton}>
      {[0, 1].map((index) => (
        <Skeleton key={index} variant="block" height={120} />
      ))}
    </SkeletonGroup>
  )
}

/**
 * The course's modules and lessons (Admin-Course-Editor, structure half, and
 * the Admin-Editor-States modals).
 *
 * A list of sections rather than a table: a module is a heading with rows under
 * it, and at 390px a table of lessons would be unreadable.
 *
 * Ordering is the backend's `position`, changed one place at a time with the
 * ↑ ↓ buttons (`useStructureMoves`), each press one atomic
 * `PUT /admin/courses/{id}/structure`. The board's drag handles are not drawn
 * yet: the endpoint would keep a drag - and a move to another module - but the
 * control is a ticket of its own, and the buttons are the board's keyboard and
 * touch equivalent.
 *
 * Adding, renaming and deleting are applied to the tree on screen from the
 * server's own answer, rather than by re-reading everything: a re-read swaps
 * the whole structure for a skeleton, and with it the keyboard focus.
 */
export function CourseStructure({
  courseId,
  status,
  modules,
  editable,
  resources,
  resourcesFailed,
  update,
  reload,
  onNotice,
}: CourseStructureProps) {
  const client = useApiClient()
  const api = useMemo(() => createAdminApi(client), [client])
  const [target, setTarget] = useState<Target | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<ModuleDialogMode | null>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  // After an addition or a deletion, the heading focus should land on: a
  // module id, or 'empty' for the empty state. Read by the effect below after
  // the render that the same change causes.
  const focusHeading = useRef<string | null>(null)
  const emptyHeading = useRef<HTMLHeadingElement>(null)

  const onMoveFailed = useCallback(
    (reason: MoveFailure) =>
      onNotice({ kind: 'error', title: 'We couldn’t save the new order', body: MOVE_ERROR[reason] }),
    [onNotice],
  )
  const moves = useStructureMoves({ courseId, modules, update, onFailed: onMoveFailed })

  // Passive, not layout: a dialog that just closed hands focus back to its
  // opener in its own passive cleanup, which runs first - this then moves it
  // on to where the change landed.
  useEffect(() => {
    const target = focusHeading.current
    if (target === null) return
    focusHeading.current = null
    const heading =
      target === 'empty' ? emptyHeading.current : document.getElementById(`module-${target}`)
    heading?.focus()
  })

  const toggle = useCallback((moduleId: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(moduleId)) next.delete(moduleId)
      else next.add(moduleId)
      return next
    })
  }, [])

  const onModuleSaved = useCallback(
    (saved: AdminModule) => {
      const adding = dialog?.kind === 'add'
      setDialog(null)
      update((entries) =>
        adding
          ? [...entries, { module: saved, lessons: [], lessonsFailed: false }].sort(
              (a, b) => a.module.position - b.module.position,
            )
          : entries.map((entry) => (entry.module.id === saved.id ? { ...entry, module: saved } : entry)),
      )
      if (adding) {
        focusHeading.current = saved.id
        onNotice({
          kind: 'success',
          title: 'Module added',
          body: `“${saved.title}” was added to the course.`,
        })
      } else {
        onNotice({ kind: 'success', title: 'Module saved', body: `“${saved.title}” was updated.` })
      }
    },
    [dialog, update, onNotice],
  )

  const confirmDelete = useCallback(() => {
    if (target === null || busy) return
    setBusy(true)
    setError(null)

    const run =
      target.kind === 'module'
        ? api.deleteModule(target.module.id)
        : api.deleteLesson(target.lesson.id)

    void run.then(
      () => {
        setBusy(false)
        setTarget(null)
        if (target.kind === 'module') {
          const index = modules.findIndex((entry) => entry.module.id === target.module.id)
          const neighbour = modules[index + 1] ?? modules[index - 1]
          update((entries) => entries.filter((entry) => entry.module.id !== target.module.id))
          focusHeading.current = neighbour === undefined ? 'empty' : neighbour.module.id
          onNotice({
            kind: 'success',
            title: 'Module deleted',
            body: `“${target.module.title}” was removed from the course.`,
          })
        } else {
          const { lesson } = target
          update((entries) =>
            entries.map((entry) =>
              entry.module.id === lesson.module_id
                ? { ...entry, lessons: entry.lessons.filter((item) => item.id !== lesson.id) }
                : entry,
            ),
          )
          focusHeading.current = lesson.module_id
          onNotice({
            kind: 'success',
            title: 'Lesson deleted',
            body: `“${lesson.title}” was removed from the module.`,
          })
        }
      },
      (failure: unknown) => {
        setBusy(false)
        setError(DELETE_ERROR[classifyWrite(failure)])
      },
    )
  }, [target, busy, api, modules, update, onNotice])

  if (status === 'loading') return <StructureSkeleton />

  if (status === 'error') {
    return (
      <div className={styles.error} role="alert">
        <p className={styles.errorTitle}>We couldn’t load the course structure</p>
        <p className={styles.errorBody}>Something went wrong while contacting the server.</p>
        <Button iconLeft="refresh" onClick={reload}>
          Try again
        </Button>
      </div>
    )
  }

  const lessonCount = modules.reduce((sum, entry) => sum + entry.lessons.length, 0)
  const addModule = () =>
    setDialog({
      kind: 'add',
      courseId,
      position: nextPosition(modules.map((entry) => entry.module)),
    })

  return (
    <div className={styles.structure} aria-busy={moves.moving || undefined}>
      <div className={styles.head}>
        <p className={styles.summary}>
          {`${modules.length} ${modules.length === 1 ? 'module' : 'modules'} · ${lessonCount} ${lessonCount === 1 ? 'lesson' : 'lessons'}`}
        </p>
        {editable && modules.length > 0 ? (
          <Button variant="secondary" iconLeft="plus" onClick={addModule}>
            Add module
          </Button>
        ) : null}
      </div>

      {/* Polite, and not a `status` role: the page's toast is its status. */}
      <p className="dsVisuallyHidden" aria-live="polite">
        {moves.announcement}
      </p>

      {modules.length === 0 ? (
        <div className={styles.empty}>
          <h3 ref={emptyHeading} className={styles.emptyTitle} tabIndex={-1}>
            This course has no modules yet
          </h3>
          <p className={styles.emptyBody}>
            {editable
              ? 'Add a module, then add videos, documents, text or links to it.'
              : 'This course has no module, and its structure can no longer be changed.'}
          </p>
          {editable ? (
            <Button iconLeft="plus" onClick={addModule}>
              Add module
            </Button>
          ) : null}
        </div>
      ) : (
        modules.map((entry, index) => (
          <ModuleCard
            key={entry.module.id}
            courseId={courseId}
            entry={entry}
            resources={resources}
            resourcesFailed={resourcesFailed}
            editable={editable}
            first={index === 0}
            last={index === modules.length - 1}
            collapsed={collapsed.has(entry.module.id)}
            focus={moves.focus}
            onToggle={() => toggle(entry.module.id)}
            onMoveModule={(direction) => moves.moveModule(entry.module.id, direction)}
            onMoveLesson={moves.moveLesson}
            onEdit={() => setDialog({ kind: 'edit', module: entry.module })}
            onDelete={() =>
              setTarget({ kind: 'module', module: entry.module, lessonCount: entry.lessons.length })
            }
            onDeleteLesson={(lesson) => setTarget({ kind: 'lesson', lesson })}
            onRetry={reload}
          />
        ))
      )}

      {dialog === null ? null : (
        <ModuleDialog mode={dialog} onClose={() => setDialog(null)} onSaved={onModuleSaved} />
      )}

      {target === null ? null : (
        <ConfirmDialog
          open
          title={
            target.kind === 'module'
              ? `Delete the module “${target.module.title}”?`
              : `Delete the lesson “${target.lesson.title}”?`
          }
          body={
            <>
              <span>
                {target.kind === 'module'
                  ? moduleDeleteBody(target.lessonCount)
                  : 'This lesson will be removed from the module. This can’t be undone.'}
              </span>
              {error === null ? null : (
                <span className={styles.dialogError} role="alert">
                  {error}
                </span>
              )}
            </>
          }
          confirmLabel={target.kind === 'module' ? 'Delete module' : 'Delete lesson'}
          tone="danger"
          busy={busy}
          onConfirm={confirmDelete}
          onCancel={() => {
            setTarget(null)
            setError(null)
          }}
        />
      )}
    </div>
  )
}
