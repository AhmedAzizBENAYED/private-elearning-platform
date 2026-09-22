import { Icon } from '../../icons'

import styles from './FilterTabs.module.css'

export interface FilterTabOption<Value> {
  value: Value
  label: string
  /** The backend's figure for this filter; `null` while unknown, and then not drawn. */
  count: number | null
}

export interface FilterTabsProps<Value> {
  /** Names the group for assistive technology ("Filter by status"). */
  label: string
  options: readonly FilterTabOption<Value>[]
  value: Value
  onChange: (value: Value) => void
  /**
   * `chip` - bordered chips in a wrapping row (Admin-Courses).
   * `tab` - an underlined tab row from 600px, and below it a row of pill
   * chips that scrolls sideways, the selected one checked (Catalogue,
   * Catalogue-Mobile).
   */
  appearance?: 'chip' | 'tab'
}

/**
 * A row of filters with their counts, one of which is on.
 *
 * Real buttons in a named group, each a pressed toggle: a filter is a control
 * on the page, and its state lives in the page's URL. `aria-current` would
 * claim a location, and a `tablist` would promise a tab panel and arrow-key
 * roving that a filter which reloads the list below it does not need - every
 * option stays one Tab stop, and pressing one says so with `aria-pressed`.
 *
 * Extracted from the administrator's status filter (FE-ADMIN-COURSES-LIST-01)
 * so the member catalogue's enrollment tabs (G04) are the same control, not a
 * second one.
 */
export function FilterTabs<Value>({
  label,
  options,
  value,
  onChange,
  appearance = 'chip',
}: FilterTabsProps<Value>) {
  return (
    <div className={[styles.group, styles[appearance]].join(' ')} role="group" aria-label={label}>
      {options.map((option) => {
        const selected = option.value === value

        return (
          <button
            key={option.label}
            type="button"
            className={[styles.option, selected ? styles.selected : undefined]
              .filter(Boolean)
              .join(' ')}
            // The label and the figure are separate inline spans, which the
            // name computation would otherwise run together ("All3").
            aria-label={option.count === null ? option.label : `${option.label}: ${option.count}`}
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
          >
            {appearance === 'tab' && selected ? (
              <Icon name="check" size={16} className={styles.check} />
            ) : null}
            <span>{option.label}</span>
            {option.count === null ? null : <span className={styles.count}>{option.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
