import styles from './Button.module.css'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'tonal'
  | 'danger'
  | 'danger-outline'
  | 'on-dark'
  | 'ghost-dark'

export type ButtonSize = 'lg' | 'md' | 'sm'

const variantClass: Record<ButtonVariant, string> = {
  primary: styles.primary,
  secondary: styles.secondary,
  tertiary: styles.tertiary,
  tonal: styles.tonal,
  danger: styles.danger,
  'danger-outline': styles.dangerOutline,
  'on-dark': styles.onDark,
  'ghost-dark': styles.ghostDark,
}

const sizeClass: Record<ButtonSize, string> = {
  lg: styles.lg,
  md: styles.md,
  sm: styles.sm,
}

export interface ButtonClassNameOptions {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  iconOnly?: boolean
  className?: string
}

/**
 * The DS 05 button appearance, separated from the `Button` component.
 *
 * Some actions are navigation and must be a router `Link`, which renders its
 * own anchor. Rather than re-deriving the button's colours and geometry at each
 * of those call sites - which is how a design system quietly forks - they build
 * their class list from here, so there is still exactly one definition of what
 * a button looks like.
 */
export function buttonClassName({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  iconOnly = false,
  className,
}: ButtonClassNameOptions = {}): string {
  return [
    styles.button,
    variantClass[variant],
    sizeClass[size],
    iconOnly ? styles.iconOnly : undefined,
    fullWidth ? styles.fullWidth : undefined,
    className,
  ]
    .filter(Boolean)
    .join(' ')
}
