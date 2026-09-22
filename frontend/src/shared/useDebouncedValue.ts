import { useEffect, useState } from 'react'

/**
 * Delays a rapidly changing value.
 *
 * Used so typing in the catalogue search box issues one request when the member
 * pauses, rather than one per keystroke.
 */
export function useDebouncedValue<Value>(value: Value, delayMs: number): Value {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    if (Object.is(value, settled)) return

    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, settled, delayMs])

  return settled
}
