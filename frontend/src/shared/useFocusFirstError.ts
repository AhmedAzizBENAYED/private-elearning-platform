import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Moves focus to the first field a failed validation marked invalid.
 *
 * Client-side validation that only paints fields red is silent to anyone not
 * looking at them: pressing Submit appears to do nothing. Because the design
 * system's `FieldShell` already ties each control to its message with
 * `aria-describedby` and sets `aria-invalid`, focusing that control announces
 * the field's label and the reason together - no live region, no extra ARIA,
 * and the person is left on the field they have to fix.
 *
 * The move is deliberate and bounded: it happens only in response to a failed
 * submission the person themselves started, never while they are typing.
 *
 * Usage:
 *
 *   const { formRef, focusFirstError } = useFocusFirstError()
 *   ...
 *   <form ref={formRef} onSubmit={...}>
 *   ...
 *   setErrors(local)
 *   focusFirstError()
 */
export function useFocusFirstError() {
  const formRef = useRef<HTMLFormElement>(null)
  // A counter rather than a boolean, so two failed submissions in a row each
  // move focus instead of the second being swallowed as "no change".
  const [attempt, setAttempt] = useState(0)

  const focusFirstError = useCallback(() => setAttempt((previous) => previous + 1), [])

  useEffect(() => {
    if (attempt === 0) return
    // Read after the render that painted the errors, so the selector sees the
    // attributes the failed validation has just produced.
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [attempt])

  return { formRef, focusFirstError }
}
