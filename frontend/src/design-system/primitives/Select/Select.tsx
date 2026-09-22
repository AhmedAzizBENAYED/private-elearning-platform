import type { SelectHTMLAttributes } from 'react'

import { Icon } from '../../icons'
import { FieldShell, type FieldProps, useFieldA11y } from '../Field'
import surface from '../Field/surface.module.css'

import styles from './Select.module.css'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps
  extends FieldProps,
    Omit<
      SelectHTMLAttributes<HTMLSelectElement>,
      | 'id'
      | 'className'
      | 'required'
      | 'disabled'
      | 'children'
      | 'aria-invalid'
      | 'aria-describedby'
    > {
  options: SelectOption[]
  /**
   * Shown as a selected-but-invalid first entry, the way a native select
   * expresses "nothing chosen yet". Omit it when a value is always present.
   */
  placeholder?: string
}

/**
 * Single-choice dropdown (DS 05), built on the native `<select>`.
 *
 * `hideLabel` is destructured rather than left in `selectProps`: it belongs to
 * `FieldShell`, and anything not destructured here is spread onto the native
 * element, where it would be an unknown attribute and silently do nothing.
 */
export function Select({
  label,
  hint,
  error,
  required = false,
  disabled = false,
  hideLabel = false,
  id,
  className,
  options,
  placeholder,
  ...selectProps
}: SelectProps) {
  const a11y = useFieldA11y(id, hint, error)

  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={required}
      disabled={disabled}
      hideLabel={hideLabel}
      className={className}
      a11y={a11y}
    >
      <div
        className={[
          surface.surface,
          surface.row,
          styles.wrapper,
          a11y.invalid ? surface.invalid : undefined,
          disabled ? surface.disabled : undefined,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <select
          {...selectProps}
          id={a11y.controlId}
          disabled={disabled}
          required={required}
          aria-required={required || undefined}
          aria-invalid={a11y.invalid || undefined}
          aria-describedby={a11y.describedBy}
          className={[surface.control, styles.select].join(' ')}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>

        <Icon name="chevron-down" size={20} className={styles.chevron} />
      </div>
    </FieldShell>
  )
}
