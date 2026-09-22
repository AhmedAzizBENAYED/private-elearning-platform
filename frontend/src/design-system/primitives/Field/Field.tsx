import type { ReactNode } from 'react'

import { Icon } from '../../icons'

import { type FieldA11y, type FieldProps } from './useFieldA11y'

import styles from './Field.module.css'

interface FieldShellProps extends Omit<FieldProps, 'id'> {
  a11y: FieldA11y
  children: ReactNode
}

/** Renders the label above the control and the hint or error beneath it. */
export function FieldShell({
  label,
  hint,
  error,
  required = false,
  disabled = false,
  hideLabel = false,
  className,
  a11y,
  children,
}: FieldShellProps) {
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label
        className={[
          styles.label,
          hideLabel ? styles.labelHidden : undefined,
          disabled ? styles.labelDisabled : undefined,
        ]
          .filter(Boolean)
          .join(' ')}
        htmlFor={a11y.controlId}
      >
        {label}
        {required ? (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        ) : null}
      </label>

      {children}

      {a11y.invalid ? (
        <p className={styles.error} id={a11y.messageId}>
          <Icon name="alert" size={16} className={styles.errorIcon} />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p className={styles.hint} id={a11y.messageId}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}
