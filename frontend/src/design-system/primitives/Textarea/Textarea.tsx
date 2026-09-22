import type { TextareaHTMLAttributes } from 'react'

import { FieldShell, type FieldProps, useFieldA11y } from '../Field'
import surface from '../Field/surface.module.css'

import styles from './Textarea.module.css'

export interface TextareaProps
  extends FieldProps,
    Omit<
      TextareaHTMLAttributes<HTMLTextAreaElement>,
      'id' | 'className' | 'required' | 'disabled' | 'aria-invalid' | 'aria-describedby'
    > {
  /**
   * Shows a "used / limit" counter under the control. Purely informational:
   * the limit is not enforced here, because the real limit belongs to whatever
   * API the form talks to.
   */
  maxLength?: number
  /** Current length, when the field is controlled and a counter is wanted. */
  valueLength?: number
}

/** Multi-line text input (DS 05). */
export function Textarea({
  label,
  hint,
  error,
  required = false,
  disabled = false,
  id,
  className,
  rows = 3,
  maxLength,
  valueLength,
  ...textareaProps
}: TextareaProps) {
  const a11y = useFieldA11y(id, hint, error)
  const showCounter = maxLength !== undefined && valueLength !== undefined

  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={required}
      disabled={disabled}
      className={className}
      a11y={a11y}
    >
      <textarea
        {...textareaProps}
        id={a11y.controlId}
        rows={rows}
        disabled={disabled}
        required={required}
        aria-required={required || undefined}
        aria-invalid={a11y.invalid || undefined}
        aria-describedby={a11y.describedBy}
        className={[
          surface.surface,
          surface.control,
          styles.textarea,
          a11y.invalid ? surface.invalid : undefined,
          disabled ? surface.disabled : undefined,
        ]
          .filter(Boolean)
          .join(' ')}
      />

      {showCounter ? (
        <span
          className={[styles.counter, valueLength > maxLength ? styles.counterOver : undefined]
            .filter(Boolean)
            .join(' ')}
          // The count changes on every keystroke; announcing it would flood a
          // screen reader, and the limit is already in the hint.
          aria-hidden="true"
        >
          {valueLength} / {maxLength}
        </span>
      ) : null}
    </FieldShell>
  )
}
