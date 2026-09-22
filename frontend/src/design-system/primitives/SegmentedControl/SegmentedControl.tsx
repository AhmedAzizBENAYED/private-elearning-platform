import { type KeyboardEvent, type ReactNode, useCallback, useId, useRef } from 'react'

import { Icon, type IconName } from '../../icons'
import fieldStyles from '../Field/Field.module.css'

import styles from './SegmentedControl.module.css'

export interface SegmentedOption<Value extends string> {
  value: Value
  label: string
  icon?: IconName
  disabled?: boolean
}

export interface SegmentedControlProps<Value extends string> {
  label: string
  options: SegmentedOption<Value>[]
  value: Value
  onChange: (value: Value) => void
  hint?: ReactNode
  disabled?: boolean
  /**
   * Keeps the label for assistive technology but takes it off the page, as
   * `TextField` and `Select` already do. For a control whose own options say
   * what it chooses - the view switch beside a page title - the printed label
   * would be a second title.
   */
  hideLabel?: boolean
  className?: string
}

/**
 * An exclusive chooser rendered as one joined row (DS 05).
 *
 * Handoff-Components asks for radio-group semantics, so this is a
 * `role="radiogroup"` with roving tabindex: the group holds one tab stop and
 * the arrow keys move between options, matching how a native radio group
 * behaves. Arrow keys both move focus and select, which is the expected
 * behaviour for a radio group whose options carry no side effects.
 */
export function SegmentedControl<Value extends string>({
  label,
  options,
  value,
  onChange,
  hint,
  disabled = false,
  hideLabel = false,
  className,
}: SegmentedControlProps<Value>) {
  const groupId = useId()
  const labelId = `${groupId}-label`
  const hintId = hint ? `${groupId}-hint` : undefined
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])

  const selectableIndexes = options
    .map((option, index) => (option.disabled || disabled ? -1 : index))
    .filter((index) => index !== -1)

  const select = useCallback(
    (index: number) => {
      const option = options[index]
      if (!option || option.disabled) return
      optionRefs.current[index]?.focus()
      if (option.value !== value) onChange(option.value)
    },
    [onChange, options, value],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (selectableIndexes.length === 0) return

      const position = selectableIndexes.indexOf(index)
      let target: number | undefined

      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          target = selectableIndexes[(position + 1) % selectableIndexes.length]
          break
        case 'ArrowLeft':
        case 'ArrowUp':
          target =
            selectableIndexes[(position - 1 + selectableIndexes.length) % selectableIndexes.length]
          break
        case 'Home':
          target = selectableIndexes[0]
          break
        case 'End':
          target = selectableIndexes[selectableIndexes.length - 1]
          break
        default:
          return
      }

      if (target === undefined) return
      event.preventDefault()
      select(target)
    },
    [select, selectableIndexes],
  )

  // Keep exactly one option in the tab order: the selected one, or the first
  // selectable one when the current value is not in the list.
  const selectedIndex = options.findIndex((option) => option.value === value)
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : (selectableIndexes[0] ?? 0)

  return (
    <div className={[styles.wrapper, className].filter(Boolean).join(' ')}>
      <span
        className={[fieldStyles.label, hideLabel ? fieldStyles.labelHidden : undefined]
          .filter(Boolean)
          .join(' ')}
        id={labelId}
      >
        {label}
      </span>

      <div
        className={styles.group}
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={hintId}
      >
        {options.map((option, index) => {
          const selected = option.value === value

          return (
            <button
              key={option.value}
              ref={(node) => {
                optionRefs.current[index] = node
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={index === tabbableIndex ? 0 : -1}
              disabled={disabled || option.disabled}
              className={[styles.option, selected ? styles.selected : undefined]
                .filter(Boolean)
                .join(' ')}
              onClick={() => select(index)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {option.icon ? <Icon name={option.icon} size={18} /> : null}
              <span className={styles.label}>{option.label}</span>
            </button>
          )
        })}
      </div>

      {hint ? (
        <p className={fieldStyles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}
