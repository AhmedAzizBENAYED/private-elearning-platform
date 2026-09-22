import { type ReactNode, useId } from 'react'

/** Props every labelled form control in the design system accepts. */
export interface FieldProps {
  label: string
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  disabled?: boolean
  /**
   * Hides the label visually while keeping it for assistive technology. Use
   * only where the surrounding design makes the field's purpose obvious, as the
   * catalogue's search box does.
   */
  hideLabel?: boolean
  /** Supply only to match an id the surrounding page already owns. */
  id?: string
  className?: string
}

export interface FieldA11y {
  controlId: string
  messageId: string | undefined
  describedBy: string | undefined
  invalid: boolean
}

/**
 * Derives the ids and ARIA wiring a labelled control needs.
 *
 * Only one message is ever rendered - the error replaces the hint, as on the
 * DS 05 board - so `aria-describedby` points at exactly the text on screen and
 * never at a node that does not exist.
 */
export function useFieldA11y(
  id: string | undefined,
  hint: ReactNode,
  error: ReactNode,
): FieldA11y {
  const generated = useId()
  const controlId = id ?? generated
  const invalid = Boolean(error)
  const hasMessage = invalid || Boolean(hint)
  const messageId = hasMessage ? `${controlId}-message` : undefined

  return { controlId, messageId, describedBy: messageId, invalid }
}
