import { useCallback, useEffect, useRef } from 'react'
import { useBlocker, type BlockerFunction } from 'react-router-dom'

import { routes } from '../../app/routes'

/**
 * Profile-States: "Leaving with unsaved changes (Cancel, back, browser
 * navigation) opens the discard dialog."
 *
 * In-app navigation - a link, Cancel, the browser's Back - is held by the
 * router's blocker so the page can ask first. Closing or reloading the tab
 * cannot show a page's own dialog; the browser's confirmation is the only one
 * available there, so `beforeunload` asks for it.
 *
 * Two departures are never held:
 *  - the page's own navigation after a successful save (`allowNextNavigation`);
 *  - a move to the sign-in page, which only happens when the session has
 *    ended - holding it would keep a signed-out person on a form they can no
 *    longer submit.
 */
export function useUnsavedChanges(dirty: boolean) {
  const allowed = useRef(false)

  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !allowed.current &&
      currentLocation.pathname !== nextLocation.pathname &&
      nextLocation.pathname !== routes.login,
    [dirty],
  )
  const blocker = useBlocker(shouldBlock)

  useEffect(() => {
    if (!dirty) return
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const allowNextNavigation = useCallback(() => {
    allowed.current = true
  }, [])

  return {
    /** Whether the discard dialog should be showing. */
    asking: blocker.state === 'blocked',
    keepEditing: () => blocker.reset?.(),
    discard: () => blocker.proceed?.(),
    allowNextNavigation,
  }
}
