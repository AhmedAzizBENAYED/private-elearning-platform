import type { InputHTMLAttributes, ReactNode } from 'react'

import { Icon, type IconName } from '../../icons'
import { FieldShell, type FieldProps, useFieldA11y } from '../Field'
import surface from '../Field/surface.module.css'

export interface TextFieldProps
  extends FieldProps,
    Omit<
      InputHTMLAttributes<HTMLInputElement>,
      'id' | 'className' | 'required' | 'disabled' | 'aria-invalid' | 'aria-describedby'
    > {
  /** Decorative glyph inside the box, before the input (DS 05 "With icon"). */
  iconLeft?: IconName
  /**
   * Affordance rendered inside the box after the input - the password reveal
   * toggle on the board. Must be a real focusable control with its own
   * accessible name.
   */
  rightSlot?: ReactNode
}

/**
 * Single-line text input (DS 05).
 *
 * The label is always rendered above the control; a placeholder never stands in
 * for it. When `error` is set the message replaces the hint, the box turns red
 * and the input is marked `aria-invalid`, so the failure is carried by border
 * weight, an icon and text - never by colour alone.
 */
export function TextField({
  label,
  hint,
  error,
  required = false,
  disabled = false,
  hideLabel = false,
  id,
  className,
  iconLeft,
  rightSlot,
  ...inputProps
}: TextFieldProps) {
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
          a11y.invalid ? surface.invalid : undefined,
          disabled ? surface.disabled : undefined,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {iconLeft ? (
          <span className={surface.adornment}>
            <Icon name={iconLeft} size={20} />
          </span>
        ) : null}

        <input
          {...inputProps}
          id={a11y.controlId}
          disabled={disabled}
          required={required}
          aria-required={required || undefined}
          aria-invalid={a11y.invalid || undefined}
          aria-describedby={a11y.describedBy}
          className={[
            surface.control,
            iconLeft ? surface.controlFlush : undefined,
            rightSlot ? surface.controlFlushEnd : undefined,
          ]
            .filter(Boolean)
            .join(' ')}
        />

        {rightSlot}
      </div>
    </FieldShell>
  )
}
