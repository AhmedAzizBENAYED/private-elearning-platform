import type { CSSProperties, ReactNode } from 'react'

import styles from './Skeleton.module.css'

export type SkeletonVariant = 'text' | 'block' | 'circle'

export interface SkeletonProps {
  variant?: SkeletonVariant
  /** Any CSS length; defaults to filling the available width. */
  width?: string | number
  height?: string | number
  className?: string
}

const variantClass: Record<SkeletonVariant, string> = {
  text: styles.text,
  block: styles.block,
  circle: styles.circle,
}

const toLength = (value: string | number | undefined) =>
  typeof value === 'number' ? `${value}px` : value

/**
 * One placeholder shape (DS 06).
 *
 * Hidden from assistive technology: the loading state is announced once by the
 * surrounding `SkeletonGroup`, not once per bar.
 */
export function Skeleton({ variant = 'text', width, height, className }: SkeletonProps) {
  const style: CSSProperties = {
    width: toLength(width) ?? '100%',
    height: toLength(height),
  }

  return (
    <span
      className={[styles.skeleton, variantClass[variant], className].filter(Boolean).join(' ')}
      style={style}
      aria-hidden="true"
    />
  )
}

export interface SkeletonGroupProps {
  children: ReactNode
  /** Announced while loading; keep it short, e.g. "Loading courses". */
  label: string
  className?: string
}

/**
 * Wraps a set of skeletons and carries the `aria-busy` the boards ask for, so
 * assistive technology hears "loading" once rather than reading a wall of
 * meaningless boxes.
 */
export function SkeletonGroup({ children, label, className }: SkeletonGroupProps) {
  return (
    <div className={className} role="status" aria-busy="true" aria-label={label}>
      {children}
    </div>
  )
}
