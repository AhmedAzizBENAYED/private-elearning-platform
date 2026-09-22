import { useId, type ReactNode } from 'react'

import { Button, type ButtonVariant } from '../../primitives/Button'
import { Dialog } from '../Dialog'

import styles from './ConfirmDialog.module.css'

export interface ConfirmDialogProps {
  /** Rendered only while true; the dialog holds no state of its own. */
  open: boolean
  title: string
  /** The consequence, in the administrator's own terms. */
  body: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** `danger` for a consequence that is hard to undo. */
  tone?: Extract<ButtonVariant, 'primary' | 'danger'>
  /** Shows a spinner on the confirm button and blocks both actions. */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * A modal that asks before acting (DS 06).
 *
 * The modal behaviour itself - scrim, focus moved in and returned, Escape,
 * the Tab wrap - lives in `Dialog`, which this shares with form dialogs. What
 * is specific here is the content: a heading, the consequence, and the two
 * buttons, with the cancelling one first so the dialog opens with focus on
 * the safe choice rather than on the consequential one.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  const bodyId = useId()

  return (
    <Dialog open={open} onClose={onCancel} busy={busy} labelledBy={titleId} describedBy={bodyId}>
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>

      <div id={bodyId} className={styles.body}>
        {body}
      </div>

      <div className={styles.actions}>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button variant={tone} loading={busy} loadingLabel="Saving…" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}
